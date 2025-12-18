"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Users,
  Send,
  Play,
  Pause,
  Square,
  Trash2,
  Phone,
  Tag,
  Clock,
  DollarSign,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  Shuffle,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { formatPhoneNumberForDisplay, getBestPhoneNumber } from "@/lib/phone-utils"
import type { Contact } from "@/lib/types"

interface TelnyxPhoneNumber {
  id: string
  phoneNumber: string
  friendlyName?: string
}

interface TagType {
  id: string
  name: string
  color: string
  usage_count?: number
}

interface QueueContact extends Contact {
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'removed'
  sentFromNumber?: string
  sentAt?: Date
  error?: string
}

interface TextBlastQueueProps {
  onBlastComplete?: () => void
}

// Telnyx SMS pricing (as of Dec 2024):
// - Telnyx platform fee: ~$0.004/message
// - Carrier fees (10DLC registered): ~$0.003/message (T-Mobile/AT&T/Verizon average)
// Total: ~$0.007 per outbound SMS segment
// SMS segments: 1-160 chars = 1 segment, 161-320 = 2 segments, 321-480 = 3 segments, etc.
const SMS_COST_PER_SEGMENT = 0.007

// Calculate SMS cost based on message length (segments)
function calculateSmsCost(messageLength: number): number {
  if (messageLength <= 0) return 0
  // Standard SMS: 160 chars per segment, multipart: 153 chars per segment (7 chars for header)
  const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
  return segments * SMS_COST_PER_SEGMENT
}

// Get number of SMS segments
function getSmsSegments(messageLength: number): number {
  if (messageLength <= 0) return 0
  return messageLength <= 160 ? 1 : Math.ceil(messageLength / 153)
}

export default function TextBlastQueue({ onBlastComplete }: TextBlastQueueProps) {
  // Tag & Contact Selection
  const [tags, setTags] = useState<TagType[]>([])
  const [selectedTag, setSelectedTag] = useState<string>("")
  const [queueContacts, setQueueContacts] = useState<QueueContact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(false)

  // Phone Numbers
  const [phoneNumbers, setPhoneNumbers] = useState<TelnyxPhoneNumber[]>([])
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([])
  const [currentNumberIndex, setCurrentNumberIndex] = useState(0)

  // Message
  const [message, setMessage] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)
  const [templates, setTemplates] = useState<any[]>([])

  // Preview
  const [previewIndex, setPreviewIndex] = useState(0)

  // Delay Settings (0.5-30 seconds)
  const [delaySeconds, setDelaySeconds] = useState(2)

  // Blast State
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [startIndex, setStartIndex] = useState(0)
  const blastRef = useRef<{ shouldStop: boolean }>({ shouldStop: false })

  // Backend blast state
  const [activeBlastId, setActiveBlastId] = useState<string | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll ref for auto-scroll during blast
  const queueScrollRef = useRef<HTMLDivElement>(null)

  // Stats
  const [sentCount, setSentCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)

  // Load initial data and check for running blast
  // IMPORTANT: checkForRunningBlast must complete before loadPhoneNumbers sets defaults
  useEffect(() => {
    const init = async () => {
      loadTags()
      loadTemplates()
      // First check for running blast (which may have saved sender numbers)
      const hasActiveBlast = await checkForRunningBlast()
      // Then load phone numbers, passing whether we have an active blast
      await loadPhoneNumbers(hasActiveBlast)
    }
    init()
  }, [])

  // Check if there's already a running/paused blast (for when user navigates away and back)
  // Returns true if an active blast was found (so we don't override sender numbers)
  const checkForRunningBlast = async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/text-blast?checkRunning=true')
      const data = await response.json()

      if (data.hasRunning && data.runningBlast) {
        const blast = data.runningBlast
        console.log('[TEXT-BLAST] Found active blast:', blast.id, 'status:', blast.status)

        setActiveBlastId(blast.id)
        setIsRunning(blast.status === 'running')
        setIsPaused(blast.status === 'paused' || blast.isPaused)
        setSentCount(blast.sentCount || 0)
        setFailedCount(blast.failedCount || 0)
        setCurrentIndex(blast.currentIndex || 0)
        setMessage(blast.message || '')
        setDelaySeconds(blast.delaySeconds || 2)

        // Load sender numbers
        if (blast.senderNumbers) {
          try {
            const numbers = JSON.parse(blast.senderNumbers)
            setSelectedNumbers(numbers)
          } catch (e) {
            console.error('Error parsing sender numbers:', e)
          }
        }

        // Load the contacts for this blast - fetch actual contact data
        if (blast.selectedContacts) {
          try {
            const contactIds = JSON.parse(blast.selectedContacts)
            console.log('[TEXT-BLAST] Loading', contactIds.length, 'contacts for blast:', contactIds)

            // Fetch actual contact details
            const contactsResponse = await fetch('/api/contacts/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: contactIds })
            })

            console.log('[TEXT-BLAST] Batch response status:', contactsResponse.status)

            if (contactsResponse.ok) {
              const contactsData = await contactsResponse.json()
              console.log('[TEXT-BLAST] Batch returned', contactsData.contacts?.length, 'contacts:', contactsData)

              if (contactsData.contacts && contactsData.contacts.length > 0) {
                // Map contacts with their status based on current index
                const contacts = contactsData.contacts.map((c: Contact, idx: number) => ({
                  ...c,
                  status: idx < (blast.currentIndex || 0) ? 'sent' : 'pending' as const
                }))
                setQueueContacts(contacts)
                console.log('[TEXT-BLAST] Set', contacts.length, 'contacts with statuses')
              } else {
                console.warn('[TEXT-BLAST] Batch returned empty contacts array')
                // Fallback if batch returns empty
                await loadContactsFallback(contactIds, blast.currentIndex || 0)
              }
            } else {
              const errText = await contactsResponse.text()
              console.error('[TEXT-BLAST] Batch API error:', errText)
              // Fallback to placeholder contacts
              await loadContactsFallback(contactIds, blast.currentIndex || 0)
            }
          } catch (e) {
            console.error('Error loading blast contacts:', e)
          }
        }

        // Start polling if running
        if (blast.status === 'running' && !pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(() => {
            pollBlastStatus(blast.id)
          }, 2000)
        }

        const statusText = blast.status === 'paused' ? 'Paused blast' : 'Running blast'
        toast.info(`${statusText}: ${blast.name} (${blast.sentCount}/${blast.totalContacts} sent)`)
        return true // Active blast found
      }
      return false // No active blast
    } catch (error) {
      console.error('Error checking for running blast:', error)
      return false
    }
  }

  // Fallback to load contacts one by one or as placeholders
  const loadContactsFallback = async (contactIds: string[], currentIdx: number) => {
    console.log('[TEXT-BLAST] Using fallback to load contacts')
    const contacts = contactIds.map((id: string, idx: number) => ({
      id,
      firstName: 'Contact',
      lastName: `#${idx + 1}`,
      status: idx < currentIdx ? 'sent' : 'pending' as const
    })) as QueueContact[]
    setQueueContacts(contacts)
  }

  // Auto-scroll to current contact during blast
  useEffect(() => {
    if (isRunning && queueScrollRef.current && currentIndex > 0) {
      const container = queueScrollRef.current
      const contactElements = container.querySelectorAll("[data-contact-index]")
      const currentElement = contactElements[currentIndex] as HTMLElement
      if (currentElement) {
        currentElement.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }, [currentIndex, isRunning])

  const loadTags = async () => {
    try {
      const res = await fetch('/api/tags?includeUsage=true')
      const data = await res.json()
      setTags(data.tags || [])
    } catch (error) {
      console.error('Error loading tags:', error)
    }
  }

  // Load phone numbers - only set default selection if no active blast
  const loadPhoneNumbers = async (hasActiveBlast: boolean = false) => {
    try {
      const res = await fetch('/api/telnyx/phone-numbers')
      const data = await res.json()
      const numbers = Array.isArray(data) ? data : data.phoneNumbers || []
      setPhoneNumbers(numbers)
      // Only set default selection if there's no active blast (which already has saved numbers)
      if (numbers.length > 0 && !hasActiveBlast) {
        setSelectedNumbers([numbers[0].id])
      }
    } catch (error) {
      console.error('Error loading phone numbers:', error)
    }
  }

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/templates')
      const data = await res.json()
      // API returns array directly, not { templates: [...] }
      setTemplates(Array.isArray(data) ? data : data.templates || [])
    } catch (error) {
      console.error('Error loading templates:', error)
    }
  }

  const loadContactsByTag = async (tagId: string) => {
    if (!tagId) {
      setQueueContacts([])
      return
    }

    setLoadingContacts(true)
    try {
      const res = await fetch(`/api/contacts?tags=${tagId}&limit=10000`)
      const data = await res.json()
      const contacts = (data.contacts || []).map((c: Contact) => ({
        ...c,
        status: 'pending' as const
      }))
      setQueueContacts(contacts)
      setCurrentIndex(0)
      setStartIndex(0)
      setSentCount(0)
      setFailedCount(0)
    } catch (error) {
      console.error('Error loading contacts:', error)
      toast.error('Failed to load contacts')
    } finally {
      setLoadingContacts(false)
    }
  }

  // Format message with contact variables
  const formatMessage = (template: string, contact: Contact): string => {
    return template
      .replace(/\{firstName\}/g, contact.firstName || '')
      .replace(/\{lastName\}/g, contact.lastName || '')
      .replace(/\{fullName\}/g, `${contact.firstName || ''} ${contact.lastName || ''}`.trim())
      .replace(/\{llcName\}/g, contact.llcName || '')
      .replace(/\{propertyAddress\}/g, contact.propertyAddress || '')
      .replace(/\{city\}/g, contact.city || '')
      .replace(/\{state\}/g, contact.state || '')
  }

  // Preview navigation
  const previewContact = queueContacts[previewIndex] || null
  const previewMessage = previewContact && message ? formatMessage(message, previewContact) : ''

  const nextPreview = () => {
    if (previewIndex < queueContacts.length - 1) {
      setPreviewIndex(prev => prev + 1)
    }
  }

  const prevPreview = () => {
    if (previewIndex > 0) {
      setPreviewIndex(prev => prev - 1)
    }
  }

  // Reset preview index when contacts change
  useEffect(() => {
    setPreviewIndex(0)
  }, [queueContacts])

  // Remove contact from queue
  const removeFromQueue = (contactId: string) => {
    if (isRunning) {
      toast.error("Cannot remove contacts while blast is running")
      return
    }
    setQueueContacts(prev => prev.filter(c => c.id !== contactId))
    toast.success("Contact removed from queue")
  }

  // Move contact up/down in queue
  const moveInQueue = (contactId: string, direction: 'up' | 'down') => {
    if (isRunning) {
      toast.error("Cannot reorder while blast is running")
      return
    }
    setQueueContacts(prev => {
      const idx = prev.findIndex(c => c.id === contactId)
      if (idx === -1) return prev
      if (direction === 'up' && idx === 0) return prev
      if (direction === 'down' && idx === prev.length - 1) return prev

      const newArr = [...prev]
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      ;[newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]]
      return newArr
    })
  }

  // Shuffle queue - randomize pending contacts using Fisher-Yates algorithm
  const shuffleQueue = () => {
    if (isRunning) {
      toast.error("Cannot shuffle while blast is running")
      return
    }

    const pending = queueContacts.filter(c => c.status === 'pending')
    const nonPending = queueContacts.filter(c => c.status !== 'pending')

    if (pending.length <= 1) {
      toast.info("Not enough contacts to shuffle")
      return
    }

    // Fisher-Yates shuffle
    const shuffled = [...pending]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    // Keep non-pending contacts at their positions, put shuffled pending at the end
    setQueueContacts([...nonPending, ...shuffled])
    toast.success(`Shuffled ${pending.length} contacts`)
  }

  // Get next phone number (rotation)
  const getNextPhoneNumber = useCallback(() => {
    if (selectedNumbers.length === 0) return null
    const phoneId = selectedNumbers[currentNumberIndex % selectedNumbers.length]
    const phone = phoneNumbers.find(p => p.id === phoneId)
    setCurrentNumberIndex(prev => prev + 1)
    return phone
  }, [selectedNumbers, phoneNumbers, currentNumberIndex])

  // Send single SMS
  const sendSms = async (contact: QueueContact, phoneNumber: TelnyxPhoneNumber) => {
    const toNumber = getBestPhoneNumber(contact)
    if (!toNumber) {
      return { success: false, error: 'No phone number' }
    }

    try {
      const formattedMessage = formatMessage(message, contact)
      const response = await fetch('/api/telnyx/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromNumber: phoneNumber.phoneNumber,
          toNumber,
          message: formattedMessage,
          contactId: contact.id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        return { success: false, error: error.message || 'Failed to send' }
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message || 'Network error' }
    }
  }

  // Auto-scroll to current contact during blast
  const scrollToCurrentContact = useCallback((index: number) => {
    if (!queueScrollRef.current) return

    const scrollContainer = queueScrollRef.current.querySelector('[data-radix-scroll-area-viewport]')
    if (!scrollContainer) return

    const contactElement = scrollContainer.querySelector(`[data-contact-index="${index}"]`)
    if (contactElement) {
      contactElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [])

  // Track last known counts to avoid spamming console with duplicate updates
  const lastKnownStatusRef = useRef<{ sentCount: number; status: string }>({ sentCount: 0, status: '' })

  // Update blast status from real-time or polling data
  const updateBlastStatus = useCallback((blast: any) => {
    const newSentCount = blast.sentCount || 0
    const newStatus = blast.status || ''

    // Only log if something actually changed
    const hasChanged = lastKnownStatusRef.current.sentCount !== newSentCount ||
                       lastKnownStatusRef.current.status !== newStatus

    if (hasChanged) {
      console.log('🔄 Blast status update:', {
        status: newStatus,
        sent: newSentCount,
        failed: blast.failedCount || 0
      })
      lastKnownStatusRef.current = { sentCount: newSentCount, status: newStatus }
    }

    setSentCount(newSentCount)
    setFailedCount(blast.failedCount || 0)
    setCurrentIndex(blast.currentIndex || 0)

    // Update queue contacts based on current index
    setQueueContacts(prev => prev.map((c, idx) => {
      if (idx < blast.currentIndex) {
        return { ...c, status: 'sent' as const }
      }
      return c
    }))

    // Auto-scroll to the current contact being processed
    if (blast.currentIndex !== undefined && blast.status === 'running') {
      setTimeout(() => scrollToCurrentContact(blast.currentIndex), 100)
    }

    if (blast.status === 'completed') {
      setIsRunning(false)
      setIsPaused(false)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      toast.success(`Text blast complete! ${blast.sentCount} sent, ${blast.failedCount} failed`)
      onBlastComplete?.()
    } else if (blast.status === 'paused') {
      setIsRunning(false)
      setIsPaused(true)
    } else if (blast.status === 'failed') {
      setIsRunning(false)
      setIsPaused(false)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      toast.error('Text blast failed')
    }
  }, [onBlastComplete, scrollToCurrentContact])

  // Poll for blast status updates (fallback) - wrapped in useCallback for use in useEffect deps
  const pollBlastStatus = useCallback(async (blastId: string) => {
    try {
      const response = await fetch(`/api/text-blast/${blastId}`)
      if (!response.ok) return

      const data = await response.json()
      const blast = data.blast

      if (blast) {
        updateBlastStatus(blast)
      }
    } catch (error) {
      console.error('Error polling blast status:', error)
    }
  }, [updateBlastStatus])

  // Listen for real-time updates via SSE with reconnection logic
  useEffect(() => {
    if (!activeBlastId) return

    let es: EventSource | null = null
    let reconnectAttempts = 0
    let reconnectTimeout: NodeJS.Timeout | null = null
    const maxReconnectAttempts = 10
    const baseReconnectDelay = 1000

    const connect = () => {
      console.log('🔌 Connecting to SSE for blast:', activeBlastId)
      es = new EventSource('/api/events')

      es.onopen = () => {
        console.log('✅ SSE connected for blast:', activeBlastId)
        reconnectAttempts = 0 // Reset attempts on successful connection
        // Immediately poll to sync state after reconnection
        pollBlastStatus(activeBlastId)
      }

      const onProgress = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data || '{}')
          console.log('📡 SSE progress event received:', data)
          if (data.blastId === activeBlastId) {
            console.log('📡 Matched blast ID, updating UI:', data)
            updateBlastStatus(data)
          }
        } catch (error) {
          console.error('Error parsing SSE event:', error)
        }
      }

      const onCompleted = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data || '{}')
          console.log('✅ SSE completed event received:', data)
          if (data.blastId === activeBlastId) {
            console.log('✅ Blast completed, updating UI:', data)
            updateBlastStatus(data)
          }
        } catch (error) {
          console.error('Error parsing SSE event:', error)
        }
      }

      // Listen for generic message events as well
      es.onmessage = (evt) => {
        console.log('📩 SSE generic message:', evt.data)
      }

      es.addEventListener('text-blast:progress', onProgress as any)
      es.addEventListener('text-blast:completed', onCompleted as any)

      es.onerror = (err) => {
        console.log('❌ SSE connection error:', err)

        // Clean up current connection
        if (es) {
          es.close()
          es = null
        }

        // Attempt reconnection with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000)
          console.log(`🔄 Reconnecting SSE in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`)

          // Poll for status while disconnected
          pollBlastStatus(activeBlastId)

          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++
            connect()
          }, delay)
        } else {
          console.log('❌ Max SSE reconnection attempts reached, falling back to polling')
          toast.error('Live updates disconnected - using polling mode')
        }
      }
    }

    connect()

    return () => {
      console.log('🔌 Disconnecting SSE for blast:', activeBlastId)
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (es) {
        try {
          es.close()
        } catch (error) {
          console.error('Error cleaning up SSE:', error)
        }
      }
    }
  }, [activeBlastId, updateBlastStatus, pollBlastStatus])

  // Start blast using backend API
  const startBlast = async () => {
    if (selectedNumbers.length === 0) {
      toast.error("Please select at least one phone number")
      return
    }
    if (!message.trim()) {
      toast.error("Please enter a message")
      return
    }
    const pendingContacts = queueContacts.filter(c => c.status === 'pending')
    if (pendingContacts.length === 0) {
      toast.error("No contacts in queue")
      return
    }

    try {
      // Create blast record in backend
      const createResponse = await fetch('/api/text-blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Text Blast - ${selectedTag}`,
          message,
          selectedContacts: pendingContacts,
          senderNumbers: selectedNumbers.map(id => phoneNumbers.find(p => p.id === id)).filter(Boolean),
          delaySeconds,
        }),
      })

      if (!createResponse.ok) {
        const error = await createResponse.json()
        toast.error(error.error || 'Failed to create blast')
        return
      }

      const { blast } = await createResponse.json()
      setActiveBlastId(blast.id)

      // Start the blast
      const startResponse = await fetch(`/api/text-blast/${blast.id}/start`, {
        method: 'POST',
      })

      if (!startResponse.ok) {
        const error = await startResponse.json()
        toast.error(error.error || 'Failed to start blast')
        return
      }

      setIsRunning(true)
      setIsPaused(false)
      toast.success(`Text blast started! Processing ${pendingContacts.length} contacts in background.`)

      // Start polling for status updates (as fallback to SSE)
      pollIntervalRef.current = setInterval(() => {
        pollBlastStatus(blast.id)
      }, 2000) // Poll every 2 seconds (SSE provides real-time updates)

    } catch (error: any) {
      toast.error(error.message || 'Failed to start blast')
    }
  }

  // Pause blast using backend API
  const pauseBlast = async () => {
    if (!activeBlastId) {
      blastRef.current.shouldStop = true
      toast.info("Pausing blast...")
      return
    }

    try {
      const response = await fetch(`/api/text-blast/${activeBlastId}/pause`, {
        method: 'POST',
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setIsPaused(true)
        setIsRunning(false)
        toast.info(data.alreadyPaused ? "Blast is already paused" : "Blast paused")
      } else {
        // Even if pause fails, try to sync state by polling
        console.error('Pause failed:', data.error)
        await pollBlastStatus(activeBlastId)
        toast.error(data.error || 'Failed to pause blast - syncing state...')
      }
    } catch (error) {
      console.error('Pause error:', error)
      toast.error('Failed to pause blast')
    }
  }

  // Resume blast using backend API
  const resumeBlast = async () => {
    if (!activeBlastId) {
      blastRef.current.shouldStop = false
      setIsRunning(true)
      setIsPaused(false)
      toast.success("Resuming blast...")
      return
    }

    try {
      const response = await fetch(`/api/text-blast/${activeBlastId}/resume`, {
        method: 'POST',
      })

      if (response.ok) {
        setIsRunning(true)
        setIsPaused(false)
        toast.success("Blast resumed")

        // Resume polling (as fallback to SSE)
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = setInterval(() => {
            pollBlastStatus(activeBlastId)
          }, 5000)
        }
      } else {
        toast.error('Failed to resume blast')
      }
    } catch (error) {
      toast.error('Failed to resume blast')
    }
  }

  // Stop/Kill blast completely using backend API
  const stopBlast = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    if (!activeBlastId) {
      blastRef.current.shouldStop = true
      setIsRunning(false)
      setIsPaused(false)
      toast.info("Blast stopped")
      return
    }

    try {
      // Use pause endpoint with force option to stop the blast regardless of current status
      const response = await fetch(`/api/text-blast/${activeBlastId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, stop: true }),
      })

      setIsRunning(false)
      setIsPaused(false)
      setActiveBlastId(null)
      toast.info("Blast stopped")
    } catch (error) {
      toast.error('Failed to stop blast')
    }
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // Calculate costs based on actual message length for each contact
  const pendingContacts = queueContacts.filter(c => c.status === 'pending')

  // Calculate total cost by evaluating each pending contact's formatted message length
  const totalCost = pendingContacts.reduce((acc, contact) => {
    const formattedMessage = message ? formatMessage(message, contact) : ''
    return acc + calculateSmsCost(formattedMessage.length)
  }, 0)

  const estimatedTime = pendingContacts.length * delaySeconds

  // Kill all running blasts (text and email)
  const killAllBlasts = async () => {
    try {
      // Kill text blasts
      const textRes = await fetch('/api/text-blast/kill-all', { method: 'POST' })
      const textData = textRes.ok ? await textRes.json() : { count: 0 }

      // Kill email blasts
      const emailRes = await fetch('/api/email-blast/kill-all', { method: 'POST' })
      const emailData = emailRes.ok ? await emailRes.json() : { count: 0 }

      toast.success(`Stopped ${textData.count || 0} text blasts and ${emailData.count || 0} email blasts`)
      setIsRunning(false)
      setIsPaused(false)
      setActiveBlastId(null)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    } catch (error) {
      toast.error('Error stopping blasts')
    }
  }

  return (
    <div className="h-full flex gap-6">
      {/* LEFT SIDE - Configuration */}
      <div className="flex-1 space-y-4 overflow-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Send className="h-6 w-6" />
              Text Blast
            </h2>
            <p className="text-muted-foreground">Send SMS to contacts by selecting a tag</p>
          </div>
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={killAllBlasts}
              className="flex items-center gap-2"
            >
              <Square className="h-4 w-4" />
              Kill All Blasts
            </Button>
          )}
        </div>

        {/* Tag Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Select Tag
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedTag}
              onValueChange={(value) => {
                setSelectedTag(value)
                loadContactsByTag(value)
              }}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a tag to load contacts..." />
              </SelectTrigger>
              <SelectContent>
                {tags.map(tag => (
                  <SelectItem key={tag.id} value={tag.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span>{tag.name}</span>
                      {tag.usage_count !== undefined && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {tag.usage_count}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Phone Number Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Sender Numbers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {phoneNumbers.map(phone => (
              <label
                key={phone.id}
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedNumbers.includes(phone.id)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedNumbers.includes(phone.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedNumbers([...selectedNumbers, phone.id])
                    } else {
                      setSelectedNumbers(selectedNumbers.filter(id => id !== phone.id))
                    }
                  }}
                  disabled={isRunning}
                  className="h-4 w-4"
                />
                <div>
                  <div className="font-medium">{formatPhoneNumberForDisplay(phone.phoneNumber)}</div>
                  {phone.friendlyName && (
                    <div className="text-xs text-muted-foreground">{phone.friendlyName}</div>
                  )}
                </div>
              </label>
            ))}
            {phoneNumbers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No phone numbers available</p>
            )}
          </CardContent>
        </Card>

        {/* Template Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Message Template
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={selectedTemplate?.id || ""}
              onValueChange={(value) => {
                const template = templates.find(t => t.id === value)
                setSelectedTemplate(template || null)
                if (template) setMessage(template.content)
              }}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a template or write custom..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(template => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Hi {firstName}, ..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isRunning}
              rows={4}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Variables: {"{firstName}"}, {"{lastName}"}, {"{llcName}"}, {"{propertyAddress}"}
              </p>
              <a
                href="/settings?tab=templates"
                className="text-xs text-blue-600 hover:underline"
                target="_blank"
              >
                Manage Templates
              </a>
            </div>

            {/* Message Preview */}
            {queueContacts.length > 0 && message && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-blue-700">
                    Preview ({previewIndex + 1} of {queueContacts.length})
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={prevPreview}
                      disabled={previewIndex === 0}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={nextPreview}
                      disabled={previewIndex >= queueContacts.length - 1}
                      className="h-6 w-6 p-0"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {previewContact && (
                  <div>
                    <p className="text-xs text-blue-600 mb-1">
                      To: {previewContact.firstName} {previewContact.lastName} • {getBestPhoneNumber(previewContact) || 'No phone'}
                    </p>
                    <div className="bg-white p-2 rounded text-sm border border-blue-100">
                      {previewMessage || <span className="text-gray-400">No message</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delay Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Delay Between Messages
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Slider
                value={[delaySeconds]}
                onValueChange={(v) => setDelaySeconds(v[0])}
                min={0.5}
                max={30}
                step={0.5}
                disabled={isRunning}
                className="flex-1"
              />
              <div className="w-24 text-center">
                <span className="text-2xl font-bold">{delaySeconds}</span>
                <span className="text-sm text-muted-foreground ml-1">sec</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Min: 0.5s | Max: 30s
            </p>
          </CardContent>
        </Card>

        {/* Pricing & Summary */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{queueContacts.length}</div>
                <div className="text-xs text-muted-foreground">Total Contacts</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">${totalCost.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Est. Cost</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{Math.ceil(estimatedTime / 60)}m</div>
                <div className="text-xs text-muted-foreground">Est. Time</div>
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Action Buttons */}
        <div className="flex gap-2">
          {!isRunning && !isPaused && (
            <Button
              onClick={startBlast}
              disabled={queueContacts.length === 0 || !message.trim() || selectedNumbers.length === 0}
              className="flex-1"
              size="lg"
            >
              <Play className="h-5 w-5 mr-2" />
              Start Blast
            </Button>
          )}
          {isRunning && (
            <>
              <Button onClick={pauseBlast} variant="outline" className="flex-1" size="lg">
                <Pause className="h-5 w-5 mr-2" />
                Pause
              </Button>
              <Button onClick={stopBlast} variant="destructive" size="lg">
                <Square className="h-5 w-5 mr-2" />
                Stop
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button onClick={resumeBlast} className="flex-1" size="lg">
                <Play className="h-5 w-5 mr-2" />
                Resume
              </Button>
              <Button onClick={stopBlast} variant="destructive" size="lg">
                <Square className="h-5 w-5 mr-2" />
                Stop
              </Button>
            </>
          )}
        </div>

        {/* Progress when running */}
        {(isRunning || isPaused) && (
          <Card className="border-primary">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Progress</span>
                <span className="text-sm">
                  {sentCount + failedCount} / {queueContacts.length} processed
                </span>
              </div>
              <Progress value={((sentCount + failedCount) / queueContacts.length) * 100} />
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">✓ {sentCount} sent</span>
                <span className="text-red-600">✗ {failedCount} failed</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* RIGHT SIDE - Queue */}
      <div className="w-[450px] flex flex-col border rounded-lg bg-card">
        {/* Queue Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <h3 className="font-semibold">Next Up in Queue</h3>
            </div>
            {queueContacts.length > 1 && !isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={shuffleQueue}
                title="Shuffle queue order"
              >
                <Shuffle className="h-4 w-4 mr-1" />
                Shuffle
              </Button>
            )}
          </div>
          {queueContacts.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {pendingContacts.length} contacts remaining
            </p>
          )}
        </div>

        {/* Queue List */}
        <ScrollArea className="flex-1" ref={queueScrollRef}>
          {loadingContacts ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : queueContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <Users className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No contacts in queue</p>
              <p className="text-xs text-muted-foreground mt-1">Select a tag to load contacts</p>
            </div>
          ) : (
            <div className="divide-y">
              {queueContacts.map((contact, index) => {
                const isCurrent = isRunning && index === currentIndex
                const phone = getBestPhoneNumber(contact)

                return (
                  <div
                    key={contact.id}
                    data-contact-index={index}
                    className={`p-3 transition-colors ${
                      isCurrent ? 'bg-primary/10 border-l-4 border-l-primary' :
                      contact.status === 'sent' ? 'bg-green-50' :
                      contact.status === 'failed' ? 'bg-red-50' :
                      contact.status === 'sending' ? 'bg-yellow-50' :
                      ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Index */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                        contact.status === 'sent' ? 'bg-green-100 text-green-700' :
                        contact.status === 'failed' ? 'bg-red-100 text-red-700' :
                        contact.status === 'sending' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {contact.status === 'sent' ? <CheckCircle2 className="h-4 w-4" /> :
                         contact.status === 'failed' ? <XCircle className="h-4 w-4" /> :
                         contact.status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                         index + 1}
                      </div>

                      {/* Contact Info */}
                      <div className="flex-1 min-w-0">
                        {/* Name & LLC */}
                        <div className="font-medium text-sm">
                          {contact.firstName} {contact.lastName}
                        </div>
                        {contact.llcName && (
                          <div className="text-xs text-muted-foreground truncate">
                            {contact.llcName}
                          </div>
                        )}

                        {/* Property Address */}
                        {contact.propertyAddress && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            📍 {contact.propertyAddress}{contact.city ? `, ${contact.city}` : ''}{contact.state ? `, ${contact.state}` : ''}
                          </div>
                        )}

                        {/* Phone Numbers - To/From */}
                        <div className="flex flex-wrap gap-x-3 mt-1">
                          <div className="text-xs">
                            <span className="text-muted-foreground">To:</span>{' '}
                            <span className="font-medium">{formatPhoneNumberForDisplay(phone)}</span>
                          </div>
                          {contact.status === 'pending' && selectedNumbers.length > 0 && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">From:</span>{' '}
                              <span className="text-blue-600 font-medium">
                                {(() => {
                                  const assignedNumber = phoneNumbers.find(p => p.id === selectedNumbers[index % selectedNumbers.length])
                                  return assignedNumber ? formatPhoneNumberForDisplay(assignedNumber.phoneNumber) : 'N/A'
                                })()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Sent From (after sending) */}
                        {contact.sentFromNumber && (
                          <div className="text-xs text-green-600 mt-1">
                            ✓ Sent from: {formatPhoneNumberForDisplay(contact.sentFromNumber)}
                          </div>
                        )}

                        {/* Error */}
                        {contact.error && (
                          <div className="text-xs text-red-600 mt-1">✗ {contact.error}</div>
                        )}

                        {/* Message Preview */}
                        {contact.status === 'pending' && message && (
                          <div className="mt-2 p-2 bg-gray-50 rounded border text-xs">
                            <div className="text-muted-foreground mb-1 font-medium">Message Preview:</div>
                            <div className="text-gray-700 whitespace-pre-wrap line-clamp-3">
                              {formatMessage(message, contact)}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1">
                        {contact.status === 'pending' && !isRunning && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveInQueue(contact.id, 'up')}
                              disabled={index === 0}
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => moveInQueue(contact.id, 'down')}
                              disabled={index === queueContacts.length - 1}
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {contact.status === 'pending' && !isRunning && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                            onClick={() => removeFromQueue(contact.id)}
                            title="Remove from queue (does not delete contact)"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Cost badge - shows actual cost based on formatted message length */}
                    {contact.status === 'pending' && message && (
                      <div className="mt-2 flex justify-end gap-1">
                        {(() => {
                          const formattedMsg = formatMessage(message, contact)
                          const segments = getSmsSegments(formattedMsg.length)
                          const cost = calculateSmsCost(formattedMsg.length)
                          return (
                            <>
                              <Badge variant="outline" className="text-xs">
                                {formattedMsg.length} chars / {segments} {segments === 1 ? 'segment' : 'segments'}
                              </Badge>
                              <Badge variant={segments > 1 ? "destructive" : "outline"} className="text-xs">
                                <DollarSign className="h-3 w-3 mr-0.5" />
                                {cost.toFixed(3)}
                              </Badge>
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
