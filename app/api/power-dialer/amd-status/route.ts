/**
 * AMD Status Polling Endpoint
 * 
 * Allows the frontend to poll for AMD call status updates.
 * Returns the current status of a call by callControlId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { pendingAMDCalls } from '@/lib/dialer/amd-calls-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const callControlId = searchParams.get('callControlId')

    if (!callControlId) {
      return NextResponse.json({ error: 'callControlId is required' }, { status: 400 })
    }

    const pendingCall = pendingAMDCalls.get(callControlId)

    if (!pendingCall) {
      // Call not found - might have been cleaned up or never existed
      return NextResponse.json({ 
        found: false,
        status: 'not_found',
        message: 'Call not found in pending calls'
      })
    }

    // Verify the call belongs to this user
    if (pendingCall.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Return the current status
    return NextResponse.json({
      found: true,
      callControlId,
      contactId: pendingCall.contactId,
      status: pendingCall.status,
      amdResult: pendingCall.amdResult,
      hangupCause: pendingCall.hangupCause,
      startedAt: pendingCall.startedAt,
    })

  } catch (error) {
    console.error('[AMD STATUS] Error:', error)
    return NextResponse.json({ error: 'Failed to get AMD status' }, { status: 500 })
  }
}

// POST to acknowledge/cleanup a call or mark as ended
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { callControlId, action } = body

    if (!callControlId) {
      return NextResponse.json({ error: 'callControlId is required' }, { status: 400 })
    }

    const pendingCall = pendingAMDCalls.get(callControlId)

    if (!pendingCall) {
      return NextResponse.json({ success: true, message: 'Call already cleaned up' })
    }

    // Verify the call belongs to this user
    if (pendingCall.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (action === 'cleanup') {
      // Remove from pending calls
      pendingAMDCalls.delete(callControlId)
      return NextResponse.json({ success: true, message: 'Call cleaned up' })
    }

    if (action === 'end') {
      // Mark call as ended (for client-side hangups)
      pendingCall.status = 'ended'
      return NextResponse.json({ success: true, message: 'Call marked as ended' })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('[AMD STATUS] Error:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}

