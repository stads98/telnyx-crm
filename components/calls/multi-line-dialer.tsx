"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, PhoneOutgoing,
  Play, Pause, Square, Users, Clock, CheckCircle2,
  Loader2, FileText, ChevronRight, RefreshCw
} from "lucide-react"
import { useCallUI } from "@/lib/context/call-ui-context"
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils"
import { cn } from "@/lib/utils"

// Types for multi-line dialer
export type DialerCallStatus =
  | 'idle'
  | 'queued'
  | 'dialing'
  | 'ringing'
  | 'amd_checking'
  | 'answered'
  | 'voicemail'
  | 'no-answer'
  | 'busy'
  | 'failed'
  | 'completed'
  | 'skipped'

export interface DialerContact {
  id: string
  contactId: string
  firstName: string
  lastName: string
  phone: string
  status: DialerCallStatus
  attemptCount: number
  maxAttempts: number
  lastAttemptAt?: Date
  callOutcome?: string
  notes?: string
}

export interface ActiveLeg {
  id: string
  contactId: string
  contact: DialerContact
  fromNumber: string
  toNumber: string
  status: 'initiated' | 'ringing' | 'amd_checking' | 'human_detected' | 'voicemail' | 'answered' | 'hangup'
  webrtcSessionId?: string
  callControlId?: string // For AMD calls
  amdResult?: 'human' | 'machine' | 'fax' | 'unknown'
  startedAt: number
  answeredAt?: number
  duration?: number
}

export interface DialerRunState {
  sessionId: string | null
  status: 'idle' | 'running' | 'paused' | 'completed' | 'stopped'
  maxLines: number
  selectedNumbers: string[]
  currentBatchIndex: number
  totalContacts: number
  stats: {
    totalCalls: number
    totalAnswered: number
    totalNoAnswer: number
    totalFailed: number
    totalTalkTime: number
  }
}

interface TelnyxPhoneNumber {
  id: string
  phoneNumber: string
  state?: string
  isActive: boolean
  capabilities: string[]
}

interface PowerDialerList {
  id: string
  name: string
  description?: string
  status: string
  totalContacts: number
  contactsCalled: number
  contactsAnswered: number
  scriptId?: string
  script?: {
    id: string
    name: string
    content: string
  }
  _count?: {
    contacts: number
    sessions: number
  }
}

interface MultiLineDialerProps {
  onCallAnswered?: (leg: ActiveLeg) => void
  onSessionComplete?: () => void
}

export default function MultiLineDialer({ onCallAnswered, onSessionComplete }: MultiLineDialerProps) {
  const { toast } = useToast()
  const { openCall, call: currentCall } = useCallUI()

  // Lists state
  const [lists, setLists] = useState<PowerDialerList[]>([])
  const [selectedList, setSelectedList] = useState<PowerDialerList | null>(null)
  const [loadingLists, setLoadingLists] = useState(false)

  // Phone numbers
  const [phoneNumbers, setPhoneNumbers] = useState<TelnyxPhoneNumber[]>([])
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([])

  // Dialer configuration
  // Note: WebRTC client only supports 1 call at a time, so we dial sequentially
  // but auto-advance through the queue
  const [maxLines, setMaxLines] = useState(1)
  const [autoAdvance, setAutoAdvance] = useState(true)

  // AMD (Answering Machine Detection) mode
  // When enabled, uses server-side Call Control API with AMD
  // Only connects to WebRTC when a human is detected
  const [amdEnabled, setAmdEnabled] = useState(true)

  // Run state
  const [runState, setRunState] = useState<DialerRunState>({
    sessionId: null,
    status: 'idle',
    maxLines: 1,
    selectedNumbers: [],
    currentBatchIndex: 0,
    totalContacts: 0,
    stats: {
      totalCalls: 0,
      totalAnswered: 0,
      totalNoAnswer: 0,
      totalFailed: 0,
      totalTalkTime: 0,
    }
  })

  // Queue and active calls - MUST be declared before refs that use them
  const [queue, setQueue] = useState<DialerContact[]>([])
  const [activeLegs, setActiveLegs] = useState<ActiveLeg[]>([])

  // Script display
  const [showScript, setShowScript] = useState(false)

  // Refs for accessing current values in async callbacks
  const runStateRef = useRef(runState)
  const queueRef = useRef(queue)
  const activeLegsRef = useRef(activeLegs)
  const autoAdvanceRef = useRef(autoAdvance)
  const amdEnabledRef = useRef(amdEnabled)

  // Keep refs in sync
  useEffect(() => { runStateRef.current = runState }, [runState])
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { activeLegsRef.current = activeLegs }, [activeLegs])
  useEffect(() => { autoAdvanceRef.current = autoAdvance }, [autoAdvance])
  useEffect(() => { amdEnabledRef.current = amdEnabled }, [amdEnabled])

  // Refs for polling and auto-scroll
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const queueScrollRef = useRef<HTMLDivElement>(null)
  const currentQueueIndexRef = useRef(0)

  // Track call listeners cleanup
  const callListenerCleanupRef = useRef<(() => void) | null>(null)

  // Load lists on mount
  useEffect(() => {
    loadLists()
    loadPhoneNumbers()
  }, [])

  // Auto-scroll queue to current item
  useEffect(() => {
    if (runState.status === 'running' && queueScrollRef.current) {
      const currentElement = queueScrollRef.current.querySelector(`[data-queue-index="${currentQueueIndexRef.current}"]`)
      if (currentElement) {
        currentElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [runState.currentBatchIndex, runState.status])

  const loadLists = async () => {
    setLoadingLists(true)
    try {
      const res = await fetch('/api/power-dialer/lists')
      if (res.ok) {
        const data = await res.json()
        setLists(data)
      }
    } catch (error) {
      console.error('Error loading lists:', error)
    } finally {
      setLoadingLists(false)
    }
  }

  const loadPhoneNumbers = async () => {
    try {
      const res = await fetch('/api/telnyx/phone-numbers')
      if (res.ok) {
        const data = await res.json()
        const voiceNumbers = data.filter((pn: TelnyxPhoneNumber) =>
          pn.capabilities.includes('VOICE') && pn.isActive
        )
        setPhoneNumbers(voiceNumbers)
        // Select all by default
        const allNumbers = voiceNumbers.map((pn: TelnyxPhoneNumber) => pn.phoneNumber)
        setSelectedNumbers(allNumbers)
        // Set max lines to half of available numbers
        setMaxLines(Math.max(1, Math.min(10, Math.floor(allNumbers.length / 2))))
      }
    } catch (error) {
      console.error('Error loading phone numbers:', error)
    }
  }

  const loadListContacts = async (listId: string) => {
    try {
      const res = await fetch(`/api/power-dialer/lists/${listId}/contacts`)
      if (res.ok) {
        const data = await res.json()
        const contacts: DialerContact[] = data.contacts.map((c: any) => ({
          id: c.id,
          contactId: c.contactId,
          firstName: c.contact.firstName || '',
          lastName: c.contact.lastName || '',
          phone: c.contact.phone1 || c.contact.phone2 || c.contact.phone3 || '',
          status: mapStatus(c.status),
          attemptCount: c.attemptCount || 0,
          maxAttempts: 3,
          lastAttemptAt: c.lastCalledAt ? new Date(c.lastCalledAt) : undefined,
        }))
        setQueue(contacts)
      }
    } catch (error) {
      console.error('Error loading list contacts:', error)
    }
  }

  const mapStatus = (dbStatus: string): DialerCallStatus => {
    const statusMap: Record<string, DialerCallStatus> = {
      'PENDING': 'queued',
      'CALLED': 'completed',
      'ANSWERED': 'answered',
      'NO_ANSWER': 'no-answer',
      'FAILED': 'failed',
    }
    return statusMap[dbStatus] || 'queued'
  }

  const selectList = async (list: PowerDialerList) => {
    setSelectedList(list)
    await loadListContacts(list.id)
    toast({ title: 'List Selected', description: `${list.name} - ${list.totalContacts} contacts` })
  }

  const toggleNumberSelection = (phoneNumber: string) => {
    setSelectedNumbers(prev => {
      if (prev.includes(phoneNumber)) {
        return prev.filter(n => n !== phoneNumber)
      }
      return [...prev, phoneNumber]
    })
  }

  // Start dialing session
  const startDialing = async () => {
    if (!selectedList) {
      toast({ title: 'Error', description: 'Please select a list first', variant: 'destructive' })
      return
    }
    if (selectedNumbers.length === 0) {
      toast({ title: 'Error', description: 'Please select at least one phone number', variant: 'destructive' })
      return
    }
    if (queue.filter(c => c.status === 'queued').length === 0) {
      toast({ title: 'Error', description: 'No contacts to call in queue', variant: 'destructive' })
      return
    }

    try {
      // Create session
      const res = await fetch('/api/power-dialer/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: selectedList.id,
          selectedNumbers,
          concurrentLines: maxLines,
        })
      })

      if (!res.ok) throw new Error('Failed to create session')

      const { session } = await res.json()

      setRunState(prev => ({
        ...prev,
        sessionId: session.id,
        status: 'running',
        maxLines,
        selectedNumbers,
        totalContacts: queue.length,
      }))

      // Start the dialing engine
      await fetch('/api/power-dialer/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, action: 'start' })
      })

      // Start polling for status updates
      startPolling(session.id)

      // Start making calls
      dialNextBatch(session.id)

      toast({ title: 'Dialer Started', description: `Calling ${queue.length} contacts with ${maxLines} lines` })
    } catch (error: any) {
      console.error('Error starting dialer:', error)
      toast({ title: 'Error', description: error.message || 'Failed to start dialer', variant: 'destructive' })
    }
  }

  // Dial next contact in queue (sequential dialing due to WebRTC single-call limitation)
  const dialNextBatch = async (sessionId: string) => {
    const currentRunState = runStateRef.current
    if (currentRunState.status !== 'running' && currentRunState.status !== 'idle') return

    // Only dial if no active calls (WebRTC supports 1 call at a time)
    if (activeLegsRef.current.length > 0) return

    const pendingContacts = queueRef.current.filter(c => c.status === 'queued')
    if (pendingContacts.length === 0) return

    // Dial the next contact
    const nextContact = pendingContacts[0]
    await initiateCall(sessionId, nextContact)
  }

  // Initiate a single call
  const initiateCall = async (sessionId: string, contact: DialerContact) => {
    if (!contact.phone) {
      updateContactStatus(contact.id, 'failed')
      return
    }

    // Select from number (round-robin)
    const currentStats = runStateRef.current.stats
    const currentNumbers = runStateRef.current.selectedNumbers
    const fromNumber = currentNumbers[currentStats.totalCalls % currentNumbers.length] || selectedNumbers[0]

    try {
      // Update contact status to dialing
      updateContactStatus(contact.id, 'dialing')

      // Check if AMD mode is enabled
      if (amdEnabledRef.current) {
        // Use server-side Call Control API with AMD
        await initiateAMDCall(sessionId, contact, fromNumber)
      } else {
        // Use direct WebRTC call (no AMD)
        await initiateWebRTCCall(sessionId, contact, fromNumber)
      }

    } catch (error) {
      console.error('Error initiating call:', error)
      updateContactStatus(contact.id, 'failed')
    }
  }

  // Initiate call with AMD (server-side Call Control API)
  const initiateAMDCall = async (sessionId: string, contact: DialerContact, fromNumber: string) => {
    // Create active leg with AMD checking status
    const leg: ActiveLeg = {
      id: `leg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contactId: contact.contactId,
      contact,
      fromNumber,
      toNumber: contact.phone,
      status: 'initiated',
      startedAt: Date.now(),
    }

    setActiveLegs(prev => [...prev, leg])

    // Initiate call via AMD API
    const res = await fetch('/api/power-dialer/call-with-amd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        queueItemId: contact.id,
        contactId: contact.contactId,
        fromNumber,
        toNumber: contact.phone,
      })
    })

    if (!res.ok) {
      throw new Error('Failed to initiate AMD call')
    }

    const { callControlId } = await res.json()

    // Update leg with call control ID
    setActiveLegs(prev => prev.map(l =>
      l.id === leg.id ? { ...l, callControlId, status: 'amd_checking' as const } : l
    ))

    // Update contact status
    updateContactStatus(contact.id, 'amd_checking')

    // Update stats
    setRunState(prev => ({
      ...prev,
      stats: { ...prev.stats, totalCalls: prev.stats.totalCalls + 1 }
    }))

    // Start polling for AMD result
    pollAMDResult(leg.id, contact.id, callControlId, sessionId)
  }

  // Poll for AMD result
  const pollAMDResult = async (legId: string, queueItemId: string, callControlId: string, sessionId: string) => {
    let attempts = 0
    const maxAttempts = 60 // 30 seconds max (500ms intervals)

    const poll = async () => {
      attempts++

      try {
        const res = await fetch(`/api/power-dialer/calls?queueItemId=${queueItemId}&callControlId=${callControlId}`)
        if (!res.ok) return

        const call = await res.json()

        if (call.status === 'VOICEMAIL' || call.amdResult?.includes('machine')) {
          // Voicemail detected - update UI and move to next
          console.log('[AMD] Voicemail detected, moving to next contact')

          setActiveLegs(prev => prev.map(l =>
            l.id === legId ? { ...l, status: 'voicemail' as const, amdResult: 'machine' } : l
          ))
          updateContactStatus(queueItemId, 'voicemail')

          // Update stats
          setRunState(prev => ({
            ...prev,
            stats: { ...prev.stats, totalNoAnswer: prev.stats.totalNoAnswer + 1 }
          }))

          // Remove leg after brief display
          setTimeout(() => {
            setActiveLegs(prev => prev.filter(l => l.id !== legId))
            // Auto-advance to next contact
            if (autoAdvanceRef.current && runStateRef.current.status === 'running') {
              dialNextBatch(sessionId)
            }
          }, 2000)

          return // Stop polling
        }

        if (call.status === 'HUMAN_DETECTED' || call.amdResult === 'human') {
          // Human detected - connect via WebRTC
          console.log('[AMD] Human detected, connecting via WebRTC')

          setActiveLegs(prev => prev.map(l =>
            l.id === legId ? { ...l, status: 'human_detected' as const, amdResult: 'human' } : l
          ))

          // Now connect via WebRTC
          const currentLeg = activeLegsRef.current.find(l => l.id === legId)
          if (currentLeg) {
            await connectToHumanCall(currentLeg, sessionId)
          }

          return // Stop polling
        }

        if (call.status === 'ENDED' || call.status === 'FAILED') {
          // Call ended without answer
          console.log('[AMD] Call ended:', call.hangupCause)

          const outcome = call.callOutcome || 'NO_ANSWER'
          const status = outcome === 'BUSY' ? 'busy' : 'no-answer'

          setActiveLegs(prev => prev.filter(l => l.id !== legId))
          updateContactStatus(queueItemId, status as DialerCallStatus)

          setRunState(prev => ({
            ...prev,
            stats: { ...prev.stats, totalNoAnswer: prev.stats.totalNoAnswer + 1 }
          }))

          // Auto-advance
          if (autoAdvanceRef.current && runStateRef.current.status === 'running') {
            dialNextBatch(sessionId)
          }

          return // Stop polling
        }

        // Continue polling if still in progress
        if (attempts < maxAttempts && runStateRef.current.status === 'running') {
          setTimeout(poll, 500)
        }
      } catch (error) {
        console.error('[AMD] Polling error:', error)
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000)
        }
      }
    }

    poll()
  }

  // Connect to a call where human was detected
  const connectToHumanCall = async (leg: ActiveLeg, sessionId: string) => {
    try {
      // Start WebRTC call to the same number
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')
      await rtcClient.ensureRegistered()
      const { sessionId: webrtcSessionId } = await rtcClient.startCall({
        toNumber: leg.toNumber,
        fromNumber: leg.fromNumber
      })

      // Update leg with WebRTC session
      setActiveLegs(prev => prev.map(l =>
        l.id === leg.id ? { ...l, webrtcSessionId, status: 'answered' as const, answeredAt: Date.now() } : l
      ))
      updateContactStatus(leg.contact.id, 'answered')

      // Update stats
      setRunState(prev => ({
        ...prev,
        stats: { ...prev.stats, totalAnswered: prev.stats.totalAnswered + 1 }
      }))

      // Setup call listeners
      setupCallListeners({ ...leg, webrtcSessionId, status: 'answered' }, sessionId)

    } catch (error) {
      console.error('[AMD] Error connecting to human call:', error)
      setActiveLegs(prev => prev.filter(l => l.id !== leg.id))
      updateContactStatus(leg.contact.id, 'failed')
    }
  }

  // Initiate direct WebRTC call (no AMD)
  const initiateWebRTCCall = async (sessionId: string, contact: DialerContact, fromNumber: string) => {
    // Start WebRTC call
    const { rtcClient } = await import('@/lib/webrtc/rtc-client')
    await rtcClient.ensureRegistered()
    const { sessionId: webrtcSessionId } = await rtcClient.startCall({
      toNumber: contact.phone,
      fromNumber
    })

    // Create active leg
    const leg: ActiveLeg = {
      id: `leg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contactId: contact.contactId,
      contact,
      fromNumber,
      toNumber: contact.phone,
      status: 'initiated',
      webrtcSessionId,
      startedAt: Date.now(),
    }

    setActiveLegs(prev => [...prev, leg])

    // Log call to database
    await fetch('/api/power-dialer/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        queueItemId: contact.id,
        contactId: contact.contactId,
        fromNumber,
        toNumber: contact.phone,
        webrtcSessionId,
      })
    })

    // Update stats
    setRunState(prev => ({
      ...prev,
      stats: { ...prev.stats, totalCalls: prev.stats.totalCalls + 1 }
    }))

    // Setup call event listeners
    setupCallListeners(leg, sessionId)
  }

  // Setup listeners for call events using proper event subscription
  const setupCallListeners = async (leg: ActiveLeg, sessionId: string) => {
    let isAnswered = false
    let isEnded = false
    let ringTimeout: NodeJS.Timeout | null = null

    try {
      const { rtcClient } = await import('@/lib/webrtc/rtc-client')

      // Handler for call state updates
      const handleCallUpdate = (event: { state: string; callId?: string; direction?: string }) => {
        if (isEnded) return

        const { state, callId } = event
        console.log(`[PowerDialer] Call update: state=${state}, callId=${callId}, legCallId=${leg.webrtcSessionId}`)

        // Only process events for this specific call
        // Match by callId if available, otherwise process all (for single-line mode)
        if (callId && leg.webrtcSessionId && callId !== leg.webrtcSessionId) {
          return
        }

        // Check if call was answered
        if (state === 'active' && !isAnswered) {
          isAnswered = true
          console.log(`[PowerDialer] Call ANSWERED: ${leg.contact.firstName} ${leg.contact.lastName}`)

          // Clear ring timeout
          if (ringTimeout) {
            clearTimeout(ringTimeout)
            ringTimeout = null
          }

          // Handle first-answer-wins logic
          handleFirstAnswerWins(leg, sessionId)
        }

        // Check if call ended (remote hangup, busy, failed, etc.)
        const endStates = ['hangup', 'destroy', 'failed', 'bye', 'cancel', 'rejected']
        if (endStates.includes(state)) {
          console.log(`[PowerDialer] Call ENDED: state=${state}, wasAnswered=${isAnswered}`)
          isEnded = true

          // Clear ring timeout
          if (ringTimeout) {
            clearTimeout(ringTimeout)
            ringTimeout = null
          }

          // Remove event listener
          rtcClient.off('callUpdate', handleCallUpdate)

          // Handle call ended
          handleCallEnded(leg, sessionId, isAnswered)
        }
      }

      // Subscribe to call updates
      rtcClient.on('callUpdate', handleCallUpdate)

      // Store cleanup function
      callListenerCleanupRef.current = () => {
        rtcClient.off('callUpdate', handleCallUpdate)
        if (ringTimeout) {
          clearTimeout(ringTimeout)
        }
      }

      // Timeout after 30 seconds of ringing (no answer)
      ringTimeout = setTimeout(() => {
        if (!isAnswered && !isEnded) {
          console.log(`[PowerDialer] Ring timeout (30s) - no answer`)
          isEnded = true
          rtcClient.off('callUpdate', handleCallUpdate)

          // Try to hang up the call
          rtcClient.hangup(leg.webrtcSessionId).catch(() => {})

          handleCallEnded(leg, sessionId, false)
        }
      }, 30000)

      // Also poll as a backup in case events are missed
      const backupCheckInterval = setInterval(async () => {
        if (isEnded) {
          clearInterval(backupCheckInterval)
          return
        }

        // Check if call is still active
        const callState = rtcClient.getCallState()
        if (!callState && !isEnded) {
          console.log(`[PowerDialer] Backup check: no active call found, ending leg`)
          isEnded = true
          clearInterval(backupCheckInterval)
          rtcClient.off('callUpdate', handleCallUpdate)
          if (ringTimeout) {
            clearTimeout(ringTimeout)
          }
          handleCallEnded(leg, sessionId, isAnswered)
        }
      }, 2000) // Check every 2 seconds

      // Clean up backup interval when call ends
      const originalCleanup = callListenerCleanupRef.current
      callListenerCleanupRef.current = () => {
        originalCleanup?.()
        clearInterval(backupCheckInterval)
      }

    } catch (error) {
      console.error('[PowerDialer] Error setting up call listeners:', error)
      isEnded = true
      handleCallEnded(leg, sessionId, false)
    }
  }

  // Handle first-answer-wins logic
  const handleFirstAnswerWins = async (answeredLeg: ActiveLeg, sessionId: string) => {
    // Update the answered leg
    setActiveLegs(prev => prev.map(l =>
      l.id === answeredLeg.id
        ? { ...l, status: 'answered' as const, answeredAt: Date.now() }
        : l
    ))

    // Note: Since we're doing sequential dialing (1 call at a time), there shouldn't
    // be other legs to hang up, but keeping this logic for future multi-line support

    // Update answered contact status
    updateContactStatus(answeredLeg.contact.id, 'answered')

    // Update stats
    setRunState(prev => ({
      ...prev,
      stats: { ...prev.stats, totalAnswered: prev.stats.totalAnswered + 1 }
    }))

    // Notify parent and open call UI
    onCallAnswered?.(answeredLeg)
    openCall({
      contact: {
        id: answeredLeg.contactId,
        firstName: answeredLeg.contact.firstName,
        lastName: answeredLeg.contact.lastName,
      } as any,
      fromNumber: answeredLeg.fromNumber,
      toNumber: answeredLeg.toNumber,
      mode: 'webrtc',
      webrtcSessionId: answeredLeg.webrtcSessionId,
    })

    toast({
      title: 'Call Connected',
      description: `${answeredLeg.contact.firstName} ${answeredLeg.contact.lastName} answered`,
    })
  }

  // Handle call ended
  const handleCallEnded = (leg: ActiveLeg, sessionId: string, wasAnswered: boolean) => {
    // Remove from active legs
    setActiveLegs(prev => prev.filter(l => l.id !== leg.id))

    if (wasAnswered) {
      // Calculate duration
      const duration = leg.answeredAt ? Math.floor((Date.now() - leg.answeredAt) / 1000) : 0
      setRunState(prev => ({
        ...prev,
        stats: { ...prev.stats, totalTalkTime: prev.stats.totalTalkTime + duration }
      }))
      updateContactStatus(leg.contact.id, 'completed')
    } else {
      updateContactStatus(leg.contact.id, 'no-answer')
      setRunState(prev => ({
        ...prev,
        stats: { ...prev.stats, totalNoAnswer: prev.stats.totalNoAnswer + 1 }
      }))
    }

    // Check if we should dial more (auto-advance) - use refs for current values
    const currentAutoAdvance = autoAdvanceRef.current
    const currentRunState = runStateRef.current
    if (currentAutoAdvance && currentRunState.status === 'running' && currentRunState.sessionId) {
      setTimeout(() => dialNextBatch(currentRunState.sessionId!), 1500) // 1.5s delay between calls
    }

    // Check if session is complete - use refs for current values
    setTimeout(() => {
      const remainingContacts = queueRef.current.filter(c => c.status === 'queued').length
      const currentLegs = activeLegsRef.current
      if (remainingContacts === 0 && currentLegs.length === 0) {
        completeSession()
      }
    }, 100)
  }

  // Update contact status in queue
  const updateContactStatus = (contactId: string, status: DialerCallStatus) => {
    setQueue(prev => {
      const updated = prev.map(c => c.id === contactId ? { ...c, status } : c)
      // Update current queue index ref
      currentQueueIndexRef.current = updated.findIndex(c => c.status === 'queued')
      return updated
    })
  }

  // Polling for session status
  const startPolling = (sessionId: string) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/power-dialer/session?sessionId=${sessionId}`)
        if (res.ok) {
          const data = await res.json()
          // Update stats from server
          if (data.session) {
            setRunState(prev => ({
              ...prev,
              stats: {
                totalCalls: data.session.totalCalls || prev.stats.totalCalls,
                totalAnswered: data.session.totalAnswered || prev.stats.totalAnswered,
                totalNoAnswer: data.session.totalNoAnswer || prev.stats.totalNoAnswer,
                totalFailed: prev.stats.totalFailed,
                totalTalkTime: data.session.totalTalkTime || prev.stats.totalTalkTime,
              }
            }))
          }
        }
      } catch (error) {
        console.error('Error polling session:', error)
      }
    }, 2000)
  }

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  // Pause dialing
  const pauseDialing = async () => {
    setRunState(prev => ({ ...prev, status: 'paused' }))

    const currentSessionId = runStateRef.current.sessionId
    if (currentSessionId) {
      await fetch('/api/power-dialer/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, action: 'pause' })
      })
    }

    toast({ title: 'Dialer Paused', description: 'No new calls will be initiated' })
  }

  // Resume dialing
  const resumeDialing = async () => {
    setRunState(prev => ({ ...prev, status: 'running' }))

    const currentSessionId = runStateRef.current.sessionId
    if (currentSessionId) {
      await fetch('/api/power-dialer/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, action: 'resume' })
      })
      // Small delay to ensure state is updated before dialing
      setTimeout(() => dialNextBatch(currentSessionId), 100)
    }

    toast({ title: 'Dialer Resumed', description: 'Continuing to dial contacts' })
  }

  // Stop dialing
  const stopDialing = async () => {
    stopPolling()

    // Clean up call listeners
    if (callListenerCleanupRef.current) {
      callListenerCleanupRef.current()
      callListenerCleanupRef.current = null
    }

    // Hang up current call if any
    if (activeLegsRef.current.length > 0) {
      try {
        const { rtcClient } = await import('@/lib/webrtc/rtc-client')
        await rtcClient.hangup()
      } catch (error) {
        console.error('Error hanging up:', error)
      }
    }

    setActiveLegs([])
    setRunState(prev => ({ ...prev, status: 'stopped' }))

    const currentSessionId = runStateRef.current.sessionId
    if (currentSessionId) {
      await fetch('/api/power-dialer/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, action: 'stop' })
      })
    }

    toast({ title: 'Dialer Stopped', description: 'All calls have been terminated' })
  }

  // Skip current contact and move to next
  const skipCurrentContact = async () => {
    const pendingContacts = queueRef.current.filter(c => c.status === 'queued')
    if (pendingContacts.length === 0) return

    const contactToSkip = pendingContacts[0]
    updateContactStatus(contactToSkip.id, 'skipped')

    toast({ title: 'Contact Skipped', description: `${contactToSkip.firstName} ${contactToSkip.lastName}` })

    // If running and auto-advance, dial next
    const currentRunState = runStateRef.current
    if (currentRunState.status === 'running' && currentRunState.sessionId && autoAdvanceRef.current) {
      setTimeout(() => dialNextBatch(currentRunState.sessionId!), 500)
    }
  }

  // Manually dial next contact (when paused or auto-advance is off)
  const dialNextManually = async () => {
    const currentRunState = runStateRef.current
    if (!currentRunState.sessionId) return
    if (activeLegsRef.current.length > 0) {
      toast({ title: 'Call in Progress', description: 'End the current call first', variant: 'destructive' })
      return
    }
    await dialNextBatch(currentRunState.sessionId)
  }

  // Complete session
  const completeSession = async () => {
    stopPolling()
    setRunState(prev => ({ ...prev, status: 'completed' }))

    const currentSessionId = runStateRef.current.sessionId
    if (currentSessionId) {
      await fetch('/api/power-dialer/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, action: 'complete' })
      })
    }

    const stats = runStateRef.current.stats
    toast({
      title: 'Session Complete',
      description: `Called ${stats.totalCalls} contacts, ${stats.totalAnswered} answered`
    })
    onSessionComplete?.()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
      // Clean up any active call listeners
      if (callListenerCleanupRef.current) {
        callListenerCleanupRef.current()
        callListenerCleanupRef.current = null
      }
    }
  }, [])

  // Format time helper
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Get status color
  const getStatusColor = (status: DialerCallStatus) => {
    const colors: Record<DialerCallStatus, string> = {
      'idle': 'bg-gray-100 text-gray-600',
      'queued': 'bg-blue-100 text-blue-600',
      'dialing': 'bg-yellow-100 text-yellow-600',
      'ringing': 'bg-orange-100 text-orange-600',
      'amd_checking': 'bg-cyan-100 text-cyan-600',
      'answered': 'bg-green-100 text-green-600',
      'voicemail': 'bg-purple-100 text-purple-600',
      'no-answer': 'bg-red-100 text-red-600',
      'busy': 'bg-red-100 text-red-600',
      'failed': 'bg-red-100 text-red-600',
      'completed': 'bg-green-100 text-green-600',
      'skipped': 'bg-gray-100 text-gray-600',
    }
    return colors[status] || 'bg-gray-100 text-gray-600'
  }

  const getStatusIcon = (status: DialerCallStatus) => {
    switch (status) {
      case 'dialing':
      case 'ringing':
        return <PhoneOutgoing className="h-4 w-4 animate-pulse" />
      case 'amd_checking':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'answered':
        return <PhoneCall className="h-4 w-4" />
      case 'completed':
        return <CheckCircle2 className="h-4 w-4" />
      case 'voicemail':
        return <PhoneOff className="h-4 w-4" />
      case 'no-answer':
      case 'busy':
      case 'failed':
        return <PhoneMissed className="h-4 w-4" />
      default:
        return <Phone className="h-4 w-4" />
    }
  }

  // Calculate progress
  const completedCount = queue.filter(c => ['completed', 'answered', 'no-answer', 'failed', 'busy'].includes(c.status)).length
  const progressPercent = queue.length > 0 ? (completedCount / queue.length) * 100 : 0

  return (
    <div className="flex h-full gap-4 p-4 bg-gray-50 dark:bg-gray-900">
      {/* Column 1: Lists & Configuration */}
      <div className="w-80 flex flex-col gap-4">
        {/* Stats Card */}
        <Card className="shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Session Stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{runState.stats.totalCalls}</div>
              <div className="text-xs text-gray-500">Calls Made</div>
            </div>
            <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{runState.stats.totalAnswered}</div>
              <div className="text-xs text-gray-500">Answered</div>
            </div>
            <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{runState.stats.totalNoAnswer}</div>
              <div className="text-xs text-gray-500">No Answer</div>
            </div>
            <div className="text-center p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">{formatTime(runState.stats.totalTalkTime)}</div>
              <div className="text-xs text-gray-500">Talk Time</div>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Card */}
        <Card className="shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AMD Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Voicemail Detection</label>
                <p className="text-xs text-gray-500">Skip voicemails, only connect to live people</p>
              </div>
              <Checkbox
                checked={amdEnabled}
                onCheckedChange={(checked) => setAmdEnabled(checked as boolean)}
                disabled={runState.status === 'running'}
              />
            </div>

            {/* Auto-Advance Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Auto-Advance</label>
                <p className="text-xs text-gray-500">Automatically dial next contact when call ends</p>
              </div>
              <Checkbox
                checked={autoAdvance}
                onCheckedChange={(checked) => setAutoAdvance(checked as boolean)}
                disabled={runState.status === 'running'}
              />
            </div>

            {/* Phone Numbers */}
            <div>
              <label className="text-sm font-medium mb-2 block">Caller ID ({selectedNumbers.length} available)</label>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {phoneNumbers.map((pn, idx) => (
                  <div key={pn.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                    <Checkbox
                      checked={selectedNumbers.includes(pn.phoneNumber)}
                      onCheckedChange={() => toggleNumberSelection(pn.phoneNumber)}
                      disabled={runState.status === 'running'}
                    />
                    <span className="text-sm">{formatPhoneNumberForDisplay(pn.phoneNumber)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Caller ID rotates through selected numbers
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Lists Card */}
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Call Lists</CardTitle>
              <Button variant="ghost" size="sm" onClick={loadLists} disabled={loadingLists}>
                <RefreshCw className={cn("h-4 w-4", loadingLists && "animate-spin")} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
            <ScrollArea className="h-full">
              <div className="p-4 pt-0 space-y-2">
                {lists.map(list => (
                  <div
                    key={list.id}
                    onClick={() => runState.status === 'idle' && selectList(list)}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-all",
                      selectedList?.id === list.id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "hover:border-gray-300 dark:hover:border-gray-600",
                      runState.status !== 'idle' && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{list.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {list._count?.contacts || list.totalContacts} contacts
                      </Badge>
                    </div>
                    {list.script && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <FileText className="h-3 w-3" />
                        {list.script.name}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        {list.contactsAnswered}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3 text-blue-500" />
                        {list.contactsCalled}
                      </span>
                    </div>
                  </div>
                ))}
                {lists.length === 0 && !loadingLists && (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No call lists yet</p>
                    <p className="text-xs">Create a list from the Lists Manager</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Column 2: Active Calls Panel */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Controls Bar */}
        <Card className="shrink-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {runState.status === 'idle' ? (
                  <Button
                    onClick={startDialing}
                    disabled={!selectedList || selectedNumbers.length === 0}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Start Dialing
                  </Button>
                ) : runState.status === 'running' ? (
                  <>
                    <Button onClick={pauseDialing} variant="outline">
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </Button>
                    <Button
                      onClick={skipCurrentContact}
                      variant="outline"
                      disabled={activeLegs.length > 0 || queue.filter(c => c.status === 'queued').length === 0}
                    >
                      <ChevronRight className="h-4 w-4 mr-2" />
                      Skip
                    </Button>
                    <Button onClick={stopDialing} variant="destructive">
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </Button>
                  </>
                ) : runState.status === 'paused' ? (
                  <>
                    <Button onClick={resumeDialing} className="bg-green-600 hover:bg-green-700">
                      <Play className="h-4 w-4 mr-2" />
                      Resume
                    </Button>
                    <Button
                      onClick={dialNextManually}
                      variant="outline"
                      disabled={activeLegs.length > 0 || queue.filter(c => c.status === 'queued').length === 0}
                    >
                      <ChevronRight className="h-4 w-4 mr-2" />
                      Dial Next
                    </Button>
                    <Button
                      onClick={skipCurrentContact}
                      variant="outline"
                      disabled={queue.filter(c => c.status === 'queued').length === 0}
                    >
                      Skip
                    </Button>
                    <Button onClick={stopDialing} variant="destructive">
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setRunState(prev => ({ ...prev, status: 'idle', sessionId: null }))}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    New Session
                  </Button>
                )}
              </div>

              {/* Progress */}
              <div className="flex items-center gap-4">
                <div className="text-sm text-gray-500">
                  {completedCount} / {queue.length} contacts
                </div>
                <div className="w-48">
                  <Progress value={progressPercent} className="h-2" />
                </div>
                <div className="text-sm font-medium">
                  {Math.round(progressPercent)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Call Panel */}
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <PhoneCall className="h-4 w-4" />
                Current Call
              </CardTitle>
              {runState.status === 'running' && activeLegs.length === 0 && (
                <Badge variant="default" className="bg-blue-600 animate-pulse">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Dialing...
                </Badge>
              )}
              {activeLegs.length > 0 && activeLegs[0].status === 'answered' && (
                <Badge variant="default" className="bg-green-600">
                  <PhoneCall className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              )}
              {activeLegs.length > 0 && activeLegs[0].status === 'amd_checking' && (
                <Badge variant="outline" className="border-cyan-500 text-cyan-600 animate-pulse">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Checking...
                </Badge>
              )}
              {activeLegs.length > 0 && activeLegs[0].status === 'human_detected' && (
                <Badge variant="default" className="bg-green-500 animate-pulse">
                  <PhoneCall className="h-3 w-3 mr-1" />
                  Human Detected!
                </Badge>
              )}
              {activeLegs.length > 0 && activeLegs[0].status === 'voicemail' && (
                <Badge variant="outline" className="border-purple-500 text-purple-600">
                  <PhoneOff className="h-3 w-3 mr-1" />
                  Voicemail
                </Badge>
              )}
              {activeLegs.length > 0 && !['answered', 'amd_checking', 'human_detected', 'voicemail'].includes(activeLegs[0].status) && (
                <Badge variant="outline" className="border-yellow-500 text-yellow-600 animate-pulse">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Ringing
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden flex items-center justify-center">
            {activeLegs.length > 0 ? (
              <div
                className={cn(
                  "w-full max-w-md p-6 rounded-xl border-2 transition-all",
                  activeLegs[0].status === 'answered'
                    ? "border-green-500 bg-green-50 dark:bg-green-900/20 ring-2 ring-green-500/50"
                    : activeLegs[0].status === 'amd_checking'
                    ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20 animate-pulse"
                    : activeLegs[0].status === 'human_detected'
                    ? "border-green-400 bg-green-50 dark:bg-green-900/20 animate-pulse"
                    : activeLegs[0].status === 'voicemail'
                    ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                    : "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 animate-pulse"
                )}
              >
                <div className="text-center mb-4">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <span className="text-2xl font-bold text-gray-600 dark:text-gray-300">
                      {activeLegs[0].contact.firstName?.[0]}{activeLegs[0].contact.lastName?.[0]}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold">
                    {activeLegs[0].contact.firstName} {activeLegs[0].contact.lastName}
                  </h3>
                  <p className="text-gray-500">
                    {formatPhoneNumberForDisplay(activeLegs[0].toNumber)}
                  </p>
                  {/* AMD Status Indicator */}
                  {activeLegs[0].status === 'amd_checking' && (
                    <p className="text-cyan-600 text-sm mt-2 flex items-center justify-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Detecting voicemail...
                    </p>
                  )}
                  {activeLegs[0].status === 'voicemail' && (
                    <p className="text-purple-600 text-sm mt-2 font-medium">
                      📞 Voicemail Detected - Skipping
                    </p>
                  )}
                  {activeLegs[0].status === 'human_detected' && (
                    <p className="text-green-600 text-sm mt-2 font-medium">
                      ✓ Human Detected - Connecting...
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                  <span>From: {formatPhoneNumberForDisplay(activeLegs[0].fromNumber)}</span>
                  {activeLegs[0].answeredAt && (
                    <span className="flex items-center gap-1 text-green-600 font-medium">
                      <Clock className="h-4 w-4" />
                      {formatTime(Math.floor((Date.now() - activeLegs[0].answeredAt) / 1000))}
                    </span>
                  )}
                </div>

                {activeLegs[0].status === 'answered' && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        const { rtcClient } = await import('@/lib/webrtc/rtc-client')
                        await rtcClient.hangup()
                      }}
                    >
                      <PhoneOff className="h-4 w-4 mr-2" />
                      End Call
                    </Button>
                  </div>
                )}
              </div>
            ) : runState.status === 'idle' ? (
              <div className="text-center text-gray-500">
                <PhoneCall className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">No Active Call</p>
                <p className="text-sm">Select a list and start dialing to begin</p>
              </div>
            ) : runState.status === 'running' ? (
              <div className="text-center text-gray-500">
                <Loader2 className="h-16 w-16 mx-auto mb-4 animate-spin opacity-50" />
                <p className="text-lg font-medium">Dialing Next Contact...</p>
                <p className="text-sm">Please wait</p>
              </div>
            ) : runState.status === 'paused' ? (
              <div className="text-center text-gray-500">
                <Pause className="h-16 w-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Dialer Paused</p>
                <p className="text-sm">Click Resume to continue</p>
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-50" />
                <p className="text-lg font-medium">Session Complete</p>
                <p className="text-sm">All contacts have been called</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Script Panel (if list has script) */}
        {selectedList?.script && (
          <Card className="shrink-0">
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowScript(!showScript)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Call Script: {selectedList.script.name}
                </CardTitle>
                <ChevronRight className={cn("h-4 w-4 transition-transform", showScript && "rotate-90")} />
              </div>
            </CardHeader>
            {showScript && (
              <CardContent>
                <div
                  className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm max-h-48 overflow-y-auto prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedList.script.content }}
                />
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* Column 3: Call Queue */}
      <div className="w-80 flex flex-col">
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Call Queue
              </CardTitle>
              <Badge variant="outline">
                {queue.filter(c => c.status === 'queued').length} pending
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
            <div ref={queueScrollRef} className="h-full overflow-y-auto">
              <div className="p-4 pt-0 space-y-1">
                {queue.map((contact, idx) => (
                  <div
                    key={contact.id}
                    data-queue-index={idx}
                    className={cn(
                      "p-3 rounded-lg border transition-all",
                      contact.status === 'dialing' || contact.status === 'ringing'
                        ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                        : contact.status === 'answered'
                        ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                        : contact.status === 'completed'
                        ? "border-green-300 bg-green-50/50 dark:bg-green-900/10"
                        : contact.status === 'no-answer' || contact.status === 'failed' || contact.status === 'busy'
                        ? "border-red-300 bg-red-50/50 dark:bg-red-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-6">{idx + 1}.</span>
                        <span className="font-medium text-sm">
                          {contact.firstName} {contact.lastName}
                        </span>
                      </div>
                      <Badge className={cn("text-xs", getStatusColor(contact.status))}>
                        <span className="flex items-center gap-1">
                          {getStatusIcon(contact.status)}
                          {contact.status}
                        </span>
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 pl-8">
                      <span>{formatPhoneNumberForDisplay(contact.phone)}</span>
                      {contact.attemptCount > 0 && (
                        <span className="text-orange-500">
                          Attempt {contact.attemptCount}/{contact.maxAttempts}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {queue.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No contacts in queue</p>
                    <p className="text-xs">Select a list to load contacts</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

