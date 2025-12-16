"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Send, Loader2, X, FileText } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useContacts } from "@/lib/context/contacts-context"
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils"
import type { Contact } from "@/lib/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface SmsTemplate {
  id: string
  name: string
  content: string
  variables: string[]
}

interface TelnyxPhoneNumber {
  id: string
  phoneNumber: string
  friendlyName?: string
  isActive: boolean
}

interface NewConversationViewProps {
  onBack: () => void
  onConversationStarted: (contact: Contact) => void
}

export default function NewConversationView({ onBack, onConversationStarted }: NewConversationViewProps) {
  const { data: session } = useSession()
  const { allContacts, loadAllContacts } = useContacts()
  const { toast } = useToast()
  
  const [phoneInput, setPhoneInput] = useState("")
  const [message, setMessage] = useState("")
  const [selectedSenderNumber, setSelectedSenderNumber] = useState("")
  const [availableNumbers, setAvailableNumbers] = useState<TelnyxPhoneNumber[]>([])
  const [isSending, setIsSending] = useState(false)
  const [matchingContacts, setMatchingContacts] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [templates, setTemplates] = useState<SmsTemplate[]>([])

  const inputRef = useRef<HTMLInputElement>(null)
  const isAdmin = session?.user?.role === 'ADMIN'

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Load templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await fetch('/api/templates')
        if (res.ok) {
          const data = await res.json()
          setTemplates(Array.isArray(data) ? data : [])
        }
      } catch (error) {
        console.error('Error loading templates:', error)
      }
    }
    loadTemplates()
  }, [])

  // Apply template with variable substitution
  const applyTemplate = (template: SmsTemplate) => {
    let content = template.content

    // Replace contact-specific variables if we have a selected contact
    if (selectedContact) {
      content = content.replace(/\{firstName\}/gi, selectedContact.firstName || '')
      content = content.replace(/\{lastName\}/gi, selectedContact.lastName || '')
      content = content.replace(/\{propertyAddress\}/gi, selectedContact.propertyAddress || '')
      content = content.replace(/\{city\}/gi, selectedContact.city || '')
      content = content.replace(/\{state\}/gi, selectedContact.state || '')
    }

    setMessage(content)
    toast({ title: "Template applied", description: `"${template.name}" inserted` })

    // Track usage
    fetch(`/api/templates/${template.id}/use`, { method: 'POST' }).catch(() => {})
  }

  // Load available phone numbers
  useEffect(() => {
    const loadNumbers = async () => {
      try {
        const res = await fetch('/api/telnyx/phone-numbers')
        if (res.ok) {
          const data = await res.json()
          // API returns array directly OR { phoneNumbers: [...] }
          const rawNumbers = Array.isArray(data) ? data : (data.phoneNumbers || [])
          const numbers = rawNumbers.filter((n: TelnyxPhoneNumber) => n.isActive)
          console.log('[NewConversation] Loaded phone numbers:', numbers.length)
          setAvailableNumbers(numbers)

          // Auto-select assigned number for team users, or first number for admins
          if (!isAdmin && session?.user?.assignedPhoneNumber) {
            setSelectedSenderNumber(session.user.assignedPhoneNumber)
          } else if (numbers.length > 0) {
            setSelectedSenderNumber(numbers[0].phoneNumber)
          }
        }
      } catch (error) {
        console.error('Error loading phone numbers:', error)
      }
    }
    loadNumbers()
  }, [session, isAdmin])

  // Load all contacts on mount for instant search
  useEffect(() => {
    loadAllContacts()
  }, [loadAllContacts])

  // Search contacts as user types
  useEffect(() => {
    if (!phoneInput.trim()) {
      setMatchingContacts([])
      setShowSuggestions(false)
      return
    }

    // Search by phone number or name in cached allContacts
    const query = phoneInput.toLowerCase()
    const results = allContacts
      .filter(c =>
        c.firstName?.toLowerCase().includes(query) ||
        c.lastName?.toLowerCase().includes(query) ||
        c.phone1?.includes(phoneInput) ||
        c.phone2?.includes(phoneInput) ||
        c.phone3?.includes(phoneInput)
      )
      .slice(0, 5)
    setMatchingContacts(results)
    setShowSuggestions(results.length > 0 && !selectedContact)
  }, [phoneInput, allContacts, selectedContact])

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact)
    setPhoneInput(contact.phone1 || contact.phone2 || contact.phone3 || '')
    setShowSuggestions(false)
  }

  const handleClearSelection = () => {
    setSelectedContact(null)
    setPhoneInput("")
    inputRef.current?.focus()
  }

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedSenderNumber || !phoneInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter a phone number and message",
        variant: "destructive",
      })
      return
    }

    setIsSending(true)
    try {
      // Format phone number
      const digits = phoneInput.replace(/\D/g, '')
      let toNumber = phoneInput
      if (!phoneInput.startsWith('+')) {
        toNumber = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phoneInput
      }

      // If we have a selected contact, use their ID
      // Otherwise, we'll let the API create/find the contact
      const response = await fetch('/api/telnyx/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromNumber: selectedSenderNumber,
          toNumber,
          message: message.trim(),
          contactId: selectedContact?.id,
        }),
      })

      if (response.ok) {
        toast({ title: "Message sent!" })
        
        // If we have a selected contact, navigate to their conversation
        if (selectedContact) {
          onConversationStarted(selectedContact)
        } else {
          // Try to find or create contact and navigate
          const contactRes = await fetch(`/api/contacts/by-phone?phone=${encodeURIComponent(toNumber)}`)
          if (contactRes.ok) {
            const contact = await contactRes.json()
            if (contact) {
              onConversationStarted(contact)
              return
            }
          }
          // Just go back if we can't find the contact
          onBack()
        }
      } else {
        const err = await response.json()
        throw new Error(err.error || 'Failed to send message')
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  const getContactInitials = (contact: Contact) => {
    const first = contact.firstName?.[0] || ''
    const last = contact.lastName?.[0] || ''
    return (first + last).toUpperCase() || '?'
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold">New Message</h2>
      </div>

      {/* To: Field */}
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">To:</span>
          {selectedContact ? (
            <div className="flex items-center gap-2 bg-primary/10 rounded-full px-3 py-1">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">{getContactInitials(selectedContact)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {selectedContact.firstName} {selectedContact.lastName}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatPhoneNumberForDisplay(selectedContact.phone1 || '')}
              </span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleClearSelection}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex-1 relative">
              <Input
                ref={inputRef}
                placeholder="Type a phone number or name..."
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="border-0 shadow-none focus-visible:ring-0 px-0 text-base"
              />

              {/* Contact suggestions dropdown */}
              {showSuggestions && matchingContacts.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50">
                  {matchingContacts.map((contact) => (
                    <button
                      key={contact.id}
                      className="w-full flex items-center gap-3 p-3 hover:bg-accent text-left"
                      onClick={() => handleSelectContact(contact)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{getContactInitials(contact)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {contact.firstName} {contact.lastName}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {formatPhoneNumberForDisplay(contact.phone1 || contact.phone2 || contact.phone3 || '')}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* From: Field */}
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">From:</span>
          <Select
            value={selectedSenderNumber}
            onValueChange={setSelectedSenderNumber}
            disabled={!isAdmin && !!session?.user?.assignedPhoneNumber}
          >
            <SelectTrigger className="w-auto border-0 shadow-none">
              <SelectValue placeholder="Select number" />
            </SelectTrigger>
            <SelectContent>
              {availableNumbers.map((number) => (
                <SelectItem key={number.id} value={number.phoneNumber}>
                  {formatPhoneNumberForDisplay(number.phoneNumber)}
                  {number.friendlyName && ` - ${number.friendlyName}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Message area - takes remaining space */}
      <div className="flex-1 p-4 flex flex-col">
        {/* Template selector */}
        <div className="mb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4 mr-2" />
                Templates
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 max-h-64 overflow-y-auto">
              {templates.length === 0 ? (
                <DropdownMenuItem disabled>No templates available</DropdownMenuItem>
              ) : (
                templates.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    onClick={() => applyTemplate(template)}
                    className="flex flex-col items-start"
                  >
                    <span className="font-medium">{template.name}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-full">
                      {template.content.substring(0, 50)}...
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Textarea
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 resize-none text-base"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSendMessage()
            }
          }}
        />
      </div>

      {/* Send button */}
      <div className="border-t p-4 flex justify-end gap-2">
        <Button
          onClick={handleSendMessage}
          disabled={isSending || !message.trim() || !phoneInput.trim() || !selectedSenderNumber}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Send
        </Button>
      </div>
    </div>
  )
}

