"use client"

import { useState, useEffect, useRef } from "react"
import { useContacts } from "@/lib/context/contacts-context"
import EnhancedConversationsList from "@/components/text/enhanced-conversations-list"
import EnhancedConversation from "@/components/text/enhanced-conversation"
import NewConversationView from "@/components/text/new-conversation-view"
import { TextPowerDialer } from "@/components/text/text-power-dialer"
import TextBlastOperations from "@/components/text/text-blast-operations"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMediaQuery } from "@/hooks/use-media-query"
import { MessageSquare, Send, Settings } from "lucide-react"
import type { Contact } from "@/lib/types"


interface TextCenterProps {
  selectedContactId?: string | null
}

export default function TextCenter({ selectedContactId }: TextCenterProps) {
  const { contacts } = useContacts()
  const [activeTab, setActiveTab] = useState("conversations")
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [showConversation, setShowConversation] = useState(false)
  const [showNewConversation, setShowNewConversation] = useState(false)
  const isMobile = useMediaQuery("(max-width: 768px)")
  const conversationsListRef = useRef<any>(null)  // FIX: Ref to refresh conversations list

  // Initialize active sub-tab from URL exactly once to avoid race conditions
  useEffect(() => {
    const url = new URL(window.location.href)
    const sub = url.searchParams.get('sub')
    if (sub === 'blast' || sub === 'conversations') {
      setActiveTab(sub)
    }
  }, [])

  // Handle selectedContactId from URL parameter
  useEffect(() => {
    if (!selectedContactId) return

    // First try to find in loaded contacts
    const contact = contacts.find(c => c.id === selectedContactId)
    if (contact) {
      setSelectedContact(contact)
      setActiveTab("conversations")
      if (isMobile) {
        setShowConversation(true)
      }
      return
    }

    // If not found in loaded contacts, fetch from API
    const fetchContact = async () => {
      try {
        const res = await fetch(`/api/contacts/${selectedContactId}`)
        if (res.ok) {
          const data = await res.json()
          if (data) {
            setSelectedContact(data as Contact)
            setActiveTab("conversations")
            if (isMobile) {
              setShowConversation(true)
            }
          }
        }
      } catch (error) {
        console.error('Error fetching contact:', error)
      }
    }

    fetchContact()
  }, [selectedContactId, contacts, isMobile])

  // Reset selected contact when changing tabs
  useEffect(() => {
    if (!selectedContactId) {
      setSelectedContact(null)
      setShowConversation(false)
    }
  }, [activeTab, selectedContactId])

  // Update URL when user changes sub-tab (prevents stale updates from older renders)
  const handleSetActiveTab = (tab: string) => {
    setActiveTab(prev => {
      if (prev === tab) return prev
      const url = new URL(window.location.href)
      url.searchParams.set('sub', tab)
      window.history.replaceState(null, '', url.toString())
      return tab
    })
  }

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact)
    if (isMobile) {
      setShowConversation(true)
    }
  }

  const handleBackToList = () => {
    setShowConversation(false)
  }

  // FIX: Callback to refresh conversations list when a conversation is read
  const handleConversationRead = () => {
    if (conversationsListRef.current?.refreshConversations) {
      conversationsListRef.current.refreshConversations()
    }
  }

  // Mobile: Show new conversation view full screen
  if (isMobile && showNewConversation) {
    return (
      <NewConversationView
        onBack={() => setShowNewConversation(false)}
        onConversationStarted={(contact) => {
          setShowNewConversation(false)
          setSelectedContact(contact)
          setShowConversation(true)
          conversationsListRef.current?.refreshConversations?.()
        }}
      />
    )
  }

  if (isMobile && showConversation && selectedContact) {
    return <EnhancedConversation contact={selectedContact} onBack={handleBackToList} onConversationRead={handleConversationRead} />
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs value={activeTab} onValueChange={handleSetActiveTab} className="h-full flex flex-col">
        {/* Header with tabs */}
        <div className="border-b bg-card px-6 pt-6 pb-4 flex-shrink-0">
          <div className="mb-4">
            <h1 className="text-3xl font-bold tracking-tight">Text Center</h1>
            <p className="text-muted-foreground">Manage SMS conversations and campaigns</p>
          </div>
          <TabsList className="grid grid-cols-3 w-full max-w-xl">
            <TabsTrigger value="conversations" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span>Conversations</span>
            </TabsTrigger>
            <TabsTrigger value="blast" className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              <span>Text Blast</span>
            </TabsTrigger>
            <TabsTrigger value="operations" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span>Operations</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab content - takes remaining space */}
        <div className="flex-1 overflow-hidden">
          <TabsContent value="conversations" className="m-0 h-full">
            <div className="flex h-full">
              <div className={`${isMobile ? "w-full" : "w-1/3 border-r"}`}>
                <EnhancedConversationsList
                  ref={conversationsListRef}
                  selectedContactId={selectedContact?.id}
                  onSelectContact={handleSelectContact}
                  onNewConversation={() => {
                    setShowNewConversation(true)
                    setSelectedContact(null)
                  }}
                />
              </div>
              {!isMobile && (
                <div className="w-2/3">
                  {showNewConversation ? (
                    <NewConversationView
                      onBack={() => setShowNewConversation(false)}
                      onConversationStarted={(contact) => {
                        setShowNewConversation(false)
                        setSelectedContact(contact)
                        // Refresh conversations list
                        conversationsListRef.current?.refreshConversations?.()
                      }}
                    />
                  ) : selectedContact ? (
                    <EnhancedConversation contact={selectedContact} onConversationRead={handleConversationRead} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                      <p>Select a conversation to start messaging</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent value="blast" className="m-0 h-full overflow-hidden">
            <TextPowerDialer onBack={() => handleSetActiveTab('conversations')} />
          </TabsContent>
          <TabsContent value="operations" className="m-0 h-full overflow-auto">
            <TextBlastOperations onSwitchTab={handleSetActiveTab} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
