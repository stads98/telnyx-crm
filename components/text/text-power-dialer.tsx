'use client'

/**
 * Text Power Dialer - Power Dialer-style interface for SMS campaigns
 * - Center: Active text window showing current message being sent
 * - Right: Queue panel with contacts and their status
 * - Bottom: Templates for each round (1-5)
 * - Real-time progress and response notifications
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import {
  ArrowLeft, Play, Pause, MessageSquare, Send, User, Phone, 
  Plus, Trash2, Tag, X, CheckCircle, Clock, AlertCircle,
  SkipForward, RefreshCw, ExternalLink, History, Edit2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useContactPanel } from '@/lib/context/contact-panel-context'
import { useSmsUI } from '@/lib/context/sms-ui-context'
import { usePhoneNumber } from '@/lib/context/phone-number-context'

interface QueueItem {
  id: string
  contactId: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'RESPONDED' | 'FAILED' | 'SKIPPED'
  currentRound: number
  assignedNumber: string | null
  contact: {
    id: string
    firstName: string | null
    lastName: string | null
    llcName: string | null
    phone1: string | null
    phone2: string | null
    phone3: string | null
    propertyAddress: string | null
    city: string | null
    state: string | null
  }
}

interface Template {
  round: number
  content: string
}

interface Campaign {
  id: string
  name: string
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'ROUND_COMPLETE' | 'COMPLETED' | 'STOPPED'
  currentRound: number
  maxRounds: number
  totalContacts: number
  sentCount: number
  failedCount: number
  respondedCount: number
  delaySeconds: number
  selectedNumbers: string[]
  templates: string
}

interface ResponseItem {
  contactId: string
  contactName: string
  respondedAt: Date
}

interface TextPowerDialerProps {
  onBack: () => void
}

export function TextPowerDialer({ onBack }: TextPowerDialerProps) {
  // Campaign state
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(true)
  
  // Setup state
  const [campaignName, setCampaignName] = useState('')
  const [templates, setTemplates] = useState<Template[]>([{ round: 1, content: '' }])
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([])
  const [delaySeconds, setDelaySeconds] = useState(2)
  const [includeTagIds, setIncludeTagIds] = useState<string[]>([])
  const [excludeTagIds, setExcludeTagIds] = useState<string[]>([])
  
  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [responses, setResponses] = useState<ResponseItem[]>([])
  
  // Current sending state
  const [currentSending, setCurrentSending] = useState<{
    contactName: string
    phoneNumber: string
    fromNumber: string
    message: string
    round: number
  } | null>(null)
  
  // Tags for filtering
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string; color: string }[]>([])
  
  // Contexts
  const { openContactPanel } = useContactPanel()
  const { openSms } = useSmsUI()
  const { availablePhoneNumbers } = usePhoneNumber()

  // Load available tags
  useEffect(() => {
    fetch('/api/tags')
      .then(res => res.json())
      .then(data => setAvailableTags(data.tags || []))
      .catch(err => console.error('Error loading tags:', err))
  }, [])

  // Initialize selected numbers from available
  useEffect(() => {
    if (availablePhoneNumbers.length > 0 && selectedNumbers.length === 0) {
      setSelectedNumbers(availablePhoneNumbers.slice(0, 3).map(pn => pn.phoneNumber))
    }
  }, [availablePhoneNumbers])

  // Check for existing active campaign on mount
  useEffect(() => {
    checkActiveCampaign()
  }, [])

  const checkActiveCampaign = async () => {
    try {
      const res = await fetch('/api/text-campaigns?checkActive=true')
      const data = await res.json()
      if (data.hasActive && data.activeCampaign) {
        setCampaign(data.activeCampaign)
        setIsCreatingCampaign(false)
        loadCampaignQueue(data.activeCampaign.id)
      }
    } catch (error) {
      console.error('Error checking active campaign:', error)
    }
  }

  const loadCampaignQueue = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/text-campaigns/${campaignId}/queue`)
      const data = await res.json()
      setQueue(data.queueItems || [])
    } catch (error) {
      console.error('Error loading queue:', error)
    }
  }

  // Setup SSE for real-time updates
  useEffect(() => {
    if (!campaign?.id) return

    const eventSource = new EventSource(`/api/sse?channel=text-campaign-${campaign.id}`)
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleCampaignEvent(data)
      } catch (e) {
        console.error('SSE parse error:', e)
      }
    }

    return () => eventSource.close()
  }, [campaign?.id])

  const handleCampaignEvent = (data: any) => {
    switch (data.type) {
      case 'text-campaign:sending':
        setCurrentSending({
          contactName: data.contactName,
          phoneNumber: data.phoneNumber,
          fromNumber: data.fromNumber,
          message: data.message,
          round: data.round,
        })
        break
      case 'text-campaign:progress':
        setCampaign(prev => prev ? {
          ...prev,
          sentCount: data.sentCount,
          failedCount: data.failedCount,
          currentRound: data.round,
        } : null)
        break
      case 'text-campaign:response':
        setResponses(prev => [{
          contactId: data.contactId,
          contactName: 'Contact',
          respondedAt: new Date(),
        }, ...prev])
        toast.success('New response received!')
        break
      case 'text-campaign:round-complete':
        setCampaign(prev => prev ? { ...prev, status: 'ROUND_COMPLETE' } : null)
        toast.info(`Round ${data.completedRound} complete! Ready for round ${data.nextRound}`)
        break
      case 'text-campaign:completed':
        setCampaign(prev => prev ? { ...prev, status: 'COMPLETED' } : null)
        setCurrentSending(null)
        toast.success('Campaign completed!')
        break
    }
  }
  // Campaign actions
  const createCampaign = async () => {
    if (!templates[0].content.trim()) {
      toast.error('Please enter at least one template message')
      return
    }
    if (selectedNumbers.length === 0) {
      toast.error('Please select at least one phone number')
      return
    }
    if (includeTagIds.length === 0) {
      toast.error('Please select at least one tag to include')
      return
    }

    try {
      const res = await fetch('/api/text-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName || `Text Campaign ${new Date().toLocaleString()}`,
          templates: templates.filter(t => t.content.trim()),
          selectedNumbers,
          delaySeconds,
          includeTagIds,
          excludeTagIds,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setCampaign(data.campaign)
      setIsCreatingCampaign(false)
      loadCampaignQueue(data.campaign.id)
      toast.success(`Campaign created with ${data.campaign.totalContacts} contacts`)
    } catch (error: any) {
      toast.error(error.message || 'Failed to create campaign')
    }
  }

  const startCampaign = async () => {
    if (!campaign) return
    try {
      const res = await fetch(`/api/text-campaigns/${campaign.id}/start`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCampaign(data.campaign)
      toast.success('Campaign started!')
    } catch (error: any) {
      toast.error(error.message || 'Failed to start campaign')
    }
  }

  const pauseCampaign = async () => {
    if (!campaign) return
    try {
      const res = await fetch(`/api/text-campaigns/${campaign.id}/pause`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCampaign(data.campaign)
      setCurrentSending(null)
      toast.info('Campaign paused')
    } catch (error: any) {
      toast.error(error.message || 'Failed to pause campaign')
    }
  }

  const resumeCampaign = async () => {
    if (!campaign) return
    try {
      const res = await fetch(`/api/text-campaigns/${campaign.id}/resume`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCampaign(data.campaign)
      toast.success('Campaign resumed!')
    } catch (error: any) {
      toast.error(error.message || 'Failed to resume campaign')
    }
  }

  const startNextRound = async () => {
    if (!campaign) return
    try {
      const res = await fetch(`/api/text-campaigns/${campaign.id}/next-round`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCampaign(data.campaign)
      toast.success(`Starting round ${data.campaign.currentRound}!`)
    } catch (error: any) {
      toast.error(error.message || 'Failed to start next round')
    }
  }

  // Template management
  const addTemplate = () => {
    if (templates.length >= 5) {
      toast.error('Maximum 5 templates allowed')
      return
    }
    setTemplates([...templates, { round: templates.length + 1, content: '' }])
  }

  const removeTemplate = (round: number) => {
    if (templates.length <= 1) return
    const newTemplates = templates.filter(t => t.round !== round)
      .map((t, i) => ({ ...t, round: i + 1 }))
    setTemplates(newTemplates)
  }

  const updateTemplate = (round: number, content: string) => {
    setTemplates(templates.map(t => t.round === round ? { ...t, content } : t))
  }

  // Phone number selection
  const togglePhoneNumber = (phoneNumber: string) => {
    setSelectedNumbers(prev =>
      prev.includes(phoneNumber)
        ? prev.filter(n => n !== phoneNumber)
        : [...prev, phoneNumber]
    )
  }

  // Tag selection
  const toggleIncludeTag = (tagId: string) => {
    setIncludeTagIds(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }

  const toggleExcludeTag = (tagId: string) => {
    setExcludeTagIds(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }

  // Helper to get contact display name
  const getContactName = (contact: QueueItem['contact']) => {
    if (contact.firstName || contact.lastName) {
      return `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    }
    return contact.llcName || 'Unknown'
  }

  // Helper to get status badge color
  const getStatusColor = (status: QueueItem['status']) => {
    switch (status) {
      case 'PENDING': return 'bg-gray-100 text-gray-700'
      case 'SENDING': return 'bg-blue-100 text-blue-700'
      case 'SENT': return 'bg-green-100 text-green-700'
      case 'RESPONDED': return 'bg-purple-100 text-purple-700'
      case 'FAILED': return 'bg-red-100 text-red-700'
      case 'SKIPPED': return 'bg-yellow-100 text-yellow-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  // Render campaign setup view
  if (isCreatingCampaign) {
    return (
      <div className="flex flex-col h-full bg-gray-50">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-white border-b">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-xl font-semibold">Create Text Campaign</h1>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Campaign Name */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Campaign Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Campaign Name (optional)</Label>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="My Text Campaign"
                  />
                </div>
                <div>
                  <Label>Delay Between Messages: {delaySeconds} seconds</Label>
                  <Slider
                    value={[delaySeconds]}
                    onValueChange={([v]) => setDelaySeconds(v)}
                    min={1}
                    max={30}
                    step={1}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Phone Numbers */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Phone Numbers to Send From</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {availablePhoneNumbers.map(pn => (
                    <Button
                      key={pn.phoneNumber}
                      variant={selectedNumbers.includes(pn.phoneNumber) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => togglePhoneNumber(pn.phoneNumber)}
                    >
                      <Phone className="h-3 w-3 mr-1" />
                      {pn.phoneNumber}
                    </Button>
                  ))}
                </div>
                {selectedNumbers.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {selectedNumbers.length} number(s) selected - will rotate between them
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Tag Filters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-green-700">Include Tags (contacts with ANY of these)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableTags.map(tag => (
                      <Button
                        key={tag.id}
                        variant={includeTagIds.includes(tag.id) ? 'default' : 'outline'}
                        size="sm"
                        className={includeTagIds.includes(tag.id) ? 'bg-green-600 hover:bg-green-700' : ''}
                        onClick={() => toggleIncludeTag(tag.id)}
                      >
                        <Tag className="h-3 w-3 mr-1" />
                        {tag.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-red-700">Exclude Tags (skip contacts with ANY of these)</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableTags.map(tag => (
                      <Button
                        key={tag.id}
                        variant={excludeTagIds.includes(tag.id) ? 'default' : 'outline'}
                        size="sm"
                        className={excludeTagIds.includes(tag.id) ? 'bg-red-600 hover:bg-red-700' : ''}
                        onClick={() => toggleExcludeTag(tag.id)}
                        disabled={includeTagIds.includes(tag.id)}
                      >
                        <Tag className="h-3 w-3 mr-1" />
                        {tag.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Templates */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Message Templates (1 per round)</CardTitle>
                <Button variant="outline" size="sm" onClick={addTemplate} disabled={templates.length >= 5}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Round
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {templates.map((template, idx) => (
                  <div key={template.round} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Round {template.round} Template</Label>
                      {templates.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTemplate(template.round)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={template.content}
                      onChange={(e) => updateTemplate(template.round, e.target.value)}
                      placeholder={`Hi {{firstName}}, this is round ${template.round}...`}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{propertyAddress}}'}, {'{{city}}'}, {'{{state}}'}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Create Button */}
            <div className="flex justify-end">
              <Button size="lg" onClick={createCampaign}>
                <Send className="h-4 w-4 mr-2" />
                Create Campaign
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main campaign view
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-white border-b">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{campaign?.name || 'Text Campaign'}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">Round {campaign?.currentRound || 1} of {campaign?.maxRounds || 1}</Badge>
              <span>•</span>
              <span>{campaign?.sentCount || 0} sent</span>
              <span>•</span>
              <span>{campaign?.respondedCount || 0} responded</span>
              <span>•</span>
              <span>{campaign?.failedCount || 0} failed</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {campaign?.status === 'IDLE' && (
            <Button onClick={startCampaign}>
              <Play className="h-4 w-4 mr-2" />
              Start Campaign
            </Button>
          )}
          {campaign?.status === 'RUNNING' && (
            <Button variant="outline" onClick={pauseCampaign}>
              <Pause className="h-4 w-4 mr-2" />
              Pause
            </Button>
          )}
          {campaign?.status === 'PAUSED' && (
            <Button onClick={resumeCampaign}>
              <Play className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
          {campaign?.status === 'ROUND_COMPLETE' && campaign.currentRound < campaign.maxRounds && (
            <Button onClick={startNextRound}>
              <SkipForward className="h-4 w-4 mr-2" />
              Start Round {campaign.currentRound + 1}
            </Button>
          )}
          {campaign?.status === 'COMPLETED' && (
            <Badge className="bg-green-100 text-green-700">Completed</Badge>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Text Window + Templates */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          {/* Current Sending Window */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Current Message
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentSending ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{currentSending.contactName}</span>
                    </div>
                    <Badge>Round {currentSending.round}</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>To: {currentSending.phoneNumber}</span>
                    <span>From: {currentSending.fromNumber}</span>
                  </div>
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-sm">{currentSending.message}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Sending...
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {campaign?.status === 'RUNNING' ? (
                    <p>Preparing next message...</p>
                  ) : campaign?.status === 'COMPLETED' ? (
                    <p>Campaign completed!</p>
                  ) : campaign?.status === 'ROUND_COMPLETE' ? (
                    <p>Round complete. Click "Start Round {(campaign?.currentRound || 0) + 1}" to continue.</p>
                  ) : (
                    <p>Click Start to begin sending messages</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Templates (read-only during campaign) */}
          <Card className="flex-1 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-full">
                {campaign?.templates && JSON.parse(campaign.templates).map((t: Template) => (
                  <div key={t.round} className={cn(
                    "p-3 rounded-lg border mb-2",
                    campaign.currentRound === t.round ? "border-blue-500 bg-blue-50" : "border-gray-200"
                  )}>
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={campaign.currentRound === t.round ? "default" : "outline"}>
                        Round {t.round}
                      </Badge>
                      {campaign.currentRound === t.round && (
                        <Badge className="bg-blue-100 text-blue-700">Active</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-700">{t.content}</p>
                  </div>
                ))}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: Queue + Responses */}
        <div className="w-96 border-l bg-white flex flex-col">
          {/* Queue Panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 border-b">
              <h3 className="font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Queue ({queue.filter(q => q.status === 'PENDING').length} pending)
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {queue.map(item => (
                  <div
                    key={item.id}
                    className={cn(
                      "p-2 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors",
                      item.status === 'SENDING' && "border-blue-500 bg-blue-50"
                    )}
                    onClick={() => openContactPanel(item.contactId)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">
                        {getContactName(item.contact)}
                      </span>
                      <Badge className={cn("text-xs", getStatusColor(item.status))}>
                        {item.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {item.contact.phone1 || item.contact.phone2 || item.contact.phone3}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Responses Panel */}
          <div className="h-64 border-t flex flex-col">
            <div className="p-3 border-b bg-purple-50">
              <h3 className="font-semibold flex items-center gap-2 text-purple-700">
                <History className="h-4 w-4" />
                Responses ({responses.length})
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {responses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No responses yet
                  </p>
                ) : (
                  responses.map((resp, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-lg border border-purple-200 bg-purple-50 cursor-pointer hover:bg-purple-100"
                      onClick={() => {
                        openContactPanel(resp.contactId)
                        // Open SMS with contact - will need to fetch phone number
                        // For now just open contact panel
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{resp.contactName}</span>
                        <ExternalLink className="h-3 w-3 text-purple-600" />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(resp.respondedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}

