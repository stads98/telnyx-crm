"use client"

import { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Plus, MessageCircle, Phone, Filter, Calendar, X, ClipboardList, CheckSquare, Trash2, Tag } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { formatDistanceToNow } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import { useNotifications } from "@/lib/context/notifications-context"
import { useContacts } from "@/lib/context/contacts-context"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import NewTextMessageModal from "./new-text-message-modal"
import type { Contact } from "@/lib/types"
import ContactName from "@/components/contacts/contact-name"
import BulkTagOperations from "@/components/contacts/bulk-tag-operations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"


interface ConversationData {
  id: string
  contact_id: string
  phone_number: string      // Prospect's phone number
  our_number?: string       // Our Telnyx line for this conversation
  last_message_at?: string
  last_message_direction?: 'inbound' | 'outbound'
  last_sender_number?: string
  unread_count: number
  contact: {
    id: string
    firstName: string
    lastName: string
    email1?: string
    phone1?: string
    llcName?: string
    propertyAddress?: string
  }
  lastMessage?: {
    id: string
    content: string
    direction: 'inbound' | 'outbound'
    status: string
    fromNumber: string
    toNumber: string
    createdAt: string
  }
  hasUnread: boolean
  isNewMessage: boolean
}

interface EnhancedConversationsListProps {
  selectedContactId?: string
  onSelectContact: (contact: Contact) => void
  onNewConversation?: () => void  // Optional - if provided, uses inline view instead of modal
}

const EnhancedConversationsList = forwardRef<any, EnhancedConversationsListProps>(
  ({ selectedContactId, onSelectContact, onNewConversation }, ref) => {
    const [searchQuery, setSearchQuery] = useState("")
    const [conversations, setConversations] = useState<ConversationData[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isInitialLoad, setIsInitialLoad] = useState(true)
    const [showNewMessageModal, setShowNewMessageModal] = useState(false)
    const debouncedSearchQuery = useDebounce(searchQuery, 500)
    const fetchAbortRef = useRef<AbortController | null>(null)
    const cacheRef = useRef<Map<string, any>>(new Map())
    const [isSearching, setIsSearching] = useState(false)
    const { toast } = useToast()
    const { add: addNotification } = useNotifications()

    // Pagination state
    const [offset, setOffset] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const scrollAreaRef = useRef<HTMLDivElement>(null)

    // FIX: Store scroll position to preserve it during auto-refresh
    const scrollPositionRef = useRef<number>(0)

    // Date/time filter state
    const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('all')
    const [customStartDate, setCustomStartDate] = useState<string>('')
    const [customEndDate, setCustomEndDate] = useState<string>('')
    const debouncedStartDate = useDebounce(customStartDate, 800)
    const debouncedEndDate = useDebounce(customEndDate, 800)
    const [showDateFilter, setShowDateFilter] = useState(false)

    // Stats from API (for ALL conversations, not just paginated)
    const [apiStats, setApiStats] = useState<{
      total: number
      unread: number
      read: number
    }>({ total: 0, unread: 0, read: 0 })

    // UX Enhancement: Conversation filters
    const [conversationFilter, setConversationFilter] = useState<'all' | 'unread' | 'read'>('all')
    const [directionFilter, setDirectionFilter] = useState<'all' | 'inbound' | 'outbound'>('all')

    // UX Enhancement: Bulk actions
    const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set())
    const [bulkActionMode, setBulkActionMode] = useState(false)

    // Bulk task creation state
    const [showBulkTaskDialog, setShowBulkTaskDialog] = useState(false)
    const [bulkTaskTitle, setBulkTaskTitle] = useState('')
    const [bulkTaskDescription, setBulkTaskDescription] = useState('')
    const [bulkTaskType, setBulkTaskType] = useState<'task' | 'call' | 'email' | 'meeting'>('task')
    const [bulkTaskDueDate, setBulkTaskDueDate] = useState('')
    const [bulkTaskDueTime, setBulkTaskDueTime] = useState('09:00')
    const [isCreatingBulkTasks, setIsCreatingBulkTasks] = useState(false)
    const [savedTaskTypes, setSavedTaskTypes] = useState<string[]>([])

    // Bulk tag state
    const [showBulkTagDialog, setShowBulkTagDialog] = useState(false)

    // Bulk delete state
    const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
    const [isDeletingConversations, setIsDeletingConversations] = useState(false)

    // Track user activity to prevent auto-refresh collision
    const [lastUserActivity, setLastUserActivity] = useState<number>(Date.now())
    const userActivityTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // FIX: Expose refresh method via ref
    useImperativeHandle(ref, () => ({
      refreshConversations: () => {
        console.log('Refreshing conversations list from ref')
        loadConversations()
      }
    }))

  // Load conversations with live search
  useEffect(() => {
    loadConversations()
  }, [debouncedSearchQuery, dateFilter, debouncedStartDate, debouncedEndDate, conversationFilter, directionFilter])

  // Load task types for bulk task creation
  useEffect(() => {
    const loadTaskTypes = async () => {
      try {
        const res = await fetch('/api/settings/task-types')
        if (res.ok) {
          const data = await res.json()
          setSavedTaskTypes(data.taskTypes || [])
        }
      } catch (error) {
        console.error('Error loading task types:', error)
      }
    }
    loadTaskTypes()
  }, [])

  // FIX: Auto-refresh conversations every 30 seconds while preserving scroll position
  // BUT: Pause auto-refresh if user is actively filtering/scrolling (within last 5 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceActivity = Date.now() - lastUserActivity

      // Only auto-refresh if user hasn't been active in the last 5 seconds
      if (timeSinceActivity > 5000) {
        // Save current scroll position before refresh
        const scrollElement = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
        if (scrollElement) {
          scrollPositionRef.current = scrollElement.scrollTop
        }
        loadConversations(false, true) // Pass false for loadMore, true for preserveScroll
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [debouncedSearchQuery, dateFilter, debouncedStartDate, debouncedEndDate, lastUserActivity])

  // Infinite scroll handler
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const scrollArea = e.target as HTMLDivElement
      const { scrollTop, scrollHeight, clientHeight } = scrollArea

      // Mark user as active when scrolling
      setLastUserActivity(Date.now())

      // Load more when user scrolls near the bottom (within 200px)
      if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoadingMore && !isLoading) {
        console.log('Loading more conversations...')
        loadConversations(true)
      }
    }

    const scrollElement = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (scrollElement) {
      scrollElement.addEventListener('scroll', handleScroll)
      return () => scrollElement.removeEventListener('scroll', handleScroll)
    }
  }, [hasMore, isLoadingMore, isLoading])

  // Track user activity when filters change (use debounced dates to avoid flickering)
  useEffect(() => {
    setLastUserActivity(Date.now())
  }, [conversationFilter, directionFilter, dateFilter, debouncedStartDate, debouncedEndDate])

  // FIX: Listen for conversationRead event to refresh conversations list
  useEffect(() => {
    const handleConversationRead = () => {
      console.log('Conversation marked as read, refreshing conversations list')
      loadConversations()
    }

    window.addEventListener('conversationRead', handleConversationRead as EventListener)
    return () => {
      window.removeEventListener('conversationRead', handleConversationRead as EventListener)
    }
  }, [])

  // Real-time updates via SSE
  useEffect(() => {
    const es = new EventSource('/api/events')

    const onInboundSms = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data || '{}')
        const name = msg?.contactName || 'Unknown'
        const preview = (msg?.text || '').toString().slice(0, 60)
        const contactId: string | undefined = msg?.contactId
        const globalActive = (typeof window !== 'undefined' && (window as any).__GLOBAL_SSE_ACTIVE)
        if (!globalActive) {
          addNotification({ kind: 'sms', contactId, contactName: name, preview })
          toast({
            title: `New message from ${name}`,
            description: preview || 'New SMS received',
            className: 'cursor-pointer',
            onClick: () => {
              if (contactId) {
                try {
                  const url = new URL(window.location.href)
                  url.pathname = '/dashboard'
                  url.searchParams.set('section', 'messaging')
                  url.searchParams.set('contactId', contactId)
                  window.location.assign(url.toString())
                } catch {}
              }
            }
          })
        }
      } catch {}
      loadConversations()
    }

    const onInboundEmail = (evt: MessageEvent) => {
      try {
        const em = JSON.parse(evt.data || '{}')
        const name = em?.contactName || em?.fromEmail || 'Unknown'
        const preview = (em?.subject || em?.preview || '').toString().slice(0, 80)
        const contactId: string | undefined = em?.contactId
        const globalActive = (typeof window !== 'undefined' && (window as any).__GLOBAL_SSE_ACTIVE)
        if (!globalActive) {
          addNotification({ kind: 'email', contactId, contactName: name, preview, fromEmail: em?.fromEmail })
          toast({
            title: `New email from ${name}`,
            description: preview || 'New email received',
            className: 'cursor-pointer',
            onClick: () => {
              if (contactId) {
                try {
                  const url = new URL(window.location.href)
                  url.pathname = '/dashboard'
                  url.searchParams.set('section', 'email')
                  url.searchParams.set('contactId', contactId)
                  window.location.assign(url.toString())
                } catch {}
              }
            }
          })
        }
      } catch {}
      // Optionally fetch email conversations list elsewhere
    }

    const onConvUpdate = () => loadConversations()

    es.addEventListener('inbound_sms', onInboundSms as any)
    es.addEventListener('conversation_updated', onConvUpdate as any)
    es.addEventListener('inbound_email', onInboundEmail as any)

    es.onerror = () => { /* auto-reconnect by browser */ }

    return () => {
      es.removeEventListener('inbound_sms', onInboundSms as any)
      es.removeEventListener('conversation_updated', onConvUpdate as any)
      es.removeEventListener('inbound_email', onInboundEmail as any)
      es.close()
    }
  }, [])

  const loadConversations = async (loadMore = false, preserveScroll = false) => {
    // Skip reload if custom date filter is selected but dates are incomplete
    if (dateFilter === 'custom' && (!debouncedStartDate || !debouncedEndDate)) {
      return
    }

    if (loadMore) {
      setIsLoadingMore(true)
    } else if (!preserveScroll) {
      setIsSearching(true)
      setIsLoading(true)
      setOffset(0)
      setConversations([])
    }

    try {
      const params = new URLSearchParams()
      if (debouncedSearchQuery.trim()) {
        params.set('search', debouncedSearchQuery.trim())
      }

      const currentOffset = loadMore ? offset : 0
      params.set('offset', currentOffset.toString())
      params.set('limit', '50')

      // Add conversation filter params (read/unread)
      if (conversationFilter !== 'all') {
        params.set('filter', conversationFilter) // 'unread' or 'read'
      }

      // Add direction filter params
      if (directionFilter !== 'all') {
        params.set('direction', directionFilter) // 'inbound' or 'outbound'
      }

      // Add date filter params
      if (dateFilter !== 'all') {
        const now = new Date()
        let startDate: Date | null = null
        let endDate: Date | null = null

        switch (dateFilter) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
            break
          case 'yesterday':
            const yesterday = new Date(now)
            yesterday.setDate(yesterday.getDate() - 1)
            startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())
            endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59)
            break
          case 'week':
            startDate = new Date(now)
            startDate.setDate(startDate.getDate() - 7)
            endDate = now
            break
          case 'month':
            startDate = new Date(now)
            startDate.setDate(startDate.getDate() - 30)
            endDate = now
            break
          case 'custom':
            if (debouncedStartDate) {
              startDate = new Date(debouncedStartDate)
            }
            if (debouncedEndDate) {
              endDate = new Date(debouncedEndDate)
              endDate.setHours(23, 59, 59)
            }
            break
        }

        if (startDate) params.set('startDate', startDate.toISOString())
        if (endDate) params.set('endDate', endDate.toISOString())
      }

      if (fetchAbortRef.current) { try { fetchAbortRef.current.abort() } catch {} }
      const controller = new AbortController()
      fetchAbortRef.current = controller

      const response = await fetch(`/api/conversations?${params}`, { signal: controller.signal })
      if (response.ok && !controller.signal.aborted) {
        const data = await response.json()
        if (!controller.signal.aborted) {
          if (loadMore) {
            // FIX: Deduplicate conversations when appending
            setConversations(prev => {
              const existingIds = new Set(prev.map(c => c.id))
              const newConversations = (data.conversations || []).filter(c => !existingIds.has(c.id))
              return [...prev, ...newConversations]
            })
            setOffset(data.offset + (data.conversations || []).length)
          } else {
            setConversations(data.conversations || [])
            setOffset((data.conversations || []).length)
          }
          setHasMore(data.hasMore || false)
          setApiStats({
            total: data.total || 0,
            unread: data.unread || 0,
            read: data.read || 0
          })

          // Restore scroll position if this was a background refresh
          if (preserveScroll && scrollPositionRef.current > 0) {
            setTimeout(() => {
              const scrollElement = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
              if (scrollElement) {
                scrollElement.scrollTop = scrollPositionRef.current
              }
            }, 0)
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Error loading conversations:', error)
      }
    } finally {
      setIsLoading(false)
      setIsSearching(false)
      setIsLoadingMore(false)
      setIsInitialLoad(false)
    }
  }

  const handleContactSelect = (conversation: ConversationData) => {
    // ADMIN FIX: Mark conversation as read in-place (no full reload)
    if (conversation.hasUnread) {
      setConversations(prev =>
        prev.map(c =>
          c.id === conversation.id
            ? { ...c, hasUnread: false, unread_count: 0 }
            : c
        )
      )
    }

    const contact: Contact = {
      id: conversation.contact.id,
      firstName: conversation.contact.firstName,
      lastName: conversation.contact.lastName,
      email1: conversation.contact.email1,
      phone1: conversation.contact.phone1,
      llcName: conversation.contact.llcName,
      propertyAddress: conversation.contact.propertyAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    onSelectContact(contact)
  }

  // Handle bulk task creation
  const handleBulkTaskCreation = async () => {
    if (selectedConversationIds.size === 0) return
    if (!bulkTaskTitle.trim()) {
      toast({ title: 'Error', description: 'Task title is required', variant: 'destructive' })
      return
    }

    setIsCreatingBulkTasks(true)
    try {
      // Get contact IDs from selected conversations
      const contactIds = sortedConversations
        .filter(c => selectedConversationIds.has(c.id))
        .map(c => c.contact_id)

      const dueDateTime = bulkTaskDueDate && bulkTaskDueTime
        ? new Date(`${bulkTaskDueDate}T${bulkTaskDueTime}`).toISOString()
        : null

      const response = await fetch('/api/activities/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactIds,
          title: bulkTaskTitle,
          description: bulkTaskDescription,
          type: bulkTaskType,
          dueDate: dueDateTime,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create tasks')
      }

      const result = await response.json()
      toast({ title: 'Success', description: `Created ${result.count} tasks` })

      // Reset state
      setShowBulkTaskDialog(false)
      setBulkTaskTitle('')
      setBulkTaskDescription('')
      setBulkTaskType('task')
      setBulkTaskDueDate('')
      setBulkTaskDueTime('09:00')
      setSelectedConversationIds(new Set())
      setBulkActionMode(false)
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to create tasks', variant: 'destructive' })
    } finally {
      setIsCreatingBulkTasks(false)
    }
  }

  // Handle bulk delete conversations
  const handleBulkDelete = async () => {
    if (selectedConversationIds.size === 0) return

    setIsDeletingConversations(true)
    try {
      // Get contact IDs from selected conversations
      const contactIds = sortedConversations
        .filter(c => selectedConversationIds.has(c.id))
        .map(c => c.contact_id)

      const response = await fetch('/api/conversations/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete conversations')
      }

      const result = await response.json()
      toast({ title: 'Success', description: `Deleted ${result.count} conversations` })

      // Reset state and refresh
      setShowBulkDeleteDialog(false)
      setSelectedConversationIds(new Set())
      setBulkActionMode(false)
      loadConversations()
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to delete conversations', variant: 'destructive' })
    } finally {
      setIsDeletingConversations(false)
    }
  }

  // Get selected contact IDs for bulk tag operations
  const getSelectedContactIds = () => {
    return sortedConversations
      .filter(c => selectedConversationIds.has(c.id))
      .map(c => c.contact_id)
  }

  // Toggle conversation selection
  const toggleConversationSelection = (conversationId: string) => {
    setSelectedConversationIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(conversationId)) {
        newSet.delete(conversationId)
      } else {
        newSet.add(conversationId)
      }
      return newSet
    })
  }

  // Select/deselect all conversations
  const toggleSelectAll = () => {
    if (selectedConversationIds.size === sortedConversations.length) {
      setSelectedConversationIds(new Set())
    } else {
      setSelectedConversationIds(new Set(sortedConversations.map(c => c.id)))
    }
  }

  const truncateMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + "..."
  }

  const formatMessageTime = (timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
    } catch {
      return ""
    }
  }

  const getMessagePreview = (conversation: ConversationData) => {
    if (!conversation.lastMessage) {
      return {
        text: "No messages yet",
        time: "",
        isInbound: false,
        senderNumber: ""
      }
    }

    const msg = conversation.lastMessage
    return {
      text: truncateMessage(msg.content),
      time: formatMessageTime(msg.createdAt),
      isInbound: msg.direction === 'inbound',
      senderNumber: msg.direction === 'outbound' ? msg.fromNumber : ""
    }
  }

  // Sort conversations: unread first, then by most recent message
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      // Unread conversations first
      if (a.hasUnread && !b.hasUnread) return -1
      if (!a.hasUnread && b.hasUnread) return 1

      // Then by most recent message
      const aTime = a.lastMessage?.createdAt || a.last_message_at || ""
      const bTime = b.lastMessage?.createdAt || b.last_message_at || ""

      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })
  }, [conversations])

  return (
    <div className="flex flex-col h-full relative">
      <div className="p-4 border-b flex-shrink-0">
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              type="search"
              placeholder="Search conversations..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && (<div className="text-xs text-muted-foreground mt-1">Searching...</div>)}
          </div>
          <Button
            size="icon"
            variant="outline"
            onClick={() => {
              // Use inline view if callback provided, otherwise use modal
              if (onNewConversation) {
                onNewConversation()
              } else {
                setShowNewMessageModal(true)
              }
            }}
            title="Send new message"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant={bulkActionMode ? "default" : "outline"}
            onClick={() => {
              setBulkActionMode(!bulkActionMode)
              if (bulkActionMode) {
                setSelectedConversationIds(new Set())
              }
            }}
            title={bulkActionMode ? "Exit selection mode" : "Select conversations"}
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
        </div>

        {isLoading && (
          <div className="text-sm text-muted-foreground">Searching...</div>
        )}

        {/* Date Filter */}
        <div className="flex gap-2 mt-3 items-center">
          <Select value={dateFilter} onValueChange={(value: any) => setDateFilter(value)}>
            <SelectTrigger className="w-40 h-9">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Select date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Date Range Picker */}
          {dateFilter === 'custom' && (
            <Popover open={showDateFilter} onOpenChange={setShowDateFilter}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Calendar className="h-4 w-4 mr-2" />
                  Pick Dates
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Start Date</label>
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">End Date</label>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    onClick={() => setShowDateFilter(false)}
                    className="w-full"
                  >
                    Apply
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Clear filters button */}
          {(dateFilter !== 'all' || conversationFilter !== 'all' || directionFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFilter('all')
                setCustomStartDate('')
                setCustomEndDate('')
                setConversationFilter('all')
                setDirectionFilter('all')
              }}
              className="h-9"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Stats Display */}
        <div className="flex gap-2 mt-3 px-2">
          <div
            className={`flex-1 p-3 rounded-lg border-2 cursor-pointer transition-all ${
              conversationFilter === 'all'
                ? 'border-primary bg-primary/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setConversationFilter('all')}
          >
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-semibold">{apiStats.total}</div>
          </div>

          <div
            className={`flex-1 p-3 rounded-lg border-2 cursor-pointer transition-all ${
              conversationFilter === 'unread'
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setConversationFilter('unread')}
          >
            <div className="text-xs text-muted-foreground">Unread</div>
            <div className="text-lg font-semibold text-red-600">{apiStats.unread}</div>
          </div>

          <div
            className={`flex-1 p-3 rounded-lg border-2 cursor-pointer transition-all ${
              conversationFilter === 'read'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => setConversationFilter('read')}
          >
            <div className="text-xs text-muted-foreground">Read</div>
            <div className="text-lg font-semibold text-green-600">{apiStats.read}</div>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {bulkActionMode && (
          <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedConversationIds.size === sortedConversations.length && sortedConversations.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-blue-700">
                  {selectedConversationIds.size} selected
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkTaskDialog(true)}
                disabled={selectedConversationIds.size === 0}
              >
                <ClipboardList className="h-4 w-4 mr-1" />
                Create Tasks
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkTagDialog(true)}
                disabled={selectedConversationIds.size === 0}
              >
                <Tag className="h-4 w-4 mr-1" />
                Assign Tags
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setShowBulkDeleteDialog(true)}
                disabled={selectedConversationIds.size === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden relative" ref={scrollAreaRef}>
        {/* Loading overlay - only shows during filter updates, not initial load */}
        {isLoading && !isInitialLoad && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
          </div>
        )}

        <div className="divide-y">
          {sortedConversations.map((conversation) => {
            const preview = getMessagePreview(conversation)
            const isSelected = selectedContactId === conversation.contact.id

            return (
              <div
                key={conversation.id}
                className={`p-4 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-blue-50 border-l-3 border-blue-500"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => handleContactSelect(conversation)}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox for bulk selection */}
                  {bulkActionMode && (
                    <div className="flex-shrink-0 pt-1" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedConversationIds.has(conversation.id)}
                        onCheckedChange={() => toggleConversationSelection(conversation.id)}
                      />
                    </div>
                  )}
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                        {conversation.contact.firstName?.[0] || ""}
                        {conversation.contact.lastName?.[0] || ""}
                      </AvatarFallback>
                    </Avatar>
                    {conversation.hasUnread && (
                      <div className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full flex items-center justify-center">
                        <span className="text-xs text-white font-medium">
                          {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
                        </span>
                      </div>
                    )}
                    {conversation.isNewMessage && (
                      <div className="absolute -bottom-1 -right-1 h-3 w-3 bg-green-500 rounded-full border-2 border-white" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 overflow-hidden">
                    {/* Header row with name and time */}
                    <div className="flex items-center justify-between mb-1">
                      <h3 className={`font-medium truncate pr-2 ${conversation.hasUnread ? "font-semibold" : ""}`}>
                        <ContactName contact={{...conversation.contact} as any} clickMode="popup" />
                      </h3>
                      <div className="flex-shrink-0">
                        {preview.time && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {preview.time}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Phone number row */}
                    <div className="flex items-center gap-1 mb-1">
                      <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground truncate">
                        {conversation.contact.phone1}
                      </span>
                      {conversation.contact.llcName && (
                        <>
                          <span className="text-muted-foreground text-xs">•</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {conversation.contact.llcName}
                          </span>
                        </>
                      )}
                    </div>
                    {/* Our line indicator (multi-number routing) */}
                    {conversation.our_number && (
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs text-blue-600 truncate">
                          Via: {conversation.our_number}
                        </span>
                      </div>
                    )}

                    {/* Message preview row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        {preview.isInbound ? (
                          <MessageCircle className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        ) : (
                          <div className="h-3 w-3 flex-shrink-0">
                            <div className="h-2 w-2 bg-gray-400 rounded-full ml-0.5" />
                          </div>
                        )}
                        <span className={`text-sm truncate ${
                          conversation.hasUnread && preview.isInbound
                            ? "font-medium text-gray-900"
                            : "text-muted-foreground"
                        }`}>
                          {preview.text}
                        </span>
                      </div>

                      {preview.senderNumber && (
                        <Badge variant="outline" className="text-xs ml-2 flex-shrink-0">
                          {preview.senderNumber}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {sortedConversations.length === 0 && !isLoading && (
            <div className="p-8 text-center text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium mb-2">No conversations found</p>
              <p className="text-sm">
                {searchQuery.trim()
                  ? "Try adjusting your search terms"
                  : "Start a conversation by sending a message"
                }
              </p>
            </div>
          )}

          {/* Loading more indicator */}
          {isLoadingMore && (
            <div className="p-4 text-center">
              <div className="inline-block">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Loading more conversations...</p>
            </div>
          )}

          {/* ADMIN FIX: Load More button for infinite scroll fallback */}
          {hasMore && !isLoadingMore && sortedConversations.length > 0 && (
            <div className="p-4 text-center border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadConversations(true)}
                className="w-full"
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* New Message Modal */}
      <NewTextMessageModal
        open={showNewMessageModal}
        onOpenChange={setShowNewMessageModal}
        onMessageSent={() => {
          // Refresh conversations after sending message
          loadConversations()
        }}
      />

      {/* Bulk Task Creation Dialog */}
      <Dialog open={showBulkTaskDialog} onOpenChange={setShowBulkTaskDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Tasks for {selectedConversationIds.size} Contacts</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bulk-task-title">Task Title *</Label>
              <Input
                id="bulk-task-title"
                value={bulkTaskTitle}
                onChange={(e) => setBulkTaskTitle(e.target.value)}
                placeholder="e.g., Follow up call"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-task-description">Description</Label>
              <Textarea
                id="bulk-task-description"
                value={bulkTaskDescription}
                onChange={(e) => setBulkTaskDescription(e.target.value)}
                placeholder="Optional task description..."
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-task-type">Task Type</Label>
              <Select value={bulkTaskType} onValueChange={(v: any) => setBulkTaskType(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  {savedTaskTypes.length === 0 ? (
                    <>
                      <SelectItem value="task">Task</SelectItem>
                      <SelectItem value="call">Call</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                    </>
                  ) : (
                    savedTaskTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bulk-task-date">Due Date</Label>
                <Input
                  id="bulk-task-date"
                  type="date"
                  value={bulkTaskDueDate}
                  onChange={(e) => setBulkTaskDueDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bulk-task-time">Due Time</Label>
                <Input
                  id="bulk-task-time"
                  type="time"
                  value={bulkTaskDueTime}
                  onChange={(e) => setBulkTaskDueTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkTaskDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkTaskCreation} disabled={isCreatingBulkTasks || !bulkTaskTitle.trim()}>
              {isCreatingBulkTasks ? 'Creating...' : `Create ${selectedConversationIds.size} Tasks`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tag Operations Dialog */}
      <BulkTagOperations
        open={showBulkTagDialog}
        onOpenChange={setShowBulkTagDialog}
        selectedContactIds={getSelectedContactIds()}
        onComplete={() => {
          setSelectedConversationIds(new Set())
          setBulkActionMode(false)
          loadConversations()
        }}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedConversationIds.size} Conversations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all messages in the selected conversations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingConversations}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeletingConversations}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingConversations ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})

EnhancedConversationsList.displayName = 'EnhancedConversationsList'

export default EnhancedConversationsList
