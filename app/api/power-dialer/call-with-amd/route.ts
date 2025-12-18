/**
 * Power Dialer Call with AMD (Answering Machine Detection)
 * 
 * Initiates outbound calls using Telnyx Call Control API with AMD enabled.
 * When a human answers, bridges the call to the user's WebRTC session.
 * When a machine/voicemail is detected, hangs up and returns the result.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pendingAMDCalls } from '@/lib/dialer/amd-calls-store'

export const dynamic = 'force-dynamic'

const TELNYX_API_KEY = process.env.TELNYX_API_V2_KEY || process.env.TELNYX_API_KEY
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_SIP_CONNECTION_ID
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sessionId, queueItemId, contactId, fromNumber, toNumber, listId } = body

    if (!contactId || !fromNumber || !toNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify session ownership if sessionId is provided
    let dialerSession = null
    if (sessionId) {
      dialerSession = await prisma.powerDialerSession.findUnique({
        where: { id: sessionId }
      })
      if (dialerSession && dialerSession.userId !== session.user.id) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }
    }

    // Initiate call with AMD via Telnyx Call Control API
    const telnyxResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: TELNYX_CONNECTION_ID,
        to: toNumber,
        from: fromNumber,
        // Use 'premium' AMD for ML-based detection with high accuracy
        // Premium AMD uses speech recognition + ML to distinguish humans from machines
        answering_machine_detection: 'premium',
        answering_machine_detection_config: {
          // BALANCED AMD: Give Telnyx enough time to analyze while still being fast
          // Too fast = "not_sure" results (can't determine), too slow = frustrating wait
          total_analysis_time_millis: 4000,      // 4 seconds max total analysis
          after_greeting_silence_millis: 1000,   // 1s silence after greeting
          between_words_silence_millis: 500,     // 0.5s between words
          greeting_duration_millis: 3500,        // 3.5s max greeting length
          initial_silence_millis: 2000,          // 2s initial silence before speech
          maximum_number_of_words: 6,            // 6 words (voicemails say more)
          silence_threshold: 256,
          greeting_total_analysis_time_millis: 4000, // 4s total for greeting analysis
        },
        webhook_url: `${WEBHOOK_BASE_URL}/api/power-dialer/webhooks/amd`,
        client_state: Buffer.from(JSON.stringify({
          sessionId,
          queueItemId,
          contactId,
          userId: session.user.id,
        })).toString('base64'),
        timeout_secs: 30,
        time_limit_secs: 600, // 10 minutes max
      })
    })

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.json().catch(() => ({}))
      console.error('[AMD CALL] Telnyx API error:', errorData)
      return NextResponse.json({ 
        error: 'Failed to initiate call',
        details: errorData 
      }, { status: 500 })
    }

    const telnyxData = await telnyxResponse.json()
    const callControlId = telnyxData.data?.call_control_id
    const callLegId = telnyxData.data?.call_leg_id

    if (!callControlId) {
      return NextResponse.json({ error: 'No call control ID returned' }, { status: 500 })
    }

    // Store pending call metadata with initial status
    pendingAMDCalls.set(callControlId, {
      sessionId,
      queueItemId,
      contactId,
      fromNumber,
      toNumber,
      userId: session.user.id,
      startedAt: Date.now(),
      listId,
      status: 'initiated',
    })

    // Log call to database (only if we have a proper session and queue item)
    if (sessionId && queueItemId) {
      await prisma.powerDialerCall.create({
        data: {
          sessionId,
          queueItemId,
          contactId,
          fromNumber,
          toNumber,
          callControlId,
          telnyxCallId: callLegId,
          status: 'INITIATED',
          initiatedAt: new Date(),
        }
      })

      // Update queue item status
      await prisma.powerDialerQueue.update({
        where: { id: queueItemId },
        data: { status: 'CALLING' }
      })
    }

    console.log(`[AMD CALL] Initiated call to ${toNumber} from ${fromNumber}, callControlId: ${callControlId}`)

    return NextResponse.json({
      success: true,
      callControlId,
      callLegId,
    })

  } catch (error) {
    console.error('[AMD CALL] Error:', error)
    return NextResponse.json({ error: 'Failed to initiate call' }, { status: 500 })
  }
}

