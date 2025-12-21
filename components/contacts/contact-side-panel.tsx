"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { X, Phone, Mail, Building2, Calendar, Tag, MessageSquare, PhoneCall, FileText, CheckSquare, User, Plus, Loader2, Trash2, Edit2, Cloud, CloudOff, GripHorizontal, Minimize2, Maximize2, Pin, PinOff, Copy, ExternalLink, Home, DollarSign, Ruler, BedDouble, Bath, MapPin, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import type { Contact, Activity } from "@/lib/types"
import { format } from "date-fns"
import { useSmsUI } from "@/lib/context/sms-ui-context"
import { useEmailUI } from "@/lib/context/email-ui-context"
import { useMakeCall } from "@/hooks/use-make-call"
import { useTaskUI } from "@/lib/context/task-ui-context"
import { usePhoneNumber } from "@/lib/context/phone-number-context"
import Link from "next/link"

import { TagInput } from "@/components/ui/tag-input"
import { toast } from "sonner"
import ContactSequences from "./contact-sequences"
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
import { normalizePropertyType } from "@/lib/property-type-mapper"
import { CallButtonWithCellHover } from "@/components/ui/call-button-with-cell-hover"
import { AddressAutocomplete, type AddressComponents } from "@/components/ui/address-autocomplete"
import { RichTextEditor, type RichTextEditorRef } from "@/components/ui/rich-text-editor"

interface ContactSidePanelProps {
  contact: Contact | null
  open: boolean
  onClose: () => void
}

interface Task {
  id: string
  subject: string
  description?: string
  status: string
  priority?: string
  dueDate?: string
  taskType?: string
}

interface Deal {
  id: string
  title: string
  value: number
  stage: string
  stageLabel?: string
  stageColor?: string
  probability: number
  isLoanDeal?: boolean
  lenderName?: string
  propertyAddress?: string
}

interface Property {
  id?: string
  address: string
  city: string
  state: string
  zipCode: string
  llcName: string
  propertyType: string
  bedrooms?: number
  totalBathrooms?: number
  buildingSqft?: number
  lotSizeSqft?: number
  lastSaleDate?: string
  lastSaleAmount?: number
  estValue?: number
  estEquity?: number
}

// Phone number type for Telnyx
interface TelnyxPhoneNumber {
  id: string
  phoneNumber: string
  friendlyName?: string
  isActive: boolean
  capabilities: string[]
}

interface ActivityHistoryItem {
  id: string
  type: 'call' | 'sms' | 'email' | 'activity' | 'sequence' | 'tag_added' | 'tag_removed' | 'task'
  title: string
  description?: string
  direction?: 'inbound' | 'outbound'
  status?: string
  timestamp: string
  isPinned?: boolean
  activityId?: string
  metadata?: Record<string, any>
}

// Helper function to render markdown-style bold text
const renderMarkdownBold = (text: string) => {
  if (!text) return null

  // Split by ** markers and render bold text
  const parts = text.split(/(\*\*.*?\*\*)/)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      // Remove the ** markers and render as bold
      const boldText = part.slice(2, -2)
      return <strong key={index} className="font-semibold">{boldText}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

export default function ContactSidePanel({ contact, open, onClose }: ContactSidePanelProps) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [activityHistory, setActivityHistory] = useState<ActivityHistoryItem[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingDeals, setLoadingDeals] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentContact, setCurrentContact] = useState<Contact | null>(contact)

  // Editable fields
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [phones, setPhones] = useState<string[]>([])
  const [emails, setEmails] = useState<string[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedTags, setSelectedTags] = useState<any[]>([])
  const [dealStatus, setDealStatus] = useState<string>("lead")
  const [showActivityHistory, setShowActivityHistory] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedDataRef = useRef<string>('')

  // Removed local phone number state - now using global context

  // Task editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskData, setEditingTaskData] = useState<Partial<Task>>({})

  // Follow-up task dialog state
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false)
  const [completedTask, setCompletedTask] = useState<Task | null>(null)
  const [followUpSubject, setFollowUpSubject] = useState('')
  const [followUpDueDate, setFollowUpDueDate] = useState('')
  const [creatingFollowUp, setCreatingFollowUp] = useState(false)

  // Expanded activity items for long descriptions
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set())

  // Note creation/editing state
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null)
  const editNoteTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Dragging state for non-modal floating panel
  const [isMinimized, setIsMinimized] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 }) // 0,0 means default right side
  const [isDragging, setIsDragging] = useState(false)
  const dragStartPos = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)

  // Resizing state - use default height, then update on mount
  const [panelSize, setPanelSize] = useState({ width: 900, height: 700 })
  const [isResizing, setIsResizing] = useState<string | null>(null) // 'right', 'bottom', 'corner'
  const resizeStartPos = useRef({ x: 0, y: 0 })
  const resizeStartSize = useRef({ width: 900, height: 700 })

  // Rich text editor ref
  const richTextEditorRef = useRef<RichTextEditorRef>(null)

  const { openSms } = useSmsUI()
  const { openEmail } = useEmailUI()
  const { makeCall } = useMakeCall()
  const { openTask, setOnTaskCreated } = useTaskUI()
  const { selectedPhoneNumber } = usePhoneNumber() // Use global phone number

  // Dragging handlers
  const handleDragStart = (e: React.MouseEvent) => {
    if (!panelRef.current) return
    setIsDragging(true)
    const rect = panelRef.current.getBoundingClientRect()
    dragStartPos.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
    // Prevent text selection while dragging
    e.preventDefault()
  }

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newX = e.clientX - dragStartPos.current.x
    const newY = e.clientY - dragStartPos.current.y
    // Clamp to viewport
    const maxX = window.innerWidth - 800 // panel width
    const maxY = window.innerHeight - 100
    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    })
  }, [isDragging])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(direction)
    resizeStartPos.current = { x: e.clientX, y: e.clientY }
    resizeStartSize.current = { ...panelSize }
  }

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const deltaX = e.clientX - resizeStartPos.current.x
    const deltaY = e.clientY - resizeStartPos.current.y

    let newWidth = resizeStartSize.current.width
    let newHeight = resizeStartSize.current.height

    if (isResizing === 'right' || isResizing === 'corner') {
      newWidth = Math.max(600, Math.min(1400, resizeStartSize.current.width + deltaX))
    }
    if (isResizing === 'bottom' || isResizing === 'corner') {
      newHeight = Math.max(300, Math.min(window.innerHeight - 50, resizeStartSize.current.height + deltaY))
    }
    if (isResizing === 'left') {
      newWidth = Math.max(600, Math.min(1400, resizeStartSize.current.width - deltaX))
    }
    if (isResizing === 'top') {
      newHeight = Math.max(300, Math.min(window.innerHeight - 50, resizeStartSize.current.height - deltaY))
    }

    setPanelSize({ width: newWidth, height: newHeight })
  }, [isResizing])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(null)
  }, [])

  // Attach/detach global mouse handlers for dragging and resizing
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove)
      window.addEventListener('mouseup', handleDragEnd)
    }
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, isResizing, handleDragMove, handleDragEnd, handleResizeMove, handleResizeEnd])

  // Reset position when opening
  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      setPosition({ x: 0, y: 0 })
      setIsMinimized(false)
      setPanelSize({ width: 900, height: window.innerHeight - 32 })
    }
  }, [open, contact?.id])

  // Initialize form when contact changes
  useEffect(() => {
    if (contact && open) {
      setCurrentContact(contact)
      initializeForm(contact)
    }
  }, [contact, open])

  const initializeForm = (c: Contact) => {
    setFirstName(c.firstName || "")
    setLastName(c.lastName || "")

    // Collect phones (only non-empty)
    const phoneList = [c.phone1, c.phone2, c.phone3].filter(Boolean) as string[]
    setPhones(phoneList.length > 0 ? phoneList : [""])

    // Collect emails (only non-empty)
    const emailList = [c.email1, c.email2, c.email3].filter(Boolean) as string[]
    setEmails(emailList.length > 0 ? emailList : [""])

    // Collect properties
    const propList: Property[] = []
    // Helper to format zipcode (removes decimals like 34239.0 -> 34239)
    const formatZip = (zip: string | number | null | undefined): string => {
      if (zip === null || zip === undefined) return ""
      return String(zip).replace(/\.0+$/, '')
    }

    // Add primary property from contact if exists
    if (c.propertyAddress) {
      propList.push({
        address: c.propertyAddress || "",
        city: c.city || "",
        state: c.state || "",
        zipCode: formatZip(c.zipCode),
        llcName: c.llcName || "",
        propertyType: normalizePropertyType(c.propertyType) || "",
        bedrooms: c.bedrooms ?? undefined,
        totalBathrooms: c.totalBathrooms ?? undefined,
        buildingSqft: c.buildingSqft ?? undefined,
        lotSizeSqft: (c as any).lotSizeSqft ?? undefined,
        lastSaleDate: (c as any).lastSaleDate ?? undefined,
        lastSaleAmount: (c as any).lastSaleAmount ?? undefined,
        estValue: c.estValue ?? undefined,
        estEquity: c.estEquity ?? undefined,
      })
    }
    // Add additional properties
    if ((c as any).properties) {
      (c as any).properties.forEach((p: any) => {
        propList.push({
          id: p.id,
          address: p.address || "",
          city: p.city || "",
          state: p.state || "",
          zipCode: formatZip(p.zipCode),
          llcName: p.llcName || "",
          propertyType: normalizePropertyType(p.propertyType) || "",
          bedrooms: p.bedrooms,
          totalBathrooms: p.totalBathrooms,
          buildingSqft: p.buildingSqft,
          lotSizeSqft: p.lotSizeSqft,
          lastSaleDate: p.lastSaleDate,
          lastSaleAmount: p.lastSaleAmount,
          estValue: p.estValue,
          estEquity: p.estEquity,
        })
      })
    }
    setProperties(propList.length > 0 ? propList : [{ address: "", city: "", state: "", zipCode: "", llcName: "", propertyType: "" }])

    setSelectedTags(c.tags || [])
    setDealStatus(c.dealStatus || "lead")
    setHasChanges(false)
  }

  // Fetch full contact details
  useEffect(() => {
    const fetchFullContact = async () => {
      if (contact?.id && open) {
        try {
          const res = await fetch(`/api/contacts/${contact.id}`)
          if (res.ok) {
            const fullContact = await res.json()
            setCurrentContact(fullContact)
            initializeForm(fullContact)
          }
        } catch (error) {
          console.error('Failed to fetch full contact:', error)
        }
      }
    }
    fetchFullContact()
  }, [contact?.id, open])

  useEffect(() => {
    if (contact?.id && open) {
      loadActivities()
      loadTasks()
      loadDeals()
    }
  }, [contact?.id, open])

  // Register callback to refresh tasks when a task is created via global modal
  useEffect(() => {
    if (open && contact?.id) {
      setOnTaskCreated(() => {
        loadTasks()
      })
      return () => {
        setOnTaskCreated(undefined)
      }
    }
  }, [open, contact?.id, setOnTaskCreated])

  // Listen for activity-created and task-created events to refresh instantly
  useEffect(() => {
    const handleActivityCreated = (e: CustomEvent) => {
      if (e.detail?.contactId === contact?.id) {
        loadActivities()
      }
    }
    const handleTaskCreated = (e: CustomEvent) => {
      if (e.detail?.contactId === contact?.id) {
        loadTasks()
      }
    }
    window.addEventListener('activity-created', handleActivityCreated as EventListener)
    window.addEventListener('task-created', handleTaskCreated as EventListener)
    return () => {
      window.removeEventListener('activity-created', handleActivityCreated as EventListener)
      window.removeEventListener('task-created', handleTaskCreated as EventListener)
    }
  }, [contact?.id])

  // Removed loadTelnyxPhoneNumbers - now using global phone number context

  // Auto-save functionality with debounce
  const performAutoSave = useCallback(async () => {
    if (!currentContact) return

    const payload: any = {
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      phone1: phones[0] || undefined,
      phone2: phones[1] || undefined,
      phone3: phones[2] || undefined,
      email1: emails[0] || undefined,
      email2: emails[1] || undefined,
      email3: emails[2] || undefined,
      dealStatus,
      tags: selectedTags.map((t: any) => ({
        id: typeof t.id === 'string' && t.id.startsWith('new:') ? undefined : t.id,
        name: t.name,
        color: t.color || '#3B82F6'
      })),
    }

    // First property goes to contact record
    if (properties[0]) {
      payload.propertyAddress = properties[0].address || undefined
      payload.city = properties[0].city || undefined
      payload.state = properties[0].state || undefined
      payload.zipCode = properties[0].zipCode || undefined
      payload.llcName = properties[0].llcName || undefined
      payload.propertyType = properties[0].propertyType || undefined
      payload.bedrooms = properties[0].bedrooms
      payload.totalBathrooms = properties[0].totalBathrooms
      payload.buildingSqft = properties[0].buildingSqft
      payload.lotSizeSqft = properties[0].lotSizeSqft
      payload.lastSaleDate = properties[0].lastSaleDate
      payload.lastSaleAmount = properties[0].lastSaleAmount
      payload.estValue = properties[0].estValue
      payload.estEquity = properties[0].estEquity
    }

    // Additional properties
    if (properties.length > 1) {
      payload.additionalProperties = properties.slice(1).map(p => ({
        id: p.id,
        address: p.address,
        city: p.city,
        state: p.state,
        zipCode: p.zipCode,
        llcName: p.llcName,
        propertyType: p.propertyType,
        bedrooms: p.bedrooms,
        totalBathrooms: p.totalBathrooms,
        buildingSqft: p.buildingSqft,
        lotSizeSqft: p.lotSizeSqft,
        lastSaleDate: p.lastSaleDate,
        lastSaleAmount: p.lastSaleAmount,
        estValue: p.estValue,
        estEquity: p.estEquity,
      }))
    }

    // Check if data actually changed
    const currentDataString = JSON.stringify(payload)
    if (currentDataString === lastSavedDataRef.current) {
      return // No changes, skip save
    }

    setSaveStatus('saving')
    console.log('[ContactPanel] Auto-saving...', { tags: payload.tags?.length })
    try {
      const res = await fetch(`/api/contacts/${currentContact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const updated = await res.json()
        console.log('[ContactPanel] Saved successfully', { tags: updated.tags?.length })
        setCurrentContact(updated)

        // Update local state with server response to sync any new tag IDs
        setSelectedTags(updated.tags || [])

        lastSavedDataRef.current = currentDataString
        setSaveStatus('saved')
        setHasChanges(false)
        toast.success('Auto-saved ✓', { duration: 2000 })

        // Emit event to notify contacts list to update this contact
        window.dispatchEvent(new CustomEvent('contact-updated', {
          detail: { contactId: currentContact.id, updatedContact: updated }
        }))

        // Emit event to notify tag components to refresh their data
        window.dispatchEvent(new CustomEvent('tags-updated'))

        // Reset to idle after 2 seconds
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        const errText = await res.text()
        console.error('[ContactPanel] Save failed:', res.status, errText)
        setSaveStatus('error')
        toast.error('Failed to save changes')
      }
    } catch (error) {
      console.error('Auto-save failed:', error)
      setSaveStatus('error')
      toast.error('Failed to save changes')
    }
  }, [currentContact, firstName, lastName, phones, emails, properties, selectedTags, dealStatus])

  // Trigger auto-save when changes are made (debounced)
  const markChanged = useCallback(() => {
    setHasChanges(true)

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Set new timeout for auto-save (800ms debounce)
    saveTimeoutRef.current = setTimeout(() => {
      performAutoSave()
    }, 800)
  }, [performAutoSave])

  // Instant save for tags (no debounce) - accepts new tags directly to avoid async state issues
  const saveTagsInstantly = useCallback(async (newTags: any[]) => {
    if (!currentContact) return

    setHasChanges(true)
    setSelectedTags(newTags) // Update local state

    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Save immediately with the new tags passed directly (not from state)
    setSaveStatus('saving')
    try {
      const payload: any = {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone1: phones[0] || undefined,
        phone2: phones[1] || undefined,
        phone3: phones[2] || undefined,
        email1: emails[0] || undefined,
        email2: emails[1] || undefined,
        email3: emails[2] || undefined,
        dealStatus,
        tags: newTags.map((t: any) => ({
          id: typeof t.id === 'string' && t.id.startsWith('new:') ? undefined : t.id,
          name: t.name,
          color: t.color || '#3B82F6'
        })),
      }

      // First property goes to contact record
      if (properties[0]) {
        payload.propertyAddress = properties[0].address || undefined
        payload.city = properties[0].city || undefined
        payload.state = properties[0].state || undefined
        payload.zipCode = properties[0].zipCode || undefined
        payload.llcName = properties[0].llcName || undefined
        payload.propertyType = properties[0].propertyType || undefined
      }

      const res = await fetch(`/api/contacts/${currentContact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const updated = await res.json()
        console.log('[ContactPanel] Tags saved successfully', { tags: updated.tags?.length })
        setCurrentContact(updated)
        setSelectedTags(updated.tags || [])
        setSaveStatus('saved')
        setHasChanges(false)
        toast.success('Tags updated ✓', { duration: 2000 })

        // Emit event to notify contacts list to update this contact
        window.dispatchEvent(new CustomEvent('contact-updated', {
          detail: { contactId: currentContact.id, updatedContact: updated }
        }))

        // Emit event to notify tag components to refresh their data
        window.dispatchEvent(new CustomEvent('tags-updated'))

        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        const errText = await res.text()
        console.error('[ContactPanel] Tag save failed:', res.status, errText)
        setSaveStatus('error')
        toast.error('Failed to save tags')
      }
    } catch (error) {
      console.error('Tag save failed:', error)
      setSaveStatus('error')
      toast.error('Failed to save tags')
    }
  }, [currentContact, firstName, lastName, phones, emails, properties, dealStatus])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  // Save pending changes when panel closes
  useEffect(() => {
    if (!open && hasChanges) {
      performAutoSave()
    }
  }, [open, hasChanges, performAutoSave])

  // Handle call using multi-call system
  const handleCall = async (phone: string) => {
    if (!currentContact) return
    const contactName = `${currentContact.firstName || ''} ${currentContact.lastName || ''}`.trim()
    await makeCall({
      phoneNumber: phone,
      contactId: currentContact.id,
      contactName,
    })
  }

  const handleText = (phone: string) => {
    if (!currentContact) return
    openSms({
      phoneNumber: phone,
      contact: {
        id: currentContact.id,
        firstName: currentContact.firstName,
        lastName: currentContact.lastName,
      },
    })
  }

  const handleEmail = (emailAddr: string) => {
    if (!currentContact) return
    openEmail({
      email: emailAddr,
      contact: {
        id: currentContact.id,
        firstName: currentContact.firstName,
        lastName: currentContact.lastName,
      },
    })
  }

  // Task completion handler
  const handleTaskComplete = async (taskId: string, completed: boolean) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: completed ? 'completed' : 'open' }),
      })

      if (res.ok) {
        // Update local state
        const task = tasks.find(t => t.id === taskId)
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: completed ? 'completed' : 'open' } : t
        ))
        toast.success(completed ? 'Task completed!' : 'Task reopened')

        // If completing a task, show follow-up dialog
        if (completed && task) {
          setCompletedTask(task)
          setFollowUpSubject(`Follow up: ${task.subject}`)
          // Default to 7 days from now
          const followUpDate = new Date()
          followUpDate.setDate(followUpDate.getDate() + 7)
          setFollowUpDueDate(followUpDate.toISOString().split('T')[0])
          setShowFollowUpDialog(true)
        }
      } else {
        toast.error('Failed to update task')
      }
    } catch (error) {
      console.error('Failed to update task:', error)
      toast.error('Failed to update task')
    }
  }

  // Create follow-up task
  const handleCreateFollowUp = async () => {
    if (!currentContact || !followUpSubject.trim()) return

    setCreatingFollowUp(true)
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'task',
          taskType: completedTask?.taskType || 'Follow Up',
          subject: followUpSubject.trim(),
          description: '',
          priority: 'low', // Default follow-up tasks to low priority
          status: 'planned',
          dueDate: followUpDueDate ? new Date(followUpDueDate).toISOString() : undefined,
          contactId: currentContact.id,
        }),
      })

      if (res.ok) {
        const newTask = await res.json()
        setTasks(prev => [...prev, {
          id: newTask.id,
          subject: newTask.subject,
          description: newTask.description,
          status: newTask.status,
          priority: newTask.priority,
          dueDate: newTask.dueDate,
          taskType: newTask.taskType,
        }])
        toast.success('Follow-up task created!')
        setShowFollowUpDialog(false)
        setCompletedTask(null)
        setFollowUpSubject('')
        setFollowUpDueDate('')
      } else {
        toast.error('Failed to create follow-up task')
      }
    } catch (error) {
      console.error('Failed to create follow-up task:', error)
      toast.error('Failed to create follow-up task')
    } finally {
      setCreatingFollowUp(false)
    }
  }

  // Skip follow-up task
  const handleSkipFollowUp = () => {
    setShowFollowUpDialog(false)
    setCompletedTask(null)
    setFollowUpSubject('')
    setFollowUpDueDate('')
  }

  // Start editing a task
  const startEditingTask = (task: Task) => {
    setEditingTaskId(task.id)
    setEditingTaskData({
      subject: task.subject,
      description: task.description,
      dueDate: task.dueDate,
      priority: task.priority,
    })
  }

  // Cancel task editing
  const cancelEditingTask = () => {
    setEditingTaskId(null)
    setEditingTaskData({})
  }

  // Save task edits
  const saveTaskEdit = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTaskData),
      })

      if (res.ok) {
        // Update local state
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, ...editingTaskData } : t
        ))
        setEditingTaskId(null)
        setEditingTaskData({})
        toast.success('Task updated')
      } else {
        toast.error('Failed to update task')
      }
    } catch (error) {
      console.error('Failed to update task:', error)
      toast.error('Failed to update task')
    }
  }

  // Open task creation dialog
  const handleCreateTask = () => {
    if (!currentContact) return
    openTask({
      contact: {
        id: currentContact.id,
        firstName: currentContact.firstName,
        lastName: currentContact.lastName,
        email1: currentContact.email1 || undefined,
        phone1: currentContact.phone1 || undefined,
        propertyAddress: currentContact.propertyAddress || undefined,
      },
      contactId: currentContact.id,
    })
  }

  const loadActivities = async () => {
    if (!contact?.id) return
    setLoading(true)
    try {
      // Fetch comprehensive activity history (calls, SMS, emails, sequences, etc.)
      const historyResponse = await fetch(`/api/contacts/${contact.id}/activity-history?limit=100`)
      if (historyResponse.ok) {
        const historyData = await historyResponse.json()
        setActivityHistory(historyData.items || [])
      }

      // Also fetch traditional activities for backward compatibility
      const response = await fetch(`/api/activities?contactId=${contact.id}`)
      if (response.ok) {
        const data = await response.json()
        setActivities(data)
      }
    } catch (error) {
      console.error('Failed to load activities:', error)
    } finally {
      setLoading(false)
    }
  }

  // Handle bold text formatting (Cmd+B or Ctrl+B) for new note
  const handleBoldText = () => {
    const textarea = noteTextareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = newNote.substring(start, end)

    if (selectedText) {
      // Wrap selected text in ** for bold
      const before = newNote.substring(0, start)
      const after = newNote.substring(end)
      const newText = `${before}**${selectedText}**${after}`

      setNewNote(newText)

      // Restore cursor position after the bold markers
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 2, end + 2)
      }, 0)
    } else {
      // No selection - insert ** markers and place cursor between them
      const before = newNote.substring(0, start)
      const after = newNote.substring(start)
      const newText = `${before}****${after}`

      setNewNote(newText)

      // Place cursor between the markers
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 2, start + 2)
      }, 0)
    }
  }

  // Handle bold text formatting for editing existing note
  const handleBoldTextEdit = () => {
    const textarea = editNoteTextareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = editingNoteText.substring(start, end)

    if (selectedText) {
      // Wrap selected text in ** for bold
      const before = editingNoteText.substring(0, start)
      const after = editingNoteText.substring(end)
      const newText = `${before}**${selectedText}**${after}`

      setEditingNoteText(newText)

      // Restore cursor position after the bold markers
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 2, end + 2)
      }, 0)
    } else {
      // No selection - insert ** markers and place cursor between them
      const before = editingNoteText.substring(0, start)
      const after = editingNoteText.substring(start)
      const newText = `${before}****${after}`

      setEditingNoteText(newText)

      // Place cursor between the markers
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + 2, start + 2)
      }, 0)
    }
  }

  const handleSaveNote = async () => {
    if (!contact?.id || !newNote.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          type: 'note',
          title: 'Note',
          description: newNote.trim(),
          status: 'completed',
        }),
      })
      if (res.ok) {
        toast.success('Note saved')
        setNewNote('')
        // Refresh activity history
        loadActivities()
        // Emit event to notify other components
        window.dispatchEvent(new CustomEvent('activity-created', {
          detail: { contactId: contact.id }
        }))
      } else {
        toast.error('Failed to save note')
      }
    } catch (error) {
      console.error('Failed to save note:', error)
      toast.error('Failed to save note')
    } finally {
      setSavingNote(false)
    }
  }

  const handleEditNote = async (activityId: string) => {
    if (!editingNoteText.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editingNoteText.trim(),
        }),
      })
      if (res.ok) {
        toast.success('Note updated')
        setEditingNoteId(null)
        setEditingNoteText('')
        loadActivities()
      } else {
        toast.error('Failed to update note')
      }
    } catch (error) {
      console.error('Failed to update note:', error)
      toast.error('Failed to update note')
    } finally {
      setSavingNote(false)
    }
  }

  // Track pending deletes for undo functionality
  const pendingDeleteRef = useRef<{ id: string; timeoutId: NodeJS.Timeout } | null>(null)
  const [hiddenNoteIds, setHiddenNoteIds] = useState<Set<string>>(new Set())

  const handleDeleteNote = async (activityId: string) => {
    // Clear any previous pending delete
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeoutId)
    }

    // Hide the note immediately from UI
    setHiddenNoteIds(prev => new Set(prev).add(activityId))

    // Show toast with undo option
    const timeoutId = setTimeout(async () => {
      // Actually delete after delay if not undone
      try {
        const res = await fetch(`/api/activities/${activityId}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          loadActivities()
        } else {
          // Restore if failed
          setHiddenNoteIds(prev => {
            const next = new Set(prev)
            next.delete(activityId)
            return next
          })
          toast.error('Failed to delete note')
        }
      } catch (error) {
        console.error('Failed to delete note:', error)
        setHiddenNoteIds(prev => {
          const next = new Set(prev)
          next.delete(activityId)
          return next
        })
        toast.error('Failed to delete note')
      }
      pendingDeleteRef.current = null
    }, 5000) // 5 second delay before actual delete

    pendingDeleteRef.current = { id: activityId, timeoutId }

    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          if (pendingDeleteRef.current?.id === activityId) {
            clearTimeout(pendingDeleteRef.current.timeoutId)
            pendingDeleteRef.current = null
            // Restore the note in UI
            setHiddenNoteIds(prev => {
              const next = new Set(prev)
              next.delete(activityId)
              return next
            })
            toast.success('Note restored')
          }
        }
      },
      duration: 5000,
    })
  }

  // Helper to copy address to clipboard
  const copyFullAddress = (prop: Property) => {
    const fullAddress = [prop.address, prop.city, prop.state, prop.zipCode].filter(Boolean).join(', ')
    navigator.clipboard.writeText(fullAddress)
    toast.success('Address copied!')
  }

  // Helper to open Google search for address
  const searchAddressOnGoogle = (prop: Property) => {
    const fullAddress = [prop.address, prop.city, prop.state, prop.zipCode].filter(Boolean).join(' ')
    window.open(`https://www.google.com/search?q=${encodeURIComponent(fullAddress)}`, '_blank')
  }

  const loadTasks = async () => {
    if (!contact?.id) return
    setLoadingTasks(true)
    try {
      const response = await fetch(`/api/tasks?contactId=${contact.id}`)
      if (response.ok) {
        const data = await response.json()
        setTasks(data.tasks || [])
      }
    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      setLoadingTasks(false)
    }
  }

  const loadDeals = async () => {
    if (!contact?.id) return
    setLoadingDeals(true)
    try {
      const response = await fetch(`/api/deals?contactId=${contact.id}`)
      if (response.ok) {
        const data = await response.json()
        setDeals(data.deals || [])
      }
    } catch (error) {
      console.error('Failed to load deals:', error)
    } finally {
      setLoadingDeals(false)
    }
  }

  // Phone management
  const addPhone = () => {
    if (phones.length < 3) {
      setPhones([...phones, ""])
      markChanged()
    }
  }
  const removePhone = (idx: number) => {
    if (phones.length > 1) {
      setPhones(phones.filter((_, i) => i !== idx))
      markChanged()
    }
  }
  const updatePhone = (idx: number, value: string) => {
    const newPhones = [...phones]
    newPhones[idx] = value
    setPhones(newPhones)
    markChanged()
  }

  // Email management
  const addEmail = () => {
    if (emails.length < 3) {
      setEmails([...emails, ""])
      markChanged()
    }
  }
  const removeEmail = (idx: number) => {
    if (emails.length > 1) {
      setEmails(emails.filter((_, i) => i !== idx))
      markChanged()
    }
  }
  const updateEmail = (idx: number, value: string) => {
    const newEmails = [...emails]
    newEmails[idx] = value
    setEmails(newEmails)
    markChanged()
  }

  // Property management
  const addProperty = () => {
    setProperties([...properties, { address: "", city: "", state: "", zipCode: "", llcName: "", propertyType: "" }])
    markChanged()
  }
  const removeProperty = (idx: number) => {
    if (properties.length > 1) {
      setProperties(properties.filter((_, i) => i !== idx))
      markChanged()
    }
  }
  const updateProperty = (idx: number, field: keyof Property, value: any) => {
    const newProps = [...properties]
    ;(newProps[idx] as any)[field] = value
    setProperties(newProps)
    markChanged()
  }

  // Listen for global close-all-panels event (triggered by Cmd/Ctrl+X)
  // This must be before any conditional returns to avoid hooks order issues
  useEffect(() => {
    const handleCloseAll = () => {
      if (open) {
        onClose()
      }
    }

    window.addEventListener('close-all-panels', handleCloseAll)
    return () => window.removeEventListener('close-all-panels', handleCloseAll)
  }, [open, onClose])

  if (!open || !contact) return null

  // Split tasks into open and completed
  const openTasks = tasks.filter(t => t.status !== 'completed')

  const getActivityIcon = (type: string, direction?: string) => {
    switch (type) {
      case 'call':
        return direction === 'inbound'
          ? <Phone className="h-4 w-4 text-blue-500" />
          : <PhoneCall className="h-4 w-4 text-blue-600" />
      case 'sms': case 'text':
        return <MessageSquare className={`h-4 w-4 ${direction === 'inbound' ? 'text-green-500' : 'text-green-600'}`} />
      case 'email':
        return <Mail className={`h-4 w-4 ${direction === 'inbound' ? 'text-purple-500' : 'text-purple-600'}`} />
      case 'task': return <CheckSquare className="h-4 w-4 text-orange-500" />
      case 'sequence': return <Calendar className="h-4 w-4 text-indigo-500" />
      case 'tag_added': return <Tag className="h-4 w-4 text-emerald-500" />
      case 'tag_removed': return <Tag className="h-4 w-4 text-red-400" />
      case 'activity': case 'note': return <FileText className="h-4 w-4 text-gray-500" />
      case 'meeting': return <Calendar className="h-4 w-4 text-cyan-500" />
      default: return <FileText className="h-4 w-4 text-gray-400" />
    }
  }

  // Minimized pill view
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 shadow-lg border bg-white rounded-full px-4 py-2 flex items-center gap-3 cursor-pointer hover:shadow-xl transition-shadow"
        onClick={() => setIsMinimized(false)}
      >
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-medium">{firstName} {lastName}</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setIsMinimized(false) }}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); onClose() }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  // Calculate panel position - default to right side, or use dragged position
  const panelStyle = position.x === 0 && position.y === 0
    ? { right: 0, top: 0 } // Default right-side position
    : { left: position.x, top: position.y, right: 'auto' } // Dragged position

  // No overlay - panel is non-modal
  return (
    <div
      ref={panelRef}
      className="fixed bg-white shadow-2xl z-50 flex flex-col rounded-lg border overflow-hidden"
      style={{
        ...panelStyle,
        width: panelSize.width,
        height: panelSize.height,
        maxHeight: 'calc(100vh - 32px)',
        margin: position.x === 0 && position.y === 0 ? '16px' : 0
      }}
    >
      {/* Resize handles - wider for easier grabbing */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-400/50 transition-colors group"
        onMouseDown={(e) => handleResizeStart(e, 'left')}
      >
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-gray-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-blue-400/50 transition-colors group"
        onMouseDown={(e) => handleResizeStart(e, 'right')}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-gray-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-400/50 transition-colors group"
        onMouseDown={(e) => handleResizeStart(e, 'bottom')}
      >
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-16 bg-gray-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-400/50 transition-colors group z-10"
        onMouseDown={(e) => handleResizeStart(e, 'top')}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-16 bg-gray-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-blue-400/30 transition-colors rounded-tl"
        onMouseDown={(e) => handleResizeStart(e, 'corner')}
      >
        <div className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 border-r-2 border-b-2 border-gray-400 rounded-br-sm" />
      </div>
      {/* Draggable Header */}
      <div
        className="flex items-center justify-between p-2 border-b bg-gradient-to-r from-primary/5 to-primary/10 cursor-move select-none"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <GripHorizontal className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div className="flex gap-1 flex-1 min-w-0" onMouseDown={(e) => e.stopPropagation()}>
            <Input
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); markChanged() }}
              placeholder="First"
              className="h-7 text-sm font-semibold bg-white/50 min-w-0"
            />
            <Input
              value={lastName}
              onChange={(e) => { setLastName(e.target.value); markChanged() }}
              placeholder="Last"
              className="h-7 text-sm font-semibold bg-white/50 min-w-0"
            />
          </div>
        </div>
        <div className="flex items-center gap-1 ml-1 flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>
          {/* Auto-save status indicator */}
          <div className="flex items-center gap-1 text-xs mr-2">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1 text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="font-medium">Saving...</span>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded">
                <Cloud className="h-3 w-3" />
                <span className="font-medium">Saved</span>
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="flex items-center gap-1 text-red-700 bg-red-50 px-2 py-0.5 rounded cursor-pointer" onClick={performAutoSave} title="Click to retry">
                <CloudOff className="h-3 w-3" />
                <span className="font-medium">Error</span>
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsMinimized(true)} className="h-6 w-6">
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content - Two Column Layout - Contact Info on LEFT, Activity/Notes on RIGHT */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Contact Details (wider for better readability) */}
        <ScrollArea className="w-[360px] border-r bg-white flex-shrink-0">
          <div className="p-4 space-y-4">
            {/* Quick Action Buttons - Icon only with call via cell hover */}
            <div className="flex gap-2 justify-center">
              {phones[0] && (
                <>
                  <CallButtonWithCellHover
                    phoneNumber={phones[0]}
                    contactId={currentContact?.id}
                    contactName={`${firstName} ${lastName}`.trim()}
                    onWebRTCCall={() => handleCall(phones[0])}
                    className="h-9 w-9 hover:bg-blue-50"
                    iconClassName="h-5 w-5 text-blue-600"
                  />
                  <button
                    onClick={() => handleText(phones[0])}
                    className="h-9 w-9 rounded-md hover:bg-green-50 text-green-600 transition-colors flex items-center justify-center"
                    title="Send SMS"
                  >
                    <MessageSquare className="h-5 w-5" />
                  </button>
                </>
              )}
              {emails[0] && (
                <button
                  onClick={() => handleEmail(emails[0])}
                  className="h-9 w-9 rounded-md hover:bg-purple-50 text-purple-600 transition-colors flex items-center justify-center"
                  title="Send Email"
                >
                  <Mail className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Contact Information - Phones & Emails */}
            <Card className="border-blue-100">
              <CardHeader className="pb-2 pt-3 px-3 bg-blue-50/50">
                <CardTitle className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  Contact Info
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                {/* Phones */}
                {phones.map((phone, idx) => (
                  <div key={`phone-${idx}`} className="flex items-center gap-2">
                    <Input
                      value={phone}
                      onChange={(e) => updatePhone(idx, e.target.value)}
                      placeholder={`Phone ${idx + 1}`}
                      type="tel"
                      className="h-7 text-xs flex-1"
                    />
                    {phone && (
                      <div className="flex items-center gap-0.5">
                        <CallButtonWithCellHover
                          phoneNumber={phone}
                          contactId={currentContact?.id}
                          contactName={`${firstName} ${lastName}`.trim()}
                          onWebRTCCall={() => handleCall(phone)}
                          className="h-6 w-6 p-0"
                        />
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-green-50" onClick={() => handleText(phone)} title="Text">
                          <MessageSquare className="h-3 w-3 text-green-600" />
                        </Button>
                      </div>
                    )}
                    {phones.length > 1 && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-red-50" onClick={() => removePhone(idx)}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    )}
                  </div>
                ))}
                {phones.length < 3 && (
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] text-blue-600 p-0" onClick={addPhone}>
                    <Plus className="h-2.5 w-2.5 mr-0.5" /> Add Phone
                  </Button>
                )}
                <div className="border-t pt-2 mt-2">
                  {emails.map((email, idx) => (
                    <div key={`email-${idx}`} className="flex items-center gap-2 mb-1">
                      <Input
                        value={email}
                        onChange={(e) => updateEmail(idx, e.target.value)}
                        placeholder={`Email ${idx + 1}`}
                        type="email"
                        className="h-7 text-xs flex-1"
                      />
                      {email && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-purple-50" onClick={() => handleEmail(email)} title="Email">
                          <Mail className="h-3 w-3 text-purple-600" />
                        </Button>
                      )}
                      {emails.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-red-50" onClick={() => removeEmail(idx)}>
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {emails.length < 3 && (
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] text-blue-600 p-0" onClick={addEmail}>
                      <Plus className="h-2.5 w-2.5 mr-0.5" /> Add Email
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Properties Section - with icons */}
            <Card className="border-emerald-100">
              <CardHeader className="pb-2 pt-3 px-3 bg-emerald-50/50">
                <CardTitle className="text-xs font-semibold text-emerald-700 uppercase tracking-wide flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Home className="h-3.5 w-3.5" />
                    Properties ({properties.length})
                  </div>
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] text-emerald-600 p-0" onClick={addProperty}>
                    <Plus className="h-2.5 w-2.5 mr-0.5" /> Add
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-2">
                {properties.map((prop, idx) => (
                  <div key={idx} className="p-2 rounded-lg border border-gray-200 bg-gray-50/50 space-y-2">
                    {/* Full address display with copy/search icons */}
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium text-gray-700 truncate flex-1">
                        {prop.address ? `${prop.address}${prop.city ? `, ${prop.city}` : ''}${prop.state ? `, ${prop.state}` : ''} ${prop.zipCode || ''}` : 'No address'}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 hover:bg-blue-50"
                          onClick={() => copyFullAddress(prop)}
                          title="Copy address"
                        >
                          <Copy className="h-3 w-3 text-blue-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 hover:bg-green-50"
                          onClick={() => searchAddressOnGoogle(prop)}
                          title="Search on Google"
                        >
                          <ExternalLink className="h-3 w-3 text-green-500" />
                        </Button>
                        {properties.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 hover:bg-red-50" onClick={() => removeProperty(idx)}>
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* Address inputs */}
                    <AddressAutocomplete
                      value={prop.address}
                      onChange={(value) => updateProperty(idx, 'address', value)}
                      onAddressSelect={(addr: AddressComponents) => {
                        updateProperty(idx, 'address', addr.address);
                        updateProperty(idx, 'city', addr.city);
                        updateProperty(idx, 'state', addr.state);
                        updateProperty(idx, 'zipCode', addr.zipCode);
                      }}
                      placeholder="Street address"
                      className="h-6 text-xs"
                    />
                    <div className="grid grid-cols-3 gap-1">
                      <Input value={prop.city} onChange={(e) => updateProperty(idx, 'city', e.target.value)} placeholder="City" className="h-6 text-[10px]" />
                      <Input value={prop.state} onChange={(e) => updateProperty(idx, 'state', e.target.value)} placeholder="State" className="h-6 text-[10px]" />
                      <Input value={prop.zipCode} onChange={(e) => updateProperty(idx, 'zipCode', e.target.value)} placeholder="Zip" className="h-6 text-[10px]" />
                    </div>
                    <Input value={prop.llcName} onChange={(e) => updateProperty(idx, 'llcName', e.target.value)} placeholder="LLC Name" className="h-6 text-xs" />
                    {/* Property type */}
                    <Select value={prop.propertyType || ''} onValueChange={(v) => updateProperty(idx, 'propertyType', v)}>
                      <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Property Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Single-family (SFH)">🏠 Single-family</SelectItem>
                        <SelectItem value="Duplex">🏘️ Duplex</SelectItem>
                        <SelectItem value="Triplex">🏘️ Triplex</SelectItem>
                        <SelectItem value="Quadplex">🏘️ Quadplex</SelectItem>
                        <SelectItem value="Multi-family">🏢 Multi-family (5+)</SelectItem>
                        <SelectItem value="Townhouse">🏡 Townhouse</SelectItem>
                        <SelectItem value="Condo">🏙️ Condo</SelectItem>
                        <SelectItem value="Mobile Home">🏕️ Mobile Home</SelectItem>
                        <SelectItem value="Land">🌳 Land</SelectItem>
                        <SelectItem value="Commercial">🏪 Commercial</SelectItem>
                        <SelectItem value="Other">📍 Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Property details with icons */}
                    <div className="grid grid-cols-3 gap-1">
                      <div className="flex items-center gap-1">
                        <BedDouble className="h-3 w-3 text-gray-400" />
                        <Input type="number" value={prop.bedrooms || ''} onChange={(e) => updateProperty(idx, 'bedrooms', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Beds" className="h-6 text-[10px] flex-1" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Bath className="h-3 w-3 text-gray-400" />
                        <Input type="number" value={prop.totalBathrooms || ''} onChange={(e) => updateProperty(idx, 'totalBathrooms', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Baths" className="h-6 text-[10px] flex-1" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Ruler className="h-3 w-3 text-gray-400" />
                        <Input type="number" value={prop.buildingSqft || ''} onChange={(e) => updateProperty(idx, 'buildingSqft', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Sqft" className="h-6 text-[10px] flex-1" />
                      </div>
                    </div>
                    {/* Value/Equity with icons */}
                    <div className="grid grid-cols-2 gap-1">
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3 text-green-500" />
                        <Input type="number" value={prop.estValue || ''} onChange={(e) => updateProperty(idx, 'estValue', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Est. Value" className="h-6 text-[10px] flex-1" />
                      </div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3 text-blue-500" />
                        <Input type="number" value={prop.estEquity || ''} onChange={(e) => updateProperty(idx, 'estEquity', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Equity" className="h-6 text-[10px] flex-1" />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Tags - compact */}
            <Card className="border-purple-100">
              <CardHeader className="pb-1 pt-2 px-3 bg-purple-50/50">
                <CardTitle className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-2">
                <TagInput
                  value={selectedTags}
                  onChange={(tags) => saveTagsInstantly(tags)}
                  contactId={currentContact?.id}
                  placeholder="Add tags..."
                  showSuggestions={true}
                  allowCreate={true}
                />
              </CardContent>
            </Card>

            {/* Sequences */}
            {currentContact?.id && (
              <ContactSequences contactId={currentContact.id} />
            )}

            {/* Deals - only show if there are deals */}
            {deals.length > 0 && (
              <Card className="border-indigo-100">
                <CardHeader className="pb-1 pt-2 px-3 bg-indigo-50/50">
                  <CardTitle className="text-xs font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" />
                    Deals ({deals.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-2">
                  <div className="space-y-1">
                    {deals.map((deal) => (
                      <Link
                        key={deal.id}
                        href={deal.isLoanDeal ? `/loan-copilot/${deal.id}` : `/deals?dealId=${deal.id}`}
                        className="block p-1.5 rounded border border-gray-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 transition-colors text-xs"
                      >
                        <div className="font-medium truncate">{deal.title}</div>
                        <div className="text-[10px] text-gray-500">{deal.stageLabel || deal.stage}</div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>

        {/* Right Column - Open Tasks + Activity History & Notes (wider, focus area) */}
        <div className="flex-1 flex flex-col bg-gradient-to-b from-amber-50/30 to-white">
          {/* Open Tasks Section - Compact list above Activity & Notes */}
          <div className={`p-3 border-b ${openTasks.length > 0 ? 'bg-orange-50/50' : 'bg-white'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-sm font-semibold flex items-center gap-2 ${openTasks.length > 0 ? 'text-orange-700' : 'text-gray-600'}`}>
                <CheckSquare className="h-4 w-4" />
                Open Tasks
                {openTasks.length > 0 && (
                  <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0">
                    {openTasks.length}
                  </Badge>
                )}
              </h3>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600 hover:text-blue-700 px-2" onClick={handleCreateTask}>
                <Plus className="h-3 w-3 mr-1" /> Add Task
              </Button>
            </div>
            {loadingTasks ? (
              <div className="text-center py-2 text-gray-500 text-xs">Loading...</div>
            ) : openTasks.length === 0 ? (
              <div className="text-center py-2 text-gray-400 text-xs">No open tasks for this contact</div>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {openTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`p-2 rounded border text-xs flex items-start gap-2 ${
                      task.priority === 'high' ? 'border-red-300 bg-red-50' :
                      task.priority === 'medium' ? 'border-yellow-300 bg-yellow-50' :
                      'border-gray-200 bg-white'
                    }`}
                  >
                    <Checkbox
                      checked={false}
                      onCheckedChange={(checked) => handleTaskComplete(task.id, !!checked)}
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">{task.subject}</div>
                      {task.dueDate && (
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 mt-0.5">
                          <Calendar className="h-2.5 w-2.5" />
                          {format(new Date(task.dueDate), 'MMM d, yyyy')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity & Notes Section */}
          <div className="p-3 border-b bg-white/80">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Activity & Notes ({activityHistory.length})
              </h3>
              {activityHistory.some(item => item.description && (item.description.length > 50 || item.description.includes('\n'))) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-blue-600 hover:text-blue-700 p-1"
                  onClick={() => {
                    const expandableIds = activityHistory
                      .filter(item => item.description && (item.description.length > 50 || item.description.includes('\n')))
                      .map(item => item.id)
                    if (expandedActivityIds.size === expandableIds.length) {
                      // All expanded, collapse all
                      setExpandedActivityIds(new Set())
                    } else {
                      // Expand all
                      setExpandedActivityIds(new Set(expandableIds))
                    }
                  }}
                >
                  {expandedActivityIds.size > 0 ? 'Collapse All' : 'Expand All'}
                </Button>
              )}
            </div>
          </div>
          {/* Add Note Input (multi-line) */}
          <div className="p-3 border-b bg-white">
            <div className="space-y-2">
              <div className="relative">
                <Textarea
                  ref={noteTextareaRef}
                  placeholder="Add a note... use '-' for bullet points, Cmd/Ctrl+B to bold"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={3}
                  className="text-sm resize-y"
                  disabled={savingNote}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && newNote.trim()) {
                      e.preventDefault()
                      handleSaveNote()
                    }
                    // Handle Cmd+B or Ctrl+B for bold
                    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                      e.preventDefault()
                      handleBoldText()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleBoldText}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                  title="Bold (Cmd/Ctrl+B)"
                  disabled={savingNote}
                >
                  <strong className="text-xs font-bold">B</strong>
                </button>
              </div>
              <div className="flex justify-end gap-2">
                {newNote && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => setNewNote('')}
                    disabled={savingNote}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={handleSaveNote}
                  disabled={savingNote || !newNote.trim()}
                >
                  {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add note'}
                </Button>
              </div>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              {loading ? (
                <div className="text-center py-6 text-gray-500 text-xs">Loading...</div>
              ) : activityHistory.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">No activity yet</div>
              ) : (
                <div className="space-y-2">
                  {/* Sort: pinned items first, then by timestamp, then calls before notes */}
                  {[...activityHistory]
                    .filter((item) => !item.activityId || !hiddenNoteIds.has(item.activityId))
                    .sort((a, b) => {
                      if (a.isPinned && !b.isPinned) return -1
                      if (!a.isPinned && b.isPinned) return 1
                      // Sort by timestamp first
                      const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                      if (timeDiff !== 0) return timeDiff
                      // If same timestamp, prioritize calls over notes/activities
                      const typePriority: Record<string, number> = { call: 1, sms: 2, email: 3, activity: 4 }
                      return (typePriority[a.type] || 5) - (typePriority[b.type] || 5)
                    })
                    .map((item) => {
                    const handleTogglePin = async () => {
                      if (!item.activityId) return
                      const newPinned = !item.isPinned
                      // Optimistic update
                      setActivityHistory(prev => prev.map(i =>
                        i.id === item.id ? { ...i, isPinned: newPinned } : i
                      ))
                      try {
                        const res = await fetch(`/api/activities/${item.activityId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ isPinned: newPinned })
                        })
                        if (!res.ok) throw new Error('Failed to update')
                        toast.success(newPinned ? 'Note pinned' : 'Note unpinned')
                      } catch {
                        // Revert on error
                        setActivityHistory(prev => prev.map(i =>
                          i.id === item.id ? { ...i, isPinned: !newPinned } : i
                        ))
                        toast.error('Failed to update pin status')
                      }
                    }

                    return (
                    <div
                      key={item.id}
                      className={`p-2 rounded border text-sm shadow-sm ${
                        item.isPinned
                          ? 'border-yellow-300 bg-yellow-50'
                          : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5">{getActivityIcon(item.type, item.direction)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm truncate text-gray-800">
                              {item.title}
                            </span>
                            <div className="flex items-center gap-1">
                              {/* Pin/Unpin button for activities (notes) */}
                              {item.activityId && (item.type === 'activity' || item.metadata?.activityType === 'note') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleTogglePin() }}
                                  className={`p-0.5 rounded hover:bg-gray-100 ${item.isPinned ? 'text-yellow-600' : 'text-gray-400 hover:text-gray-600'}`}
                                  title={item.isPinned ? 'Unpin note' : 'Pin note'}
                                >
                                  {item.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                                </button>
                              )}
                              {/* Edit button for notes */}
                              {item.activityId && item.metadata?.activityType === 'note' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingNoteId(item.activityId!)
                                    setEditingNoteText(item.description || '')
                                  }}
                                  className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                  title="Edit note"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              )}
                              {/* Delete button for notes - instant with undo */}
                              {item.activityId && item.metadata?.activityType === 'note' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteNote(item.activityId!)
                                  }}
                                  className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                                  title="Delete note (Undo available)"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                item.type === 'call' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                item.type === 'sms' ? 'bg-green-50 text-green-700 border-green-200' :
                                item.type === 'email' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                item.type === 'sequence' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                item.type === 'tag_added' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                item.type === 'tag_removed' ? 'bg-red-50 text-red-700 border-red-200' :
                                item.metadata?.activityType === 'note' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                item.type === 'task' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                'bg-gray-50 text-gray-700 border-gray-200'
                              }`}>
                                {item.type === 'tag_added' ? 'Tag +' :
                                 item.type === 'tag_removed' ? 'Tag -' :
                                 item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                              </Badge>
                            </div>
                          </div>
                          {item.description && (
                            <div className="mt-1">
                              {editingNoteId === item.activityId && item.metadata?.activityType === 'note' ? (
                                <div className="space-y-1">
                                  <Textarea
                                    ref={editNoteTextareaRef}
                                    value={editingNoteText}
                                    onChange={(e) => setEditingNoteText(e.target.value)}
                                    rows={3}
                                    className="text-xs resize-y"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && editingNoteText.trim()) {
                                        e.preventDefault()
                                        handleEditNote(item.activityId!)
                                      }
                                      if (e.key === 'Escape') {
                                        e.preventDefault()
                                        setEditingNoteId(null)
                                        setEditingNoteText('')
                                      }
                                      // Handle Cmd+B or Ctrl+B for bold
                                      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                                        e.preventDefault()
                                        handleBoldTextEdit()
                                      }
                                    }}
                                  />
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-6 px-2 text-[10px]"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setEditingNoteId(null)
                                        setEditingNoteText('')
                                      }}
                                      disabled={savingNote}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-6 px-2 text-[10px]"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEditNote(item.activityId!)
                                      }}
                                      disabled={savingNote || !editingNoteText.trim()}
                                    >
                                      {savingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                                    </Button>
                                  </div>
                                </div>
                              ) : expandedActivityIds.has(item.id) ? (
                                <div>
                                  <div className="max-h-48 overflow-y-auto pr-1">
                                    <p className="text-xs text-gray-600 whitespace-pre-wrap">{renderMarkdownBold(item.description)}</p>
                                  </div>
                                  <button
                                    className="text-blue-500 hover:text-blue-700 text-[10px] mt-1"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setExpandedActivityIds(prev => {
                                        const next = new Set(prev)
                                        next.delete(item.id)
                                        return next
                                      })
                                    }}
                                  >
                                    Show less ▲
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <p className="text-xs text-gray-500 line-clamp-1 flex-1">{renderMarkdownBold(item.description)}</p>
                                  {item.description.length > 50 || item.description.includes('\n') ? (
                                    <button
                                      className="text-blue-500 hover:text-blue-700 text-[10px] flex-shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setExpandedActivityIds(prev => {
                                          const next = new Set(prev)
                                          next.add(item.id)
                                          return next
                                        })
                                      }}
                                    >
                                      ▼
                                    </button>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="text-[10px] text-gray-400 mt-1">
                            {format(new Date(item.timestamp), 'MMM d, yyyy h:mm a')}
                          </div>
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Follow-up Task Dialog */}
      <AlertDialog open={showFollowUpDialog} onOpenChange={setShowFollowUpDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create Follow-up Task?</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to create a follow-up task for this contact?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="followup-subject">Task Subject</Label>
              <Input
                id="followup-subject"
                value={followUpSubject}
                onChange={(e) => setFollowUpSubject(e.target.value)}
                placeholder="Enter task subject..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followup-date">Due Date</Label>
              <Input
                id="followup-date"
                type="date"
                value={followUpDueDate}
                onChange={(e) => setFollowUpDueDate(e.target.value)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleSkipFollowUp}>Skip</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateFollowUp} disabled={creatingFollowUp || !followUpSubject.trim()}>
              {creatingFollowUp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

