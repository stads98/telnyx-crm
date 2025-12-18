/**
 * AMD Webhook Handler for Power Dialer
 * 
 * Handles Telnyx call events for AMD-enabled calls:
 * - call.answered: Call was answered
 * - call.machine.detection.ended: AMD result received
 * - call.hangup: Call ended
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pendingAMDCalls } from '@/lib/dialer/amd-calls-store'

export const dynamic = 'force-dynamic'

const TELNYX_API_KEY = process.env.TELNYX_API_V2_KEY || process.env.TELNYX_API_KEY

interface TelnyxWebhookPayload {
  data: {
    event_type: string
    id: string
    occurred_at: string
    payload: {
      call_control_id: string
      call_leg_id?: string
      call_session_id?: string
      client_state?: string
      from?: string
      to?: string
      direction?: string
      state?: string
      hangup_cause?: string
      hangup_source?: string
      sip_hangup_cause?: string
      result?: string // AMD result
    }
  }
}

interface ClientState {
  sessionId: string
  queueItemId: string
  contactId: string
  userId: string
}

function parseClientState(clientStateBase64?: string): ClientState | null {
  if (!clientStateBase64) return null
  try {
    const decoded = Buffer.from(clientStateBase64, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

async function hangupCall(callControlId: string): Promise<void> {
  try {
    await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    })
  } catch (error) {
    console.error('[AMD WEBHOOK] Error hanging up call:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: TelnyxWebhookPayload = await request.json()
    const { event_type, payload } = body.data
    const callControlId = payload.call_control_id

    console.log(`[AMD WEBHOOK] Received: ${event_type}`, {
      call_control_id: callControlId,
      from: payload.from,
      to: payload.to,
      result: payload.result
    })

    if (!callControlId) {
      return NextResponse.json({ received: true })
    }

    const clientState = parseClientState(payload.client_state)
    const pendingCall = pendingAMDCalls.get(callControlId)

    if (!clientState && !pendingCall) {
      console.log(`[AMD WEBHOOK] No context found for call ${callControlId}`)
      return NextResponse.json({ received: true })
    }

    const sessionId = clientState?.sessionId || pendingCall?.sessionId
    const queueItemId = clientState?.queueItemId || pendingCall?.queueItemId

    switch (event_type) {
      case 'call.initiated':
      case 'call.ringing':
        // Update call status in memory for polling
        if (pendingCall) {
          pendingCall.status = event_type === 'call.ringing' ? 'ringing' : 'initiated'
        }
        // Update call status in database
        if (queueItemId) {
          await prisma.powerDialerCall.updateMany({
            where: { queueItemId, callControlId },
            data: { status: event_type === 'call.ringing' ? 'RINGING' : 'INITIATED' }
          })
        }
        break

      case 'call.machine.detection.ended':
      case 'call.machine.premium.detection.ended':
        // Handle both standard and premium AMD results
        const amdResult = payload.result?.toLowerCase()
        console.log(`[AMD WEBHOOK] AMD Result: ${amdResult} (event: ${event_type})`)

        // Premium AMD results: human_residence, human_business, machine, silence, fax_detected, not_sure
        // Standard AMD results: human, machine, fax, not_sure

        // INCLUSIVE HUMAN DETECTION: Connect on human results AND uncertain results
        // "not_sure" typically means the call was answered but AMD couldn't determine
        // It's better to connect (might be voicemail) than miss real humans
        // The agent can always hang up if it's actually a voicemail
        const isHumanOrUncertain = amdResult === 'human_residence' ||
                                    amdResult === 'human_business' ||
                                    amdResult === 'human' ||           // Standard AMD human result
                                    amdResult === 'not_sure'           // Treat uncertain as human

        // Only definite machines/voicemails should be hung up:
        // - 'machine' - definite voicemail greeting detected
        // - 'fax' / 'fax_detected' - fax machine
        // - 'silence' - no audio detected (dead line)
        const isDefiniteMachine = amdResult?.includes('machine') ||
                                   amdResult === 'fax' ||
                                   amdResult === 'fax_detected' ||
                                   amdResult === 'silence'

        if (isHumanOrUncertain) {
          // Human detected (or uncertain) - mark as ready for connection
          // For "not_sure", we connect anyway - better to connect than miss humans
          const status = amdResult === 'not_sure' ? 'uncertain (connecting anyway)' : amdResult
          console.log(`[AMD WEBHOOK] ✅ Human/Uncertain detected (${status}), ready for connection`)

          // Update in-memory status for polling
          if (pendingCall) {
            pendingCall.status = 'human_detected'
            pendingCall.amdResult = 'human'
          }

          if (queueItemId) {
            await prisma.powerDialerCall.updateMany({
              where: { queueItemId, callControlId },
              data: {
                status: 'HUMAN_DETECTED',
                amdResult: amdResult,
                answered: true,
                answeredAt: new Date(),
              }
            })
          }
        } else if (isDefiniteMachine) {
          // Definite Machine/Voicemail detected - hang up immediately and return to queue
          console.log(`[AMD WEBHOOK] ❌ Definite Machine/Voicemail detected (${amdResult}), hanging up and returning to queue`)

          // Update in-memory status BEFORE hanging up so polling can detect it
          if (pendingCall) {
            pendingCall.status = 'voicemail'
            pendingCall.amdResult = amdResult?.includes('fax') ? 'fax' : 'machine'
          }

          await hangupCall(callControlId)

          // Update database - mark queue item as PENDING to return to queue (like no answer)
          if (queueItemId) {
            await prisma.powerDialerCall.updateMany({
              where: { queueItemId, callControlId },
              data: {
                status: 'NO_ANSWER_VOICEMAIL',
                amdResult: amdResult,
                endedAt: new Date(),
              }
            })
            // Return to queue by setting status to PENDING - will be called again
            await prisma.powerDialerQueue.update({
              where: { id: queueItemId },
              data: {
                status: 'PENDING',
                callOutcome: 'NO_ANSWER_VOICEMAIL'
              }
            })
          }

          // Keep the entry for a bit so polling can detect voicemail
          // Clean up happens after polling detects it
        } else {
          // Unknown result - log and treat as uncertain (voicemail)
          console.log(`[AMD WEBHOOK] ⚠️ Unknown AMD result (${amdResult}), treating as voicemail for safety`)

          if (pendingCall) {
            pendingCall.status = 'voicemail'
            pendingCall.amdResult = 'unknown'
          }

          await hangupCall(callControlId)

          if (queueItemId) {
            await prisma.powerDialerCall.updateMany({
              where: { queueItemId, callControlId },
              data: {
                status: 'NO_ANSWER_VOICEMAIL',
                amdResult: amdResult || 'unknown',
                endedAt: new Date(),
              }
            })
            await prisma.powerDialerQueue.update({
              where: { id: queueItemId },
              data: {
                status: 'PENDING',
                callOutcome: 'NO_ANSWER_VOICEMAIL'
              }
            })
          }
        }
        break

      case 'call.answered':
        // Call was answered - wait for AMD result
        if (pendingCall) {
          pendingCall.status = 'amd_checking'
        }
        if (queueItemId) {
          await prisma.powerDialerCall.updateMany({
            where: { queueItemId, callControlId },
            data: { status: 'ANSWERED' }
          })
        }
        break

      case 'call.hangup':
        const hangupCause = payload.hangup_cause || payload.sip_hangup_cause
        console.log(`[AMD WEBHOOK] Call ended: ${hangupCause}`)

        // Update in-memory status for polling
        if (pendingCall) {
          // Only update if not already voicemail (voicemail status should persist for polling)
          if (pendingCall.status !== 'voicemail' && pendingCall.status !== 'human_detected') {
            if (hangupCause === 'busy') {
              pendingCall.status = 'busy'
            } else if (hangupCause === 'no_answer' || hangupCause === 'timeout') {
              pendingCall.status = 'no_answer'
            } else {
              pendingCall.status = 'ended'
            }
          }
          pendingCall.hangupCause = hangupCause
        }

        if (queueItemId) {
          // Determine outcome based on hangup cause
          let callOutcome = 'NO_ANSWER'
          if (hangupCause === 'busy') callOutcome = 'BUSY'
          else if (hangupCause === 'normal_clearing') callOutcome = 'COMPLETED'
          else if (hangupCause === 'originator_cancel') callOutcome = 'CANCELLED'

          await prisma.powerDialerCall.updateMany({
            where: { queueItemId, callControlId },
            data: {
              status: 'ENDED',
              endedAt: new Date(),
              hangupCause,
            }
          })

          // Only update queue if not already completed
          const queueItem = await prisma.powerDialerQueue.findUnique({
            where: { id: queueItemId }
          })
          if (queueItem && queueItem.status !== 'COMPLETED') {
            await prisma.powerDialerQueue.update({
              where: { id: queueItemId },
              data: {
                status: 'COMPLETED',
                callOutcome
              }
            })
          }
        }

        // Don't delete immediately - let polling detect the final status
        // Cleanup will happen via the periodic cleanup function
        break
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('[AMD WEBHOOK] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

