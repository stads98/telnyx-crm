'use client'

/**
 * Multi-Line Power Dialer Active Call Windows
 *
 * Center panel showing 1-10 active call cards with color-coded states:
 * - Gray: Idle/Empty slot
 * - Blue: Dialing
 * - Yellow/Orange: Ringing
 * - Green: Answered (human)
 * - Red: Hung up / Failed
 */

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneMissed,
  Voicemail,
  Loader2,
  User,
  Building2,
  MapPin,
  Clock,
  Mic,
  MicOff,
  ThumbsUp,
  ThumbsDown,
  Ban,
  Calendar,
  Check
} from 'lucide-react'
import type { ActiveLeg, CompletedLeg, DialerCallStatus } from '@/lib/dialer/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Disposition options for power dialer
const DISPOSITION_OPTIONS = [
  { value: 'interested', label: 'Interested', icon: ThumbsUp, color: 'bg-green-500 hover:bg-green-600' },
  { value: 'not_interested', label: 'Not Interested', icon: ThumbsDown, color: 'bg-red-500 hover:bg-red-600' },
  { value: 'callback', label: 'Callback', icon: Calendar, color: 'bg-blue-500 hover:bg-blue-600' },
  { value: 'no_answer', label: 'No Answer', icon: PhoneMissed, color: 'bg-orange-500 hover:bg-orange-600' },
  { value: 'voicemail', label: 'Voicemail', icon: Voicemail, color: 'bg-purple-500 hover:bg-purple-600' },
  { value: 'wrong_number', label: 'Wrong Number', icon: Ban, color: 'bg-gray-500 hover:bg-gray-600' },
  { value: 'dnc', label: 'Do Not Call', icon: Ban, color: 'bg-black hover:bg-gray-800' },
]

interface DialerActiveCallsProps {
  maxLines: number
  activeLegs: ActiveLeg[]
  completedLegs: CompletedLeg[]
  onHangup?: (legId: string) => void
  onMute?: (legId: string, muted: boolean) => void
  onDisposition?: (legId: string, contactId: string, outcome: string, notes?: string) => void
}

function formatPhoneDisplay(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
  }
  return phone
}

function formatDuration(startedAt: string, answeredAt?: string): string {
  const start = answeredAt ? new Date(answeredAt) : new Date(startedAt)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getCardStyles(status: DialerCallStatus, isCompleted: boolean): string {
  if (isCompleted) {
    switch (status) {
      case 'answered':
        return 'bg-green-100 border-green-300'
      case 'canceled_other_answer':
        return 'bg-gray-100 border-gray-300 opacity-60'
      default:
        return 'bg-red-100 border-red-300 opacity-75'
    }
  }

  switch (status) {
    case 'dialing':
      return 'bg-blue-50 border-blue-300 shadow-lg shadow-blue-100'
    case 'ringing':
      return 'bg-yellow-50 border-yellow-400 shadow-lg shadow-yellow-100 animate-pulse'
    case 'amd_check':
      return 'bg-purple-50 border-purple-300 shadow-lg shadow-purple-100'
    case 'answered':
      return 'bg-green-50 border-green-400 shadow-xl shadow-green-100 ring-2 ring-green-400'
    case 'voicemail':
    case 'machine':
      return 'bg-orange-50 border-orange-300'
    case 'no_answer':
    case 'busy':
    case 'failed':
      return 'bg-red-50 border-red-300'
    default:
      return 'bg-muted border-muted-foreground/20'
  }
}

function getStatusLabel(status: DialerCallStatus): string {
  const labels: Record<DialerCallStatus, string> = {
    idle: 'Idle',
    queued: 'Queued',
    dialing: 'Dialing...',
    ringing: 'Ringing...',
    amd_check: 'Detecting...',
    answered: 'Connected',
    voicemail: 'Voicemail',
    machine: 'Machine',
    no_answer: 'No Answer',
    busy: 'Busy',
    failed: 'Failed',
    skipped: 'Skipped',
    canceled_other_answer: 'Canceled'
  }
  return labels[status] || status
}

export function DialerActiveCalls({
  maxLines,
  activeLegs,
  completedLegs,
  onHangup,
  onMute,
  onDisposition
}: DialerActiveCallsProps) {
  const [durations, setDurations] = useState<Record<string, string>>({})
  const [mutedLegs, setMutedLegs] = useState<Set<string>>(new Set())
  const [dispositionNotes, setDispositionNotes] = useState<Record<string, string>>({})
  const [pendingDispositions, setPendingDispositions] = useState<Set<string>>(new Set())
  const [completedDispositions, setCompletedDispositions] = useState<Set<string>>(new Set())

  // Update durations every second for active calls
  useEffect(() => {
    const interval = setInterval(() => {
      const newDurations: Record<string, string> = {}
      activeLegs.forEach(leg => {
        if (['dialing', 'ringing', 'amd_check', 'answered'].includes(leg.status)) {
          newDurations[leg.legId] = formatDuration(leg.startedAt, leg.answeredAt)
        }
      })
      setDurations(newDurations)
    }, 1000)

    return () => clearInterval(interval)
  }, [activeLegs])

  // Build slots array - combine active and recently completed
  const slots: (ActiveLeg | CompletedLeg | null)[] = Array(maxLines).fill(null)
  
  // Place active legs in their assigned line slots
  activeLegs.forEach(leg => {
    if (leg.lineNumber >= 1 && leg.lineNumber <= maxLines) {
      slots[leg.lineNumber - 1] = leg
    }
  })

  // Place completed legs in empty slots (for fade-out display)
  completedLegs.forEach(leg => {
    if (leg.lineNumber >= 1 && leg.lineNumber <= maxLines && !slots[leg.lineNumber - 1]) {
      slots[leg.lineNumber - 1] = leg
    }
  })

  const handleMuteToggle = (legId: string) => {
    const newMuted = new Set(mutedLegs)
    if (newMuted.has(legId)) {
      newMuted.delete(legId)
    } else {
      newMuted.add(legId)
    }
    setMutedLegs(newMuted)
    onMute?.(legId, newMuted.has(legId))
  }

	  const handleDisposition = async (legId: string, contactId: string, outcome: string) => {
	    setPendingDispositions(prev => new Set(prev).add(legId))
	    try {
	      // Support both sync and async onDisposition handlers without TS warnings
	      if (onDisposition) {
	        await Promise.resolve(onDisposition(legId, contactId, outcome, dispositionNotes[legId]))
	      }
	      setCompletedDispositions(prev => new Set(prev).add(legId))
	      toast.success(`Disposition saved: ${outcome.replace('_', ' ')}`)
	    } catch (error) {
	      toast.error('Failed to save disposition')
	    } finally {
	      setPendingDispositions(prev => {
	        const next = new Set(prev)
	        next.delete(legId)
	        return next
	      })
	    }
	  }

  // Determine grid layout based on maxLines
  const gridCols = maxLines <= 2 ? 'grid-cols-1 md:grid-cols-2'
    : maxLines <= 4 ? 'grid-cols-2'
    : maxLines <= 6 ? 'grid-cols-2 lg:grid-cols-3'
    : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  return (
    <div className={cn('grid gap-4', gridCols)}>
      {slots.map((slot, index) => {
        const lineNumber = index + 1
        const isCompleted = slot && 'outcome' in slot

        if (!slot) {
          // Empty slot
          return (
            <Card key={`slot-${lineNumber}`} className="border-dashed border-2 border-muted-foreground/20">
              <CardContent className="p-6 flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                <Phone className="h-8 w-8 mb-2 opacity-30" />
                <span className="text-sm">Line {lineNumber}</span>
                <span className="text-xs">Available</span>
              </CardContent>
            </Card>
          )
        }

        const status = slot.status
        const contact = slot.contact
        const cardStyles = getCardStyles(status, !!isCompleted)

        return (
          <Card
            key={`slot-${lineNumber}-${slot.legId}`}
            className={cn('transition-all duration-500', cardStyles)}
          >
            <CardContent className="p-4 space-y-3">
              {/* Header: Line number + Status */}
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  Line {lineNumber}
                </Badge>
                <div className="flex items-center gap-2">
                  {status === 'dialing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                  {status === 'ringing' && <PhoneCall className="h-4 w-4 text-yellow-600 animate-bounce" />}
                  {status === 'answered' && <Phone className="h-4 w-4 text-green-600" />}
                  <span className={cn(
                    'text-sm font-medium',
                    status === 'answered' ? 'text-green-700' :
                    status === 'ringing' ? 'text-yellow-700' :
                    status === 'dialing' ? 'text-blue-700' :
                    'text-muted-foreground'
                  )}>
                    {getStatusLabel(status)}
                  </span>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-lg truncate">{contact.fullName}</span>
                </div>

                {contact.llcName && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span className="truncate">{contact.llcName}</span>
                  </div>
                )}

                {contact.propertyAddress && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span className="truncate">
                      {contact.propertyAddress}
                      {contact.city && `, ${contact.city}`}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono">{formatPhoneDisplay(contact.phone)}</span>
                </div>
              </div>

              {/* Duration Timer */}
              {['dialing', 'ringing', 'amd_check', 'answered'].includes(status) && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono tabular-nums">
                    {durations[slot.legId] || '0:00'}
                  </span>
                  {status === 'answered' && (
                    <Badge variant="default" className="ml-auto bg-green-600">
                      LIVE
                    </Badge>
                  )}
                </div>
              )}

              {/* Call Controls (only for answered calls) */}
              {status === 'answered' && !isCompleted && (
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant={mutedLegs.has(slot.legId) ? 'destructive' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleMuteToggle(slot.legId)}
                  >
                    {mutedLegs.has(slot.legId) ? (
                      <><MicOff className="h-4 w-4 mr-1" /> Muted</>
                    ) : (
                      <><Mic className="h-4 w-4 mr-1" /> Mute</>
                    )}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    onClick={() => onHangup?.(slot.legId)}
                  >
                    <PhoneOff className="h-4 w-4 mr-1" /> Hang Up
                  </Button>
                </div>
              )}

              {/* Completed Status with Disposition */}
              {isCompleted && (
                <div className="pt-2 border-t space-y-2">
                  {status === 'canceled_other_answer' ? (
                    <div className="text-center text-sm text-muted-foreground">
                      <span>Canceled - Another contact answered</span>
                    </div>
                  ) : completedDispositions.has(slot.legId) ? (
                    <div className="text-center text-sm text-green-600 flex items-center justify-center gap-1">
                      <Check className="h-4 w-4" />
                      <span>Disposition saved</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground text-center mb-2">
                        {status === 'answered' ? 'Call ended - Select disposition:' : getStatusLabel(status)}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {DISPOSITION_OPTIONS.map(option => {
                          const Icon = option.icon
                          return (
                            <Button
                              key={option.value}
                              variant="ghost"
                              size="sm"
                              className={cn(
                                'text-xs text-white h-7',
                                option.color,
                                pendingDispositions.has(slot.legId) && 'opacity-50'
                              )}
                              disabled={pendingDispositions.has(slot.legId)}
                              onClick={() => handleDisposition(slot.legId, slot.contact.id, option.value)}
                            >
                              <Icon className="h-3 w-3 mr-1" />
                              {option.label}
                            </Button>
                          )
                        })}
                      </div>
                      <input
                        type="text"
                        placeholder="Add notes (optional)"
                        className="w-full text-xs p-1 border rounded"
                        value={dispositionNotes[slot.legId] || ''}
                        onChange={(e) => setDispositionNotes(prev => ({ ...prev, [slot.legId]: e.target.value }))}
                      />
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

