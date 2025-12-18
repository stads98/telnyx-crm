/**
 * Webhook handler for manual multi-call AMD events
 * 
 * Handles AMD detection results for manual multi-line calls.
 * When human detected: transfers to WebRTC
 * When voicemail detected: hangs up
 */

import { NextRequest, NextResponse } from 'next/server'
import { pendingAMDCalls } from '@/lib/dialer/amd-calls-store'

export const dynamic = 'force-dynamic'

const TELNYX_API_KEY = process.env.TELNYX_API_V2_KEY || process.env.TELNYX_API_KEY

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const eventType = body.data?.event_type
    const callControlId = body.data?.payload?.call_control_id
    const clientStateBase64 = body.data?.payload?.client_state

    console.log(`[Manual AMD Webhook] Event: ${eventType}, CallControlId: ${callControlId}`)

    // Decode client state
    let clientState: any = {}
    if (clientStateBase64) {
      try {
        clientState = JSON.parse(Buffer.from(clientStateBase64, 'base64').toString())
      } catch (e) {
        console.error('[Manual AMD Webhook] Failed to decode client_state')
      }
    }

    // Only process manual multi-call events
    if (clientState.type !== 'manual_multi_call') {
      return NextResponse.json({ received: true })
    }

    const pendingCall = pendingAMDCalls.get(callControlId)

    switch (eventType) {
      case 'call.initiated':
        if (pendingCall) {
          pendingCall.status = 'initiated'
        }
        break

      case 'call.ringing':
        if (pendingCall) {
          pendingCall.status = 'ringing'
        }
        console.log(`[Manual AMD Webhook] Call ringing`)
        break

      case 'call.answered':
        if (pendingCall) {
          pendingCall.status = 'answered'
        }
        console.log(`[Manual AMD Webhook] Call answered, waiting for AMD result`)
        break

      case 'call.machine.premium.detection.ended':
      case 'call.machine.detection.ended': {
        const result = body.data?.payload?.result?.toLowerCase()
        console.log(`[Manual AMD Webhook] AMD Result: ${result}`)

        // STRICT HUMAN DETECTION: Only connect on CONFIRMED human results
        // Premium AMD results: human_residence, human_business, machine, silence, fax_detected, not_sure
        // Standard AMD results: human, machine, fax, not_sure
        const isConfirmedHuman = result === 'human_residence' ||
                                  result === 'human_business' ||
                                  result === 'human'

        if (isConfirmedHuman) {
          // CONFIRMED Human detected - transfer to WebRTC
          console.log(`[Manual AMD Webhook] ✅ CONFIRMED Human detected (${result}), transferring to WebRTC`)

          if (pendingCall) {
            pendingCall.status = 'human_detected'
            pendingCall.amdResult = 'human'
          }

          // Transfer to WebRTC SIP endpoint
          const rtcLogin = process.env.TELNYX_RTC_LOGIN
          const sipDomain = process.env.TELNYX_RTC_SIP_DOMAIN || 'sip.telnyx.com'

          if (rtcLogin) {
            const sipUri = `sip:${rtcLogin}@${sipDomain}`
            await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${TELNYX_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: sipUri,
                from: pendingCall?.fromNumber,
              }),
            })
          }
        } else {
          // Everything else is treated as machine/voicemail to avoid false positives:
          // - 'machine' - obvious voicemail
          // - 'fax' / 'fax_detected' - fax machine
          // - 'silence' - no audio detected
          // - 'not_sure' - AMD couldn't determine, safer to treat as voicemail
          const reason = result === 'not_sure' ? 'uncertain (not_sure)' : result
          console.log(`[Manual AMD Webhook] ❌ Machine/Voicemail detected (${reason}), hanging up`)

          if (pendingCall) {
            pendingCall.status = 'machine_detected'
            pendingCall.amdResult = result === 'not_sure' ? 'uncertain' :
                                    result?.includes('fax') ? 'fax' : 'machine'
          }

          await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${TELNYX_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          })
        }
        break
      }

      case 'call.hangup':
        console.log(`[Manual AMD Webhook] Call hung up`)
        pendingAMDCalls.delete(callControlId)
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Manual AMD Webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

