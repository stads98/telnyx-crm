"use client"

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react"
import type { Contact } from "@/lib/types"

// Types for multi-line manual dialer
export type MultiCallStatus = "ringing" | "connected" | "ended" | "failed"

export interface ManualDialerCall {
  id: string                    // Telnyx call ID / UUID
  contactId?: string            // CRM contact ID, if available
  contactName?: string          // Display name
  phoneNumber: string           // To number
  fromNumber: string            // Telnyx DID used as caller ID
  status: MultiCallStatus
  startedAt: number             // Timestamp
  endedAt?: number              // When the call ended
  telnyxCall?: any              // Reference to Telnyx SDK call object
  amdEnabled?: boolean          // Whether AMD is active for this call
  callControlId?: string        // Telnyx Call Control ID (for AMD calls)
  webrtcSessionId?: string      // WebRTC session ID (for transferred AMD calls)
}

const MAX_CONCURRENT = 8

type MultiCallContextType = {
  activeCalls: Map<string, ManualDialerCall>
  primaryCallId: string | null
  canStartNewCall: boolean
  startManualCall: (opts: {
    contact?: Contact
    toNumber: string
    fromNumber: string
  }) => Promise<string | null>
  restartCall: (oldCallId: string, opts: {
    contact?: Contact
    toNumber: string
    fromNumber: string
  }) => Promise<string | null>
  addInboundCall: (opts: {
    callId: string
    contact?: Contact
    callerNumber: string
    destinationNumber: string
  }) => void
  hangUpCall: (callId: string) => void
  hangUpAllCalls: () => void
  dismissCall: (callId: string) => void
  dismissAllEnded: () => void
  getCallCount: () => number
  switchPrimaryCall: (callId: string) => void
  closeAllCallWindows: () => void
}

const MultiCallContext = createContext<MultiCallContextType | undefined>(undefined)

export function MultiCallProvider({ children }: { children: React.ReactNode }) {
  const [activeCalls, setActiveCalls] = useState<Map<string, ManualDialerCall>>(new Map())
  const [primaryCallId, setPrimaryCallId] = useState<string | null>(null)
  const activeCallsRef = useRef(activeCalls)
  const primaryCallIdRef = useRef(primaryCallId)

  // Keep refs in sync
  useEffect(() => {
    activeCallsRef.current = activeCalls
    primaryCallIdRef.current = primaryCallId
  }, [activeCalls, primaryCallId])

  const canStartNewCall = activeCalls.size < MAX_CONCURRENT || 
    Array.from(activeCalls.values()).some(c => c.status === 'ended' || c.status === 'failed')

  const getCallCount = useCallback(() => {
    return Array.from(activeCallsRef.current.values())
      .filter(c => c.status === 'ringing' || c.status === 'connected').length
  }, [])

  // Handle when a call is answered - allow multiple connected calls
  // User can manually hang up whichever call they want
  const handleCallAnswered = useCallback((answeredCallId: string) => {
    console.log('[MultiCall] Call answered:', answeredCallId)

    // Update this call's status to connected
    setActiveCalls(prev => {
      const newMap = new Map(prev)
      const c = newMap.get(answeredCallId)
      if (c) newMap.set(answeredCallId, { ...c, status: 'connected' })
      return newMap
    })

    // If no primary call yet, set this as primary (for audio focus)
    if (!primaryCallIdRef.current) {
      setPrimaryCallId(answeredCallId)
    } else {
      // Multiple connected calls - user can switch between them
      console.log('[MultiCall] Multiple calls connected - user can switch between:', primaryCallIdRef.current, 'and', answeredCallId)
    }

    // Hang up all other RINGING calls (not connected ones)
    activeCallsRef.current.forEach((call, callId) => {
      if (callId !== answeredCallId && call.status === 'ringing') {
        console.log('[MultiCall] Auto-hanging up other ringing call:', callId)
        if (call.telnyxCall) {
          try { call.telnyxCall.hangup() } catch (e) { console.error('[MultiCall] Hangup error:', e) }
        }
        setActiveCalls(prev => {
          const newMap = new Map(prev)
          const c = newMap.get(callId)
          if (c) newMap.set(callId, { ...c, status: 'ended', endedAt: Date.now() })
          return newMap
        })
      }
    })
  }, [])

  // Handle call ended event
  const handleCallEnded = useCallback((callId: string) => {
    console.log('[MultiCall] Call ended:', callId)
    
    setActiveCalls(prev => {
      const newMap = new Map(prev)
      const c = newMap.get(callId)
      if (c && c.status !== 'ended') {
        newMap.set(callId, { ...c, status: 'ended', endedAt: Date.now() })
      }
      return newMap
    })

    if (primaryCallIdRef.current === callId) {
      setPrimaryCallId(null)
    }
  }, [])

  const startManualCall = useCallback(async (opts: {
    contact?: Contact
    toNumber: string
    fromNumber: string
  }): Promise<string | null> => {
    const activeCount = getCallCount()
    if (activeCount >= MAX_CONCURRENT) {
      console.log('[MultiCall] Max concurrent calls reached:', activeCount)
      return null
    }

    // Use AMD when there are already active calls (multi-line calling)
    const useAMD = activeCount >= 1

    try {
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')
      await rtcClient.ensureRegistered()

      if (useAMD) {
        // Use Call Control API with AMD for multi-line calls
        console.log('[MultiCall] Using AMD for multi-line call')

        // Enable power dialer mode for auto-answer when call transfers
        rtcClient.setPowerDialerMode(true)

        const amdRes = await fetch('/api/calls/manual-with-amd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: opts.contact?.id,
            contactName: opts.contact ? `${opts.contact.firstName || ''} ${opts.contact.lastName || ''}`.trim() : undefined,
            fromNumber: opts.fromNumber,
            toNumber: opts.toNumber,
          }),
        })

        if (!amdRes.ok) {
          const err = await amdRes.json()
          throw new Error(err.error || 'Failed to initiate AMD call')
        }

        const amdData = await amdRes.json()
        const callControlId = amdData.callControlId

        // Create call entry with AMD flag
        const newCall: ManualDialerCall = {
          id: callControlId,
          contactId: opts.contact?.id,
          contactName: opts.contact ? `${opts.contact.firstName || ''} ${opts.contact.lastName || ''}`.trim() : undefined,
          phoneNumber: opts.toNumber,
          fromNumber: opts.fromNumber,
          status: 'ringing',
          startedAt: Date.now(),
          amdEnabled: true,
          callControlId,
        }

        console.log('[MultiCall] Adding AMD call:', callControlId)
        setActiveCalls(prev => new Map(prev).set(callControlId, newCall))

        // Poll for AMD result
        const pollAMD = async () => {
          const maxPolls = 30 // 30 seconds max
          for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, 1000))

            const statusRes = await fetch(`/api/power-dialer/amd-status?callControlId=${callControlId}`)
            if (!statusRes.ok) continue

            const statusData = await statusRes.json()
            console.log('[MultiCall] AMD status:', statusData.status)

            if (statusData.status === 'human_detected') {
              // Human detected - the call will be transferred to WebRTC
              // Listen for incoming WebRTC call to get the call reference
              console.log('[MultiCall] Human detected, waiting for WebRTC transfer...')

              const handleTransferredCall = (info: { callId: string; call: any; callerNumber?: string }) => {
                console.log('[MultiCall] Received transferred call:', info.callId, 'for AMD call:', callControlId)

                // Update the call entry with WebRTC call reference
                setActiveCalls(prev => {
                  const newMap = new Map(prev)
                  const existingCall = newMap.get(callControlId)
                  if (existingCall) {
                    // Store the WebRTC call reference and session ID
                    newMap.set(callControlId, {
                      ...existingCall,
                      telnyxCall: info.call,
                      webrtcSessionId: info.callId,
                    })
                    console.log('[MultiCall] Updated AMD call with WebRTC reference:', callControlId, '->', info.callId)
                  }
                  return newMap
                })

                // Remove the listener
                rtcClient.off('inboundCall', handleTransferredCall)
              }

              // Listen for the incoming WebRTC call (from transfer)
              rtcClient.on('inboundCall', handleTransferredCall)

              // Timeout to remove listener after 10 seconds if no transfer
              setTimeout(() => {
                rtcClient.off('inboundCall', handleTransferredCall)
              }, 10000)

              handleCallAnswered(callControlId)
              return
            } else if (['machine_detected', 'voicemail', 'no_answer', 'failed', 'hangup'].includes(statusData.status)) {
              handleCallEnded(callControlId)
              return
            }
          }
          // Timeout - treat as failed
          handleCallEnded(callControlId)
        }
        pollAMD()

        return callControlId
      }

      // Standard WebRTC call (single call, no AMD)
      const result = await rtcClient.startCall({
        toNumber: opts.toNumber,
        fromNumber: opts.fromNumber
      })
      const callId = result.sessionId

      // Get reference to the specific call object from rtcClient's activeCalls map
      const telnyxCall = rtcClient.getCallById(callId)
      console.log('[MultiCall] Got telnyxCall for', callId, ':', !!telnyxCall)

      // Create call entry
      const newCall: ManualDialerCall = {
        id: callId,
        contactId: opts.contact?.id,
        contactName: opts.contact ? `${opts.contact.firstName || ''} ${opts.contact.lastName || ''}`.trim() : undefined,
        phoneNumber: opts.toNumber,
        fromNumber: opts.fromNumber,
        status: 'ringing',
        startedAt: Date.now(),
        telnyxCall,
        amdEnabled: false,
      }

      console.log('[MultiCall] Adding new call:', callId, 'Total will be:', activeCalls.size + 1)
      setActiveCalls(prev => new Map(prev).set(callId, newCall))

      // Log the call to database
      fetch('/api/telnyx/webrtc-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webrtcSessionId: callId,
          contactId: opts.contact?.id,
          fromNumber: opts.fromNumber,
          toNumber: opts.toNumber,
        })
      }).catch(err => console.error('[MultiCall] Failed to log call:', err))

      // Listen for call state changes
      const handleCallUpdate = (data: { state: string; callId: string }) => {
        if (data.callId !== callId) return

        console.log('[MultiCall] Call update for', callId, ':', data.state)

        if (data.state === 'active' || data.state === 'answering') {
          handleCallAnswered(callId)
        } else if (['hangup', 'destroy', 'failed', 'bye', 'cancel', 'rejected'].includes(data.state)) {
          handleCallEnded(callId)
          rtcClient.off('callUpdate', handleCallUpdate)
        }
      }
      rtcClient.on('callUpdate', handleCallUpdate)

      return callId
    } catch (error: any) {
      console.error('[MultiCall] Error starting call:', error)
      throw error
    }
  }, [getCallCount, handleCallAnswered, handleCallEnded])

  // Restart a call in the same window slot (for Call Back functionality)
  const restartCall = useCallback(async (oldCallId: string, opts: {
    contact?: Contact
    toNumber: string
    fromNumber: string
  }): Promise<string | null> => {
    try {
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')
      await rtcClient.ensureRegistered()

      // Remove old call entry first
      setActiveCalls(prev => {
        const newMap = new Map(prev)
        newMap.delete(oldCallId)
        return newMap
      })

      // Start the new call
      const result = await rtcClient.startCall({
        toNumber: opts.toNumber,
        fromNumber: opts.fromNumber
      })
      const callId = result.sessionId

      const telnyxCall = rtcClient.getCallById(callId)
      console.log('[MultiCall] Restart call - Got telnyxCall for', callId, ':', !!telnyxCall)

      // Create call entry
      const newCall: ManualDialerCall = {
        id: callId,
        contactId: opts.contact?.id,
        contactName: opts.contact ? `${opts.contact.firstName || ''} ${opts.contact.lastName || ''}`.trim() : undefined,
        phoneNumber: opts.toNumber,
        fromNumber: opts.fromNumber,
        status: 'ringing',
        startedAt: Date.now(),
        telnyxCall,
      }

      console.log('[MultiCall] Restarting call:', callId)
      setActiveCalls(prev => new Map(prev).set(callId, newCall))

      // Log to database
      fetch('/api/telnyx/webrtc-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webrtcSessionId: callId,
          contactId: opts.contact?.id,
          fromNumber: opts.fromNumber,
          toNumber: opts.toNumber,
        })
      }).catch(err => console.error('[MultiCall] Failed to log call:', err))

      // Listen for call state changes
      const handleCallUpdate = (data: { state: string; callId: string }) => {
        if (data.callId !== callId) return

        if (data.state === 'active' || data.state === 'answering') {
          handleCallAnswered(callId)
        } else if (['hangup', 'destroy', 'failed', 'bye', 'cancel', 'rejected'].includes(data.state)) {
          handleCallEnded(callId)
          rtcClient.off('callUpdate', handleCallUpdate)
        }
      }
      rtcClient.on('callUpdate', handleCallUpdate)

      return callId
    } catch (error: any) {
      console.error('[MultiCall] Error restarting call:', error)
      throw error
    }
  }, [handleCallAnswered, handleCallEnded])

  // Add an inbound call to the multi-call UI (for answered inbound calls)
  const addInboundCall = useCallback(async (opts: {
    callId: string
    contact?: Contact
    callerNumber: string
    destinationNumber: string
  }) => {
    console.log('[MultiCall] Adding inbound call:', opts.callId)

    const newCall: ManualDialerCall = {
      id: opts.callId,
      contactId: opts.contact?.id,
      contactName: opts.contact ? `${opts.contact.firstName || ''} ${opts.contact.lastName || ''}`.trim() : undefined,
      phoneNumber: opts.callerNumber, // The caller's number (who called us)
      fromNumber: opts.destinationNumber, // Our Telnyx number that was called
      status: 'connected', // Already connected since we answered
      startedAt: Date.now(),
    }

    setActiveCalls(prev => new Map(prev).set(opts.callId, newCall))
    setPrimaryCallId(opts.callId)

    // Set up listener for call end events
    try {
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')
      const handleCallUpdate = (data: { state: string; callId: string }) => {
        if (data.callId !== opts.callId) return
        if (['hangup', 'destroy', 'failed', 'bye', 'cancel', 'rejected'].includes(data.state)) {
          handleCallEnded(opts.callId)
          rtcClient.off('callUpdate', handleCallUpdate)
        }
      }
      rtcClient.on('callUpdate', handleCallUpdate)
    } catch (e) {
      console.error('[MultiCall] Error setting up inbound call listener:', e)
    }
  }, [handleCallEnded])

  const hangUpCall = useCallback(async (callId: string) => {
    const call = activeCallsRef.current.get(callId)
    if (!call) return

    console.log('[MultiCall] Hanging up call:', callId, {
      callControlId: call.callControlId,
      webrtcSessionId: call.webrtcSessionId,
      hasTelnyxCall: !!call.telnyxCall,
      amdEnabled: call.amdEnabled
    })

    let hangupSuccessful = false

    // Try WebRTC SDK hangup first (using the call object reference)
    if (call.telnyxCall) {
      try {
        call.telnyxCall.hangup()
        console.log('[MultiCall] WebRTC hangup via call object successful')
        hangupSuccessful = true
      } catch (e) {
        console.error('[MultiCall] WebRTC hangup via call object error:', e)
      }
    }

    // For AMD calls that were transferred: try rtcClient.hangup() with the WebRTC session ID
    if (!hangupSuccessful && call.webrtcSessionId) {
      try {
        const { rtcClient } = await import('@/lib/webrtc/rtc-client')
        console.log('[MultiCall] Trying rtcClient.hangup() with webrtcSessionId:', call.webrtcSessionId)
        await rtcClient.hangup(call.webrtcSessionId)
        console.log('[MultiCall] rtcClient.hangup() successful for webrtcSessionId:', call.webrtcSessionId)
        hangupSuccessful = true
      } catch (e) {
        console.error('[MultiCall] rtcClient.hangup() error:', e)
      }
    }

    // Fallback: Try server-side Call Control API hangup (for original PSTN leg)
    if (!hangupSuccessful && call.callControlId) {
      try {
        console.log('[MultiCall] Calling server-side hangup for callControlId:', call.callControlId)
        const response = await fetch('/api/telnyx/calls/hangup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telnyxCallId: call.callControlId })
        })
        if (response.ok) {
          console.log('[MultiCall] Server-side hangup successful')
          hangupSuccessful = true
        } else {
          console.error('[MultiCall] Server-side hangup failed:', await response.text())
        }
      } catch (e) {
        console.error('[MultiCall] Server-side hangup error:', e)
      }
    }

    // Last resort: Try rtcClient.hangup() without a specific session
    if (!hangupSuccessful) {
      try {
        const { rtcClient } = await import('@/lib/webrtc/rtc-client')
        console.log('[MultiCall] Last resort: trying rtcClient.hangup() for current call')
        await rtcClient.hangup()
        console.log('[MultiCall] Last resort rtcClient.hangup() completed')
      } catch (e) {
        console.error('[MultiCall] Last resort hangup error:', e)
      }
    }

    setActiveCalls(prev => {
      const newMap = new Map(prev)
      const c = newMap.get(callId)
      if (c) newMap.set(callId, { ...c, status: 'ended', endedAt: Date.now() })
      return newMap
    })

    if (primaryCallIdRef.current === callId) {
      setPrimaryCallId(null)
    }
  }, [])

  const hangUpAllCalls = useCallback(() => {
    activeCallsRef.current.forEach((call, callId) => {
      if (call.status === 'ringing' || call.status === 'connected') {
        hangUpCall(callId)
      }
    })
  }, [hangUpCall])

  // Dismiss a single call card (remove from UI)
  const dismissCall = useCallback((callId: string) => {
    setActiveCalls(prev => {
      const newMap = new Map(prev)
      newMap.delete(callId)
      return newMap
    })
  }, [])

  // Dismiss all ended/failed calls
  const dismissAllEnded = useCallback(() => {
    setActiveCalls(prev => {
      const newMap = new Map(prev)
      newMap.forEach((call, id) => {
        if (call.status === 'ended' || call.status === 'failed') {
          newMap.delete(id)
        }
      })
      return newMap
    })
  }, [])

  // Switch which call is primary (has audio focus)
  const switchPrimaryCall = useCallback(async (callId: string) => {
    const call = activeCallsRef.current.get(callId)
    if (!call || call.status !== 'connected') {
      console.warn('[MultiCall] Cannot switch to non-connected call:', callId)
      return
    }

    console.log('[MultiCall] Switching primary call to:', callId)
    setPrimaryCallId(callId)

    // Switch audio to this specific call
    try {
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')
      // Use the new switchAudioToCall method that actually switches to the specific call
      const switched = rtcClient.switchAudioToCall(callId)
      if (switched) {
        console.log('[MultiCall] ✓ Audio switched to call:', callId)
      } else {
        console.warn('[MultiCall] Failed to switch audio to call:', callId)
      }
    } catch (err) {
      console.error('[MultiCall] Error switching audio:', err)
    }
  }, [])

  // Hang up all calls and dismiss all windows after a delay
  const closeAllCallWindows = useCallback(() => {
    console.log('[MultiCall] Shift+X: Closing all call windows...')

    // First, hang up all active calls
    hangUpAllCalls()

    // Wait 1.5 seconds then dismiss all call windows
    setTimeout(() => {
      console.log('[MultiCall] Dismissing all call windows')
      setActiveCalls(new Map())
      setPrimaryCallId(null)
    }, 1500)
  }, [hangUpAllCalls])

  // Keyboard shortcut: Shift+X to close all call windows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shift+X to close all call windows
      if (e.shiftKey && e.key.toLowerCase() === 'x') {
        // Don't trigger if user is typing in an input/textarea
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }

        e.preventDefault()
        closeAllCallWindows()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeAllCallWindows])

  const value = {
    activeCalls,
    primaryCallId,
    canStartNewCall,
    startManualCall,
    restartCall,
    addInboundCall,
    hangUpCall,
    hangUpAllCalls,
    dismissCall,
    dismissAllEnded,
    getCallCount,
    switchPrimaryCall,
    closeAllCallWindows,
  }

  return (
    <MultiCallContext.Provider value={value}>
      {children}
    </MultiCallContext.Provider>
  )
}

export function useMultiCall() {
  const ctx = useContext(MultiCallContext)
  if (!ctx) throw new Error("useMultiCall must be used within MultiCallProvider")
  return ctx
}

