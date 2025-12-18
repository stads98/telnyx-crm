import { prisma } from '@/lib/db'
import { getBestPhoneNumber } from '@/lib/phone-utils'
import { formatMessageTemplate } from '@/lib/message-template'
import { broadcast } from '@/lib/server-events'
import { formatPhoneNumberForTelnyx, isValidE164PhoneNumber } from '@/lib/phone-utils'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const TELNYX_API_URL = 'https://api.telnyx.com/v2/messages'

interface SendResult {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Process a text campaign - sends messages one at a time with configurable delay
 * Supports multiple rounds with different templates per round
 */
export async function processTextCampaign(campaignId: string) {
  let localSentCount = 0
  let localFailedCount = 0

  try {
    const campaign = await prisma.textCampaign.findUnique({
      where: { id: campaignId },
    })

    if (!campaign || campaign.status !== 'RUNNING') {
      console.log(`[TextCampaign ${campaignId}] Not running, aborting`)
      return
    }

    const templates = JSON.parse(campaign.templates as string) as Array<{ round: number; content: string }>
    const currentTemplate = templates.find(t => t.round === campaign.currentRound)

    if (!currentTemplate) {
      console.error(`[TextCampaign ${campaignId}] No template for round ${campaign.currentRound}`)
      await prisma.textCampaign.update({
        where: { id: campaignId },
        data: { status: 'STOPPED' },
      })
      return
    }

    // Get pending queue items for current round
    const queueItems = await prisma.textCampaignQueue.findMany({
      where: {
        campaignId,
        status: 'PENDING',
        currentRound: campaign.currentRound,
      },
      orderBy: [{ priority: 'desc' }],
      include: {
        contact: {
          include: { properties: true },
        },
      },
    })

    console.log(`[TextCampaign ${campaignId}] Round ${campaign.currentRound}: ${queueItems.length} contacts pending`)

    for (let i = 0; i < queueItems.length; i++) {
      // Check if campaign is still running
      const currentCampaign = await prisma.textCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      })

      if (!currentCampaign || currentCampaign.status !== 'RUNNING') {
        console.log(`[TextCampaign ${campaignId}] Stopped at index ${i}`)
        break
      }

      const queueItem = queueItems[i]
      const contact = queueItem.contact
      const fromNumber = queueItem.assignedNumber || campaign.selectedNumbers[0]
      const toNumber = getBestPhoneNumber(contact)

      if (!toNumber) {
        await prisma.textCampaignQueue.update({
          where: { id: queueItem.id },
          data: { status: 'SKIPPED' },
        })
        localFailedCount++
        continue
      }

      // Mark as sending
      await prisma.textCampaignQueue.update({
        where: { id: queueItem.id },
        data: { status: 'SENDING' },
      })

      // Format message with contact variables
      const messageContent = formatMessageTemplate(currentTemplate.content, contact)

      // Broadcast current sending status
      broadcast('text-campaign:sending', {
        campaignId,
        contactId: contact.id,
        contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.llcName || 'Unknown',
        phoneNumber: toNumber,
        fromNumber,
        message: messageContent,
        round: campaign.currentRound,
        progress: {
          sent: campaign.sentCount + localSentCount,
          failed: campaign.failedCount + localFailedCount,
          total: campaign.totalContacts,
          currentIndex: i + 1,
          queueLength: queueItems.length,
        },
      })

      // Send the message
      const result = await sendCampaignSms(fromNumber, toNumber, messageContent, contact.id, campaignId, queueItem.id, campaign.currentRound)

      if (result.success) {
        localSentCount++
        await prisma.textCampaignQueue.update({
          where: { id: queueItem.id },
          data: {
            status: 'SENT',
            lastSentAt: new Date(),
            attemptCount: { increment: 1 },
          },
        })
      } else {
        localFailedCount++
        await prisma.textCampaignQueue.update({
          where: { id: queueItem.id },
          data: {
            status: 'FAILED',
            attemptCount: { increment: 1 },
          },
        })
        console.error(`[TextCampaign ${campaignId}] Failed to send to ${toNumber}: ${result.error}`)
      }

      // Update campaign progress
      await prisma.textCampaign.update({
        where: { id: campaignId },
        data: {
          sentCount: { increment: result.success ? 1 : 0 },
          failedCount: { increment: result.success ? 0 : 1 },
          currentIndex: i + 1,
        },
      })

      // Broadcast progress
      broadcast('text-campaign:progress', {
        campaignId,
        sentCount: campaign.sentCount + localSentCount,
        failedCount: campaign.failedCount + localFailedCount,
        currentIndex: i + 1,
        totalContacts: campaign.totalContacts,
        round: campaign.currentRound,
        maxRounds: campaign.maxRounds,
      })

      // Apply delay before next message
      if (campaign.delaySeconds > 0 && i < queueItems.length - 1) {
        await delayWithPauseCheck(campaignId, campaign.delaySeconds * 1000)
      }
    }

    // Round complete - check what to do next
    await handleRoundComplete(campaignId)

  } catch (error) {
    console.error(`[TextCampaign ${campaignId}] Fatal error:`, error)
    await prisma.textCampaign.update({
      where: { id: campaignId },
      data: { status: 'STOPPED' },
    })
  }
}

/**
 * Handle completion of a round - either complete campaign or wait for next round
 */
async function handleRoundComplete(campaignId: string) {
  const campaign = await prisma.textCampaign.findUnique({
    where: { id: campaignId },
  })

  if (!campaign) return

  if (campaign.currentRound >= campaign.maxRounds) {
    // All rounds complete
    await prisma.textCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    broadcast('text-campaign:completed', {
      campaignId,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      respondedCount: campaign.respondedCount,
      totalContacts: campaign.totalContacts,
    })

    console.log(`[TextCampaign ${campaignId}] All rounds completed`)
  } else {
    // More rounds available - pause and wait for user to start next round
    await prisma.textCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'ROUND_COMPLETE',
        pausedAt: new Date(),
      },
    })

    broadcast('text-campaign:round-complete', {
      campaignId,
      completedRound: campaign.currentRound,
      nextRound: campaign.currentRound + 1,
      maxRounds: campaign.maxRounds,
      sentCount: campaign.sentCount,
      respondedCount: campaign.respondedCount,
    })

    console.log(`[TextCampaign ${campaignId}] Round ${campaign.currentRound} complete, waiting for next round`)
  }
}

/**
 * Delay with periodic pause checking
 */
async function delayWithPauseCheck(campaignId: string, totalDelayMs: number): Promise<boolean> {
  const checkIntervalMs = 500
  let elapsedMs = 0

  while (elapsedMs < totalDelayMs) {
    const campaign = await prisma.textCampaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    })

    if (!campaign || campaign.status !== 'RUNNING') {
      return false // Indicate that we should stop
    }

    const waitTime = Math.min(checkIntervalMs, totalDelayMs - elapsedMs)
    await new Promise(resolve => setTimeout(resolve, waitTime))
    elapsedMs += waitTime
  }

  return true
}

/**
 * Send an SMS for a text campaign
 */
async function sendCampaignSms(
  fromNumber: string,
  toNumber: string,
  body: string,
  contactId: string,
  campaignId: string,
  queueItemId: string,
  round: number
): Promise<SendResult> {
  try {
    if (!TELNYX_API_KEY) {
      return { success: false, error: 'Telnyx API key not configured' }
    }

    const formattedFromNumber = formatPhoneNumberForTelnyx(fromNumber)
    const formattedToNumber = formatPhoneNumberForTelnyx(toNumber)

    if (!formattedFromNumber || !isValidE164PhoneNumber(formattedFromNumber)) {
      return { success: false, error: `Invalid from number: ${fromNumber}` }
    }

    if (!formattedToNumber || !isValidE164PhoneNumber(formattedToNumber)) {
      return { success: false, error: `Invalid to number: ${toNumber}` }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const baseWebhook = appUrl && appUrl.startsWith('https')
      ? appUrl
      : (process.env.TELNYX_PROD_WEBHOOK_URL || 'https://adlercapitalcrm.com')

    const telnyxResponse = await fetch(TELNYX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formattedFromNumber,
        to: formattedToNumber,
        text: body,
        webhook_url: `${baseWebhook}/api/telnyx/webhooks/sms`,
        webhook_failover_url: `${baseWebhook}/api/telnyx/webhooks/sms-failover`,
        use_profile_webhooks: false,
      }),
    })

    const telnyxData = await telnyxResponse.json()

    if (!telnyxResponse.ok) {
      console.error('[TextCampaignSMS] Telnyx error:', telnyxData)
      return { success: false, error: telnyxData.errors?.[0]?.detail || 'Failed to send SMS' }
    }

    // Save campaign message record
    await prisma.textCampaignMessage.create({
      data: {
        campaignId,
        queueItemId,
        contactId,
        fromNumber: formattedFromNumber,
        toNumber: formattedToNumber,
        content: body,
        round,
        telnyxMessageId: telnyxData.data.id,
        status: 'SENT',
        sentAt: new Date(),
      },
    })

    // Also save to telnyxMessage for conversation history
    await prisma.telnyxMessage.create({
      data: {
        telnyxMessageId: telnyxData.data.id,
        contactId,
        fromNumber: formattedFromNumber,
        toNumber: formattedToNumber,
        direction: 'outbound',
        content: body,
        status: 'queued',
        segments: telnyxData.data.parts || 1,
        cost: telnyxData.data.cost?.amount ? parseFloat(telnyxData.data.cost.amount) : null,
      },
    })

    // Update conversation
    await updateConversation(contactId, formattedFromNumber, formattedToNumber, body)

    return { success: true, messageId: telnyxData.data.id }
  } catch (error: any) {
    console.error('[TextCampaignSMS] Error:', error)
    return { success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Update or create conversation for a contact
 */
async function updateConversation(
  contactId: string,
  fromNumber: string,
  toNumber: string,
  message: string
) {
  try {
    const existing = await prisma.conversation.findFirst({
      where: { contact_id: contactId }
    })

    if (existing) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          phone_number: toNumber,
          our_number: fromNumber,
          last_message_content: message,
          last_message_at: new Date(),
          last_message_direction: 'outbound',
          last_sender_number: fromNumber,
          message_count: (existing.message_count ?? 0) + 1,
          updated_at: new Date(),
        }
      })
    } else {
      await prisma.conversation.create({
        data: {
          contact_id: contactId,
          phone_number: toNumber,
          our_number: fromNumber,
          channel: 'sms',
          last_message_content: message,
          last_message_at: new Date(),
          last_message_direction: 'outbound',
          last_sender_number: fromNumber,
          message_count: 1,
          unread_count: 0,
          status: 'active',
          priority: 'normal',
        }
      })
    }
  } catch (error) {
    console.error('[TextCampaign] Error updating conversation:', error)
  }
}

/**
 * Mark a contact as responded - called when we receive an inbound message
 */
export async function markContactResponded(contactId: string, campaignId?: string) {
  try {
    const where: any = {
      contactId,
      status: { in: ['PENDING', 'SENT', 'SENDING'] },
    }
    if (campaignId) {
      where.campaignId = campaignId
    }

    const updated = await prisma.textCampaignQueue.updateMany({
      where,
      data: {
        status: 'RESPONDED',
        respondedAt: new Date(),
      },
    })

    if (updated.count > 0) {
      // Update campaign responded count
      const queueItem = await prisma.textCampaignQueue.findFirst({
        where: { contactId, status: 'RESPONDED' },
        select: { campaignId: true },
      })

      if (queueItem) {
        await prisma.textCampaign.update({
          where: { id: queueItem.campaignId },
          data: { respondedCount: { increment: 1 } },
        })

        broadcast('text-campaign:response', {
          campaignId: queueItem.campaignId,
          contactId,
        })
      }
    }

    return updated.count
  } catch (error) {
    console.error('[TextCampaign] Error marking contact responded:', error)
    return 0
  }
}

