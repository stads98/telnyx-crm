import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchAndUpdateCallCost } from '@/lib/jobs/fetch-call-cost';

// Healthcheck endpoints so Telnyx can validate the webhook URL when toggling features like call cost
export async function GET() {
  return NextResponse.json({ ok: true, service: 'telnyx-calls-webhook', ts: new Date().toISOString() })
}

export async function HEAD() {
  return new NextResponse(null, { status: 204 })
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Telnyx sends event_type inside body.data.event_type for v2 webhooks.
    // Fall back to root-level fields just in case.
    const data = body?.data ?? body;
    const event_type = data?.event_type ?? body?.event_type;
    const occurred_at = data?.occurred_at ?? body?.occurred_at;
    const webhookId = data?.id ?? body?.id;

    const callControlId = data?.payload?.call_control_id || data?.call_control_id
    const direction = data?.payload?.call_direction || data?.call_direction
    const from = data?.payload?.from || data?.from || data?.payload?.sip_from
    const to = data?.payload?.to || data?.to || data?.payload?.sip_to
    const legId = data?.payload?.leg_id || data?.leg_id
    const sessionId = data?.payload?.call_session_id || data?.call_session_id
    const sipCode = data?.payload?.sip_response_code || data?.sip_response_code

    console.log('[TELNYX WEBHOOK][CALL]', {
      event_type,
      webhookId,
      occurred_at,
      callControlId,
      direction,
      from,
      to,
      legId,
      sessionId,
      sipCode,
    })

    const payload = data?.payload || data;

    switch (event_type) {
      case 'call.initiated':
        await handleCallInitiated(payload);
        break;
      case 'call.ringing':
        await handleCallRinging(payload);
        break;
      case 'call.answered':
        await handleCallAnswered(payload);
        break;
      case 'call.bridged':
        await handleCallBridged(payload);
        break;
      case 'call.hangup':
        await handleCallHangup(payload);
        break;
      case 'call.recording.saved':
        await handleRecordingSaved(payload);
        break;
      case 'call.machine.detection.ended':
        await handleMachineDetectionEnded(payload);
        break;
      case 'call.cost':
        await handleCallCost(payload);
        break;
      default:
        console.log('Unhandled call webhook event type:', event_type);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error processing Telnyx call webhook:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }

}





async function handleCallInitiated(data: any) {
  try {
    if (!prisma.telnyxCall) return;

    const from = data.from || data.sip_from || 'unknown';
    const to = data.to || data.sip_to || 'unknown';
    const direction = data.call_direction || 'outbound';

    console.log('[TELNYX WEBHOOK][CALL] -> initiated', { callControlId: data.call_control_id, sessionId: data.call_session_id, from, to })

    // Check if call record exists by call_control_id, session_id, OR recent matching call
    // This prevents duplicates when frontend creates a record before webhook arrives
    let existingCall = await prisma.telnyxCall.findFirst({
      where: {
        OR: [
          { telnyxCallId: data.call_control_id },
          ...(data.call_session_id ? [{ telnyxSessionId: data.call_session_id }] : []),
          // Also check for recent calls with matching from/to numbers (within last 10 seconds)
          // This catches cases where frontend created a record without telnyxCallId yet
          {
            AND: [
              { fromNumber: from },
              { toNumber: to },
              { direction: direction },
              { createdAt: { gte: new Date(Date.now() - 10000) } }, // Within last 10 seconds
              {
                OR: [
                  { telnyxCallId: null },
                  { status: 'initiated' }
                ]
              }
            ]
          }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // If no match by IDs, try to find a recent record with same from/to numbers that has no telnyxCallId yet
    // This handles WebRTC calls where the frontend creates a record before we get the webhook
    if (!existingCall) {
      const recentThreshold = new Date(Date.now() - 30000); // 30 seconds ago
      existingCall = await prisma.telnyxCall.findFirst({
        where: {
          fromNumber: from,
          toNumber: to,
          telnyxCallId: null, // Only match records without a telnyx call ID
          status: 'initiated',
          createdAt: { gte: recentThreshold }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (existingCall) {
        console.log('[TELNYX WEBHOOK][CALL] -> found orphan record by phone numbers', { id: existingCall.id })
      }
    }

    if (existingCall) {
      // Update existing record
      const updateInitiated: any = {
        status: 'initiated',
        webhookData: data,
        updatedAt: new Date(),
        ...(data.call_session_id ? { telnyxSessionId: data.call_session_id } : {}),
        ...(data.call_control_id ? { telnyxCallId: data.call_control_id } : {}),
      }
      await prisma.telnyxCall.update({
        where: { id: existingCall.id },
        data: updateInitiated,
      });
      console.log('[TELNYX WEBHOOK][CALL] -> updated existing call', { id: existingCall.id })
    } else {
      // Create new record for calls that don't have a record yet
      console.log('[TELNYX WEBHOOK][CALL] -> creating new call record')

      await prisma.telnyxCall.create({
        data: {
          telnyxCallId: data.call_control_id,
          telnyxSessionId: data.call_session_id || null,
          fromNumber: from,
          toNumber: to,
          direction: direction,
          status: 'initiated',
          webhookData: data,
        }
      });
      console.log('[TELNYX WEBHOOK][CALL] -> created new call record', { from, to, direction })
    }
  } catch (error) {
    console.error('Error handling call initiated:', error);
  }
}

async function handleCallRinging(data: any) {
  try {
    const from = data.from || data.sip_from || 'unknown';
    const to = data.to || data.sip_to || 'unknown';
    const direction = data.call_direction || 'outbound';

    console.log('[TELNYX WEBHOOK][CALL] -> ringing', { callControlId: data.call_control_id, from, to })

    // Check if call record exists by call_control_id, session_id, OR recent matching call
    let existingCall = await prisma.telnyxCall.findFirst({
      where: {
        OR: [
          { telnyxCallId: data.call_control_id },
          ...(data.call_session_id ? [{ telnyxSessionId: data.call_session_id }] : []),
          // Also check for recent calls with matching from/to numbers (within last 15 seconds)
          {
            AND: [
              { fromNumber: from },
              { toNumber: to },
              { direction: direction },
              { createdAt: { gte: new Date(Date.now() - 15000) } }, // Within last 15 seconds
              {
                OR: [
                  { telnyxCallId: null },
                  { status: { in: ['initiated', 'ringing'] } }
                ]
              }
            ]
          }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    // If no match by IDs, try to find a recent record with same from/to numbers that has no telnyxCallId yet
    if (!existingCall) {
      const recentThreshold = new Date(Date.now() - 30000); // 30 seconds ago
      existingCall = await prisma.telnyxCall.findFirst({
        where: {
          fromNumber: from,
          toNumber: to,
          telnyxCallId: null,
          status: { in: ['initiated', 'ringing'] },
          createdAt: { gte: recentThreshold }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (existingCall) {
        console.log('[TELNYX WEBHOOK][CALL] -> found orphan record by phone numbers at ringing', { id: existingCall.id })
      }
    }

    if (existingCall) {
      const updateRinging: any = {
        status: 'ringing',
        webhookData: data,
        updatedAt: new Date(),
        ...(data.call_session_id ? { telnyxSessionId: data.call_session_id } : {}),
        ...(data.call_control_id ? { telnyxCallId: data.call_control_id } : {}),
      }
      await prisma.telnyxCall.update({
        where: { id: existingCall.id },
        data: updateRinging,
      });
    } else {
      // Create new record if it doesn't exist (fallback)
      console.log('[TELNYX WEBHOOK][CALL] -> creating new call record at ringing stage')

      await prisma.telnyxCall.create({
        data: {
          telnyxCallId: data.call_control_id,
          telnyxSessionId: data.call_session_id || null,
          fromNumber: from,
          toNumber: to,
          direction: direction,
          status: 'ringing',
          webhookData: data,
        }
      });
    }
  } catch (error) {
    console.error('Error handling call ringing:', error);
  }
}

async function handleCallAnswered(data: any) {
  try {
    console.log('[TELNYX WEBHOOK][CALL] -> answered', { callControlId: data.call_control_id })

    // Check if this is a click-to-call-via-cell Leg A (user's cell answered)
    // First check client_state, then check database
    let clientState: any = null
    if (data.client_state) {
      try {
        clientState = JSON.parse(Buffer.from(data.client_state, 'base64').toString())
      } catch (e) {
        // Not valid base64 JSON, ignore
      }
    }

    if (clientState?.type === 'click_to_call_via_cell_leg_a') {
      console.log('[CLICK-TO-CALL-VIA-CELL][LEG-A-ANSWERED]', {
        userId: clientState.userId,
        leadPhone: clientState.leadPhone,
        fromNumber: clientState.fromTelnyxNumber
      })
      // Handle click-to-call-via-cell Leg A answered - dial Leg B (prospect)
      await handleClickToCallLegAAnswered(data.call_control_id, clientState)
      return // Don't process as normal call
    }

    // Check if this is Leg B (prospect) answering - then we need to bridge
    if (clientState?.type === 'click_to_call_via_cell_leg_b') {
      console.log('[CLICK-TO-CALL-VIA-CELL][LEG-B-ANSWERED]', {
        legACallControlId: clientState.legACallControlId,
        leadPhone: clientState.leadPhone
      })
      // Now bridge the calls since both are answered
      await handleClickToCallLegBAnswered(data.call_control_id, clientState)
      return // Don't process as normal call
    }

    // Also check database in case client_state wasn't passed through
    const pendingCall = await prisma.clickToCallPending?.findUnique({
      where: { callControlId: data.call_control_id }
    })
    if (pendingCall && pendingCall.status === 'pending') {
      console.log('[CLICK-TO-CALL-VIA-CELL][LEG-A-ANSWERED] Found in DB', {
        pendingId: pendingCall.id,
        leadPhone: pendingCall.leadPhone
      })
      await handleClickToCallLegAAnswered(data.call_control_id, {
        userId: pendingCall.userId,
        leadPhone: pendingCall.leadPhone,
        fromTelnyxNumber: pendingCall.fromTelnyxNumber,
        contactId: pendingCall.contactId,
        userCellNumber: pendingCall.userCellNumber
      })
      return
    }

    // Check if this is Leg B answering via database lookup
    const pendingCallLegB = await prisma.clickToCallPending?.findFirst({
      where: { legBCallControlId: data.call_control_id, status: 'bridging' }
    })
    if (pendingCallLegB) {
      console.log('[CLICK-TO-CALL-VIA-CELL][LEG-B-ANSWERED] Found via DB', {
        legACallControlId: pendingCallLegB.callControlId,
        leadPhone: pendingCallLegB.leadPhone
      })
      await handleClickToCallLegBAnswered(data.call_control_id, {
        legACallControlId: pendingCallLegB.callControlId,
        userId: pendingCallLegB.userId,
        contactId: pendingCallLegB.contactId,
        fromTelnyxNumber: pendingCallLegB.fromTelnyxNumber,
        userCellNumber: pendingCallLegB.userCellNumber,
        leadPhone: pendingCallLegB.leadPhone
      })
      return
    }

    // Prefer occurred_at (moment of answer) for talk time; fall back to start_time
    const answeredAtStr = data?.occurred_at || data?.answered_at || data?.start_time
    const answeredAt = answeredAtStr ? new Date(answeredAtStr) : new Date()

    const updateAnswered: any = {
      status: 'answered',
      answeredAt,
      webhookData: data,
      updatedAt: new Date(),
      ...(data.call_session_id ? { telnyxSessionId: data.call_session_id } : {}),
    }
    await prisma.telnyxCall.updateMany({
      where: { telnyxCallId: data.call_control_id },
      data: updateAnswered,
    });

    // Start recording for all answered calls (especially WebRTC calls that don't have record set at dial time)
    await startCallRecording(data.call_control_id);
  } catch (error) {
    console.error('Error handling call answered:', error);
  }
}

/**
 * Handle when user's cell answers for click-to-call-via-cell
 * Now we need to dial Leg B (the prospect) and bridge the calls
 */
async function handleClickToCallLegAAnswered(legACallControlId: string, clientState: {
  userId: string
  leadPhone: string
  fromTelnyxNumber: string
  contactId?: string | null
  userCellNumber: string
}) {
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY
  const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID

  if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID) {
    console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] Missing Telnyx config')
    return
  }

  try {
    // Update pending call status
    await prisma.clickToCallPending?.update({
      where: { callControlId: legACallControlId },
      data: { status: 'leg_a_answered', updatedAt: new Date() }
    })

    // Build webhook URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    const baseWebhook = appUrl && appUrl.startsWith('https')
      ? appUrl
      : (process.env.TELNYX_PROD_WEBHOOK_URL || 'https://adlercapitalcrm.com')
    const webhookUrl = `${baseWebhook}/api/telnyx/webhooks/calls`

    console.log('[CLICK-TO-CALL-VIA-CELL][DIALING-LEG-B]', {
      leadPhone: clientState.leadPhone,
      fromNumber: clientState.fromTelnyxNumber
    })

    // Play audio feedback to let user know we're connecting
    // Use speak command to tell the user we're dialing
    try {
      await fetch(`https://api.telnyx.com/v2/calls/${legACallControlId}/actions/speak`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: 'Connecting your call. Please hold.',
          voice: 'female',
          language: 'en-US'
        }),
      })
      console.log('[CLICK-TO-CALL-VIA-CELL][SPEAK] Audio feedback sent to Leg A')
    } catch (speakError) {
      console.error('[CLICK-TO-CALL-VIA-CELL][SPEAK-ERROR]', speakError)
      // Continue even if speak fails
    }

    // Create Leg B: Telnyx -> Prospect
    const legBResponse = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: TELNYX_CONNECTION_ID,
        to: clientState.leadPhone,
        from: clientState.fromTelnyxNumber,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        record: 'record-from-answer',
        record_format: 'mp3',
        record_channels: 'dual',
        timeout_secs: 30,
        client_state: Buffer.from(JSON.stringify({
          type: 'click_to_call_via_cell_leg_b',
          legACallControlId,
          userId: clientState.userId,
          contactId: clientState.contactId,
          fromTelnyxNumber: clientState.fromTelnyxNumber,
          userCellNumber: clientState.userCellNumber,
          leadPhone: clientState.leadPhone
        })).toString('base64')
      }),
    })

    if (!legBResponse.ok) {
      const errorData = await legBResponse.json().catch(() => ({}))
      console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] Failed to dial prospect:', errorData)
      // Update status to failed
      await prisma.clickToCallPending?.update({
        where: { callControlId: legACallControlId },
        data: { status: 'failed', updatedAt: new Date() }
      })
      return
    }

    const legBData = await legBResponse.json()
    const legBCallControlId = legBData.data?.call_control_id

    console.log('[CLICK-TO-CALL-VIA-CELL][LEG-B-CREATED]', {
      legBCallControlId,
      legACallControlId
    })

    // Update pending call with Leg B info
    await prisma.clickToCallPending?.update({
      where: { callControlId: legACallControlId },
      data: {
        status: 'bridging',
        legBCallControlId,
        updatedAt: new Date()
      }
    })

    // Play ringback tone to Leg A so user hears ringing while waiting for prospect
    // Use Telnyx's built-in ringback generator
    try {
      await fetch(`https://api.telnyx.com/v2/calls/${legACallControlId}/actions/playback_start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Use a public US ringback tone audio file
          audio_url: 'https://www.soundjay.com/phone/sounds/telephone-ring-04.mp3',
          loop: 'infinity',
          overlay: false
        }),
      })
      console.log('[CLICK-TO-CALL-VIA-CELL][RINGBACK] Playing ringback tone to Leg A')
    } catch (ringbackError) {
      console.error('[CLICK-TO-CALL-VIA-CELL][RINGBACK-ERROR]', ringbackError)
      // Continue even if ringback fails
    }

    // Create TelnyxCall record for this call (Leg B is the actual call to prospect)
    await prisma.telnyxCall.create({
      data: {
        telnyxCallId: legBCallControlId,
        telnyxSessionId: legBData.data?.call_session_id || null,
        fromNumber: clientState.fromTelnyxNumber,
        toNumber: clientState.leadPhone,
        direction: 'outbound',
        status: 'initiated',
        contactId: clientState.contactId || null,
        initiatedBy: clientState.userId,
        webhookData: { clickToCallViaCell: true, legACallControlId }
      }
    })

    // NOTE: Don't bridge here! We wait for Leg B to answer via webhook
    // The bridge will happen in handleClickToCallLegBAnswered when prospect answers
    console.log('[CLICK-TO-CALL-VIA-CELL][WAITING] Waiting for prospect to answer before bridging...')

  } catch (error) {
    console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] handleClickToCallLegAAnswered:', error)
    await prisma.clickToCallPending?.update({
      where: { callControlId: legACallControlId },
      data: { status: 'failed', updatedAt: new Date() }
    }).catch(() => {})
  }
}

/**
 * Handle when prospect (Leg B) answers for click-to-call-via-cell
 * Now we can bridge both calls together
 */
async function handleClickToCallLegBAnswered(legBCallControlId: string, clientState: {
  legACallControlId: string
  userId: string
  contactId?: string | null
  fromTelnyxNumber: string
  userCellNumber: string
  leadPhone: string
}) {
  const TELNYX_API_KEY = process.env.TELNYX_API_KEY

  if (!TELNYX_API_KEY) {
    console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] Missing Telnyx API key')
    return
  }

  try {
    console.log('[CLICK-TO-CALL-VIA-CELL][BRIDGING]', {
      legACallControlId: clientState.legACallControlId,
      legBCallControlId
    })

    // Stop ringback tone on Leg A before bridging
    try {
      await fetch(`https://api.telnyx.com/v2/calls/${clientState.legACallControlId}/actions/playback_stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      console.log('[CLICK-TO-CALL-VIA-CELL][PLAYBACK-STOP] Stopped ringback on Leg A')
    } catch (stopError) {
      // Ignore errors - ringback may have already ended
    }

    // Bridge Leg A (user's cell) to Leg B (prospect)
    const bridgeResponse = await fetch(`https://api.telnyx.com/v2/calls/${clientState.legACallControlId}/actions/bridge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_control_id: legBCallControlId
      }),
    })

    if (!bridgeResponse.ok) {
      const errorData = await bridgeResponse.json().catch(() => ({}))
      console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] Failed to bridge calls:', errorData)
      await prisma.clickToCallPending?.update({
        where: { callControlId: clientState.legACallControlId },
        data: { status: 'bridge_failed', updatedAt: new Date() }
      })
    } else {
      console.log('[CLICK-TO-CALL-VIA-CELL][BRIDGED] Successfully bridged calls!')
      await prisma.clickToCallPending?.update({
        where: { callControlId: clientState.legACallControlId },
        data: { status: 'completed', completedAt: new Date(), updatedAt: new Date() }
      })

      // Update TelnyxCall record to bridged status
      await prisma.telnyxCall.updateMany({
        where: { telnyxCallId: legBCallControlId },
        data: { status: 'bridged', answeredAt: new Date(), updatedAt: new Date() }
      })
    }
  } catch (error) {
    console.error('[CLICK-TO-CALL-VIA-CELL][ERROR] handleClickToCallLegBAnswered:', error)
    await prisma.clickToCallPending?.update({
      where: { callControlId: clientState.legACallControlId },
      data: { status: 'failed', updatedAt: new Date() }
    }).catch(() => {})
  }
}

// Start recording on a call using Telnyx Call Control API
async function startCallRecording(callControlId: string) {
  try {
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      console.error('[TELNYX][RECORD] No API key configured');
      return;
    }

    console.log('[TELNYX][RECORD] Starting recording for call:', callControlId);

    const response = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        format: 'mp3',
        channels: 'dual',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TELNYX][RECORD] Failed to start recording:', response.status, errorText);
      return;
    }

    const result = await response.json();
    console.log('[TELNYX][RECORD] ✅ Recording started:', result);
  } catch (error) {
    console.error('[TELNYX][RECORD] Error starting recording:', error);
  }
}

async function handleCallBridged(data: any) {
  try {
    console.log('[TELNYX WEBHOOK][CALL] -> bridged', { callControlId: data.call_control_id })
    const updateBridged: any = {
      status: 'bridged',
      webhookData: data,
      updatedAt: new Date(),
      ...(data.call_session_id ? { telnyxSessionId: data.call_session_id } : {}),
    }
    await prisma.telnyxCall.updateMany({
      where: { telnyxCallId: data.call_control_id },
      data: updateBridged,
    });
  } catch (error) {
    console.error('Error handling call bridged:', error);
  }
}

async function handleCallHangup(data: any) {
  try {
    if (!prisma.telnyxCall) return;

    // Prefer session time (start_time -> end_time). Fall back to answered/created when needed.
    const endStr = data?.end_time || data?.occurred_at
    const endedAt = endStr ? new Date(endStr) : new Date()

    let duration = 0

    // 1) Session time if both timestamps present in webhook payload
    const sessionStartStr = data?.start_time
    if (sessionStartStr && endedAt) {
      const sessionStart = new Date(sessionStartStr)
      duration = Math.max(0, Math.round((endedAt.getTime() - sessionStart.getTime()) / 1000))
    }

    // 2) Fallbacks
    if (!duration || duration <= 0) {
      const call = await prisma.telnyxCall.findFirst({ where: { telnyxCallId: data.call_control_id } })
      const fallbackStartStr = call?.createdAt?.toISOString() || call?.answeredAt?.toISOString() || data?.start_time
      if (fallbackStartStr && endedAt) {
        const start = new Date(fallbackStartStr)
        duration = Math.max(0, Math.round((endedAt.getTime() - start.getTime()) / 1000))
      }
    }

    // 3) As a last resort, if Telnyx provided talk time seconds, keep that to avoid 0
    if ((!duration || duration <= 0) && (typeof data?.call_duration_secs === 'number')) {
      duration = data.call_duration_secs
    }

    console.log('[TELNYX WEBHOOK][CALL] -> hangup', {
      callControlId: data.call_control_id,
      duration,
      cause: data.hangup_cause,
    })

    const updateHangup: any = {
      status: 'hangup',
      duration,
      endedAt,
      hangupCause: data.hangup_cause,
      webhookData: data,
      updatedAt: new Date(),
      ...(data.call_session_id ? { telnyxSessionId: data.call_session_id } : {}),
      ...(data.call_control_id ? { telnyxCallId: data.call_control_id } : {}),
    }
    // Try to update by call_control_id first
    let updated = await prisma.telnyxCall.updateMany({
      where: { telnyxCallId: data.call_control_id },
      data: updateHangup,
    });
    // If no match by call_control_id, try by session_id (WebRTC calls)
    if (updated.count === 0 && data.call_session_id) {
      console.log('[TELNYX WEBHOOK][CALL] -> hangup: No match by callControlId, trying sessionId')
      updated = await prisma.telnyxCall.updateMany({
        where: { telnyxSessionId: data.call_session_id },
        data: updateHangup,
      });
    }
    // If still no match, try by phone numbers for orphan records
    if (updated.count === 0) {
      const from = data.from || data.sip_from;
      const to = data.to || data.sip_to;
      if (from && to) {
        const recentThreshold = new Date(Date.now() - 120000); // 2 minutes ago
        console.log('[TELNYX WEBHOOK][CALL] -> hangup: No match by IDs, trying phone numbers', { from, to })
        updated = await prisma.telnyxCall.updateMany({
          where: {
            fromNumber: from,
            toNumber: to,
            telnyxCallId: null,
            status: { in: ['initiated', 'ringing', 'answered'] },
            createdAt: { gte: recentThreshold }
          },
          data: updateHangup,
        });
        if (updated.count > 0) {
          console.log('[TELNYX WEBHOOK][CALL] -> hangup: Updated orphan record by phone numbers')
        }
      }
    }

    // Enqueue CDR reconciliation (retry will handle delayed CDR availability)
    try {
      // schedule for ~30 seconds later
      const nextRun = new Date(Date.now() + 30_000)
      // Avoid duplicate jobs for the same call by allowing multiple but processor will be idempotent,
      // or we could upsert if you prefer.
      // Here we just create a new pending job.
      // @ts-ignore - type available after prisma generate
      await prisma.telnyxCdrReconcileJob?.create({
        data: {
          telnyxCallId: data.call_control_id,
          telnyxSessionId: data.call_session_id ?? null,
          status: 'pending',
          attempts: 0,
          nextRunAt: nextRun,
        },
      })
    } catch (e) {
      console.error('Failed to enqueue Telnyx CDR reconcile job', e)
    }

    // Also try to fetch cost immediately from Detail Records API
    // This runs in background and doesn't block webhook response
    setTimeout(async () => {
      try {
        console.log('[TELNYX WEBHOOK][CALL] Fetching cost from Detail Records API:', data.call_control_id)
        await fetchAndUpdateCallCost(data.call_control_id)
      } catch (error) {
        console.error('[TELNYX WEBHOOK][CALL] Error fetching cost from Detail Records API:', error)
      }
    }, 5000) // Wait 5 seconds before fetching (give Telnyx time to process)


    // Update billing if cost is available
    if (data.cost && data.cost.amount && prisma.telnyxBilling) {
      const call = await prisma.telnyxCall.findFirst({
        where: { telnyxCallId: data.call_control_id },
      });

      if (call) {
        const amt = parseFloat(data.cost.amount)
        const currency = data.cost.currency || 'USD'
        await prisma.telnyxBilling.create({
          data: {
            phoneNumber: call.fromNumber,
            recordType: 'call',
            recordId: data.call_control_id,
            cost: amt,
            currency,
            billingDate: new Date(),
            description: `Call to ${call.toNumber} (${duration}s)`,
            metadata: data,
          },
        });

        // Update phone number total cost
        if (prisma.telnyxPhoneNumber) {
          await prisma.telnyxPhoneNumber.updateMany({
            where: { phoneNumber: call.fromNumber },
            data: { totalCost: { increment: amt } },
          });
        }

        // Update call record with cost
        await prisma.telnyxCall.updateMany({
          where: { telnyxCallId: data.call_control_id },
          data: { cost: amt },
        });
      }
    } else if (prisma.telnyxBilling) {
      // Fallback: estimate cost if TELNYX_VOICE_RATE_PER_MIN is set
      const rateStr = process.env.TELNYX_VOICE_RATE_PER_MIN
      const rate = rateStr ? parseFloat(rateStr) : undefined
      if (rate && duration > 0) {
        const call = await prisma.telnyxCall.findFirst({
          where: { telnyxCallId: data.call_control_id },
        })
        if (call) {
          const billedMinutes = Math.max(1, Math.ceil(duration / 60))
          const amt = billedMinutes * rate
          const currency = 'USD'
          await prisma.telnyxBilling.create({
            data: {
              phoneNumber: call.fromNumber,
              recordType: 'call',
              recordId: data.call_control_id,
              cost: amt,
              currency,
              billingDate: new Date(),
              description: `Call to ${call.toNumber} (${duration}s) [estimated @ ${rate}/min]`,
              metadata: { estimated: true, ratePerMin: rate, source: 'fallback' },
            },
          })
          // Update phone number total cost incrementally
          if (prisma.telnyxPhoneNumber) {
            await prisma.telnyxPhoneNumber.updateMany({
              where: { phoneNumber: call.fromNumber },
              data: { totalCost: { increment: amt } },
            })
          }
          await prisma.telnyxCall.updateMany({
            where: { telnyxCallId: data.call_control_id },
            data: { cost: amt },
          })
        }
      }
    }
  } catch (error) {
    console.error('Error handling call hangup:', error);
  }
}


async function handleCallCost(data: any) {
  try {
    const amount = (data?.cost?.amount != null)
      ? parseFloat(data.cost.amount)
      : (typeof data?.amount === 'number' ? data.amount : undefined)
    if (amount == null) {
      console.log('call.cost without amount payload')
      return
    }
    const currency = data?.cost?.currency || data?.currency || 'USD'

    const call = await prisma.telnyxCall?.findFirst({
      where: { telnyxCallId: data.call_control_id },
    })

    if (call) {
      const existing = call.cost ? parseFloat(call.cost.toString()) : 0
      const diff = amount - existing

      await prisma.telnyxCall.updateMany({
        where: { telnyxCallId: data.call_control_id },
        data: {
          cost: amount,
          webhookData: data,
          updatedAt: new Date(),
        },
      })

      if (prisma.telnyxBilling) {
        const existingBilling = await prisma.telnyxBilling.findFirst({
          where: { recordId: data.call_control_id, recordType: 'call' },
        })
        if (existingBilling) {
          await prisma.telnyxBilling.update({
            where: { id: existingBilling.id },
            data: {
              cost: amount,
              currency,
              description: `Call cost updated (${amount} ${currency})`,
              metadata: data,
            },
          })
        } else {
          await prisma.telnyxBilling.create({
            data: {
              phoneNumber: call.fromNumber,
              recordType: 'call',
              recordId: data.call_control_id,
              cost: amount,
              currency,
              billingDate: new Date(),
              description: `Call to ${call.toNumber} (${call.duration ?? 0}s)`,
              metadata: data,
            },
          })
        }
      }

      if (diff !== 0 && prisma.telnyxPhoneNumber) {
        await prisma.telnyxPhoneNumber.updateMany({
          where: { phoneNumber: call.fromNumber },
          data: { totalCost: { increment: diff } },
        })
      }
    }
  } catch (error) {
    console.error('Error handling call cost:', error)
  }
}

async function handleRecordingSaved(data: any) {
  try {
    if (!prisma.telnyxCall) return;

    const recordingUrl = data.recording_urls?.mp3 || data.recording_url;
    const callControlId = data.call_control_id;
    const sessionId = data.call_session_id;

    console.log('[TELNYX WEBHOOK][CALL] -> recording.saved', {
      callControlId,
      sessionId,
      mp3: recordingUrl
    })

    // Try to find and update by call_control_id first
    let updated = await prisma.telnyxCall.updateMany({
      where: { telnyxCallId: callControlId },
      data: {
        recordingUrl,
        webhookData: data,
        updatedAt: new Date(),
      },
    });

    // If no match by call_control_id, try by session_id (WebRTC calls)
    if (updated.count === 0 && sessionId) {
      console.log('[TELNYX WEBHOOK][CALL] -> recording.saved: No match by callControlId, trying sessionId')
      updated = await prisma.telnyxCall.updateMany({
        where: { telnyxSessionId: sessionId },
        data: {
          recordingUrl,
          telnyxCallId: callControlId, // Also update the call_control_id for future reference
          webhookData: data,
          updatedAt: new Date(),
        },
      });
    }

    console.log('[TELNYX WEBHOOK][CALL] -> recording.saved: Updated', updated.count, 'records')
  } catch (error) {
    console.error('Error handling recording saved:', error);
  }
}

async function handleMachineDetectionEnded(data: any) {
  try {
    if (!prisma.telnyxCall) return;

    console.log('Machine detection result:', {
      callControlId: data.call_control_id,
      result: data.result,
      confidence: data.confidence
    });

    // Update call record with machine detection result
    await prisma.telnyxCall.updateMany({
      where: { telnyxCallId: data.call_control_id },
      data: {
        webhookData: data,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error handling machine detection ended:', error);
  }
}
