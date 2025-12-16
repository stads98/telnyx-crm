"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Phone, PhoneOff, PhoneIncoming, MessageCircle } from "lucide-react"
import { formatPhoneNumberForDisplay, formatPhoneToE164 } from "@/lib/phone-utils"
import type { InboundCallInfo } from "@/lib/webrtc/rtc-client"
import { useToast } from "@/hooks/use-toast"

interface InboundCallNotificationProps {
  onAnswer: () => void
  onDecline: () => void
}

// Quick text response options
const QUICK_TEXT_RESPONSES = [
  "I can't talk right now",
  "I'll call you back in 5 min",
  "Please text me instead"
]

export default function InboundCallNotification({ onAnswer, onDecline }: InboundCallNotificationProps) {
  const [inboundCall, setInboundCall] = useState<InboundCallInfo | null>(null)
  const [contactName, setContactName] = useState<string | null>(null)
  const [isAnswering, setIsAnswering] = useState(false)
  const [pulseCount, setPulseCount] = useState(0)
  const [isSendingText, setIsSendingText] = useState(false)
  const { toast } = useToast()

  // Listen for inbound calls
  useEffect(() => {
    let mounted = true
    let cleanupFn: (() => void) | null = null

    const setupListener = async () => {
      try {
        console.log("[INBOUND] Setting up inbound call listener...")
        const { rtcClient } = await import("@/lib/webrtc/rtc-client")

        const handleInboundCall = async (info: InboundCallInfo) => {
          if (!mounted) return
          console.log("[INBOUND] 📞 RECEIVED INBOUND CALL:", info)
          setInboundCall(info)

          // Try to lookup contact by phone number
          try {
            const digits = (info.callerNumber || '').replace(/\D/g, '').slice(-10)
            if (digits) {
              const res = await fetch(`/api/contacts/lookup-by-number?last10=${digits}`)
              if (res.ok) {
                const contact = await res.json()
                if (contact?.firstName || contact?.lastName) {
                  setContactName(`${contact.firstName || ''} ${contact.lastName || ''}`.trim())
                }
              }
            }
          } catch (err) {
            console.error("[INBOUND] Error looking up contact:", err)
          }
        }

        const handleInboundEnded = () => {
          if (!mounted) return
          console.log("[INBOUND] Call ended")
          setInboundCall(null)
          setContactName(null)
          setIsAnswering(false)
        }

        // Also listen for callUpdate to catch all states
        const handleCallUpdate = (data: { state: string; direction?: string }) => {
          if (!mounted) return
          console.log("[INBOUND] callUpdate:", data.state, data.direction)
        }

        // Listen for inboundCallUpdate to get destinationNumber when invite arrives late
        const handleInboundCallUpdate = (data: { callId: string; destinationNumber?: string; callerNumber?: string; callerName?: string }) => {
          if (!mounted) return
          console.log("[INBOUND] inboundCallUpdate received:", data)

          // Update the inbound call with the destination number
          setInboundCall(prev => {
            if (prev && (prev.callId === data.callId || !prev.destinationNumber)) {
              console.log("[INBOUND] Updating call with destinationNumber:", data.destinationNumber)
              return {
                ...prev,
                destinationNumber: data.destinationNumber || prev.destinationNumber,
                callerNumber: data.callerNumber || prev.callerNumber,
                callerName: data.callerName || prev.callerName
              }
            }
            return prev
          })
        }

        rtcClient.on("inboundCall", handleInboundCall)
        rtcClient.on("inboundCallEnded", handleInboundEnded)
        rtcClient.on("callUpdate", handleCallUpdate)
        rtcClient.on("inboundCallUpdate", handleInboundCallUpdate)

        console.log("[INBOUND] ✅ Listeners registered")

        // Check if there's already an inbound call
        const existing = rtcClient.getInboundCallInfo()
        if (existing) {
          console.log("[INBOUND] Found existing inbound call:", existing)
          handleInboundCall(existing)
        }

        cleanupFn = () => {
          console.log("[INBOUND] Cleaning up listeners")
          rtcClient.off("inboundCall", handleInboundCall)
          rtcClient.off("inboundCallEnded", handleInboundEnded)
          rtcClient.off("callUpdate", handleCallUpdate)
          rtcClient.off("inboundCallUpdate", handleInboundCallUpdate)
        }
      } catch (err) {
        console.error("[INBOUND] Error setting up listener:", err)
      }
    }

    // Small delay to ensure rtcClient is initialized
    const initTimeout = setTimeout(setupListener, 3000)

    return () => {
      mounted = false
      clearTimeout(initTimeout)
      if (cleanupFn) cleanupFn()
    }
  }, [])

  const handleAnswer = async () => {
    setIsAnswering(true)
    try {
      onAnswer()
    } catch (err) {
      console.error("[INBOUND] Error answering:", err)
      setIsAnswering(false)
    }
  }

  const handleDecline = () => {
    onDecline()
    setInboundCall(null)
    setContactName(null)
  }

  // Send a quick text response and decline the call
  const handleQuickTextResponse = async (message: string) => {
    if (!inboundCall?.callerNumber || !inboundCall?.destinationNumber) {
      toast({ title: 'Error', description: 'Missing phone number info', variant: 'destructive' })
      return
    }

    setIsSendingText(true)
    try {
      const toNumber = formatPhoneToE164(inboundCall.callerNumber)
      const fromNumber = formatPhoneToE164(inboundCall.destinationNumber)

      const res = await fetch('/api/telnyx/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toNumber,
          from: fromNumber,
          message
        })
      })

      if (res.ok) {
        toast({ title: 'Text sent', description: `"${message}"` })
      } else {
        const err = await res.json()
        toast({ title: 'Failed to send', description: err.error || 'Unknown error', variant: 'destructive' })
      }
    } catch (err) {
      console.error('[INBOUND] Error sending quick text:', err)
      toast({ title: 'Error', description: 'Failed to send text', variant: 'destructive' })
    } finally {
      setIsSendingText(false)
      // Decline the call after sending text
      handleDecline()
    }
  }

  // Visual pulse effect for attention
  useEffect(() => {
    if (!inboundCall) return
    const interval = setInterval(() => {
      setPulseCount(c => c + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [inboundCall])

  if (!inboundCall) return null

  const displayName = contactName || inboundCall.callerName || formatPhoneNumberForDisplay(inboundCall.callerNumber)
  const destinationDisplay = inboundCall.destinationNumber
    ? formatPhoneNumberForDisplay(inboundCall.destinationNumber)
    : null

  return (
    <div className="fixed top-4 right-4 z-[100] animate-in slide-in-from-top-2 duration-300">
      <div className="bg-white border-2 border-green-500 rounded-lg shadow-2xl p-5 w-[340px]">
        {/* Pulsing indicator and caller info */}
        <div className="flex items-start gap-4 mb-4">
          <div className="relative flex-shrink-0">
            <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />
            <div className="relative bg-green-500 rounded-full p-3">
              <PhoneIncoming className="h-7 w-7 text-white animate-pulse" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-green-600 flex items-center gap-2">
              📞 Incoming Call
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            </div>
            <div className="text-lg font-bold truncate">{displayName}</div>
            {contactName && (
              <div className="text-sm text-gray-600">
                {formatPhoneNumberForDisplay(inboundCall.callerNumber)}
              </div>
            )}
            {destinationDisplay && (
              <div className="text-xs text-gray-500 mt-1">
                Calling: <span className="font-medium">{destinationDisplay}</span>
              </div>
            )}
          </div>
        </div>

        {/* Ring indicator */}
        <div className="text-center text-sm text-gray-500 mb-3 animate-pulse">
          🔔 Ringing... ({pulseCount}s)
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button
            className="flex-1 bg-green-600 hover:bg-green-700 text-white h-12 text-base"
            onClick={handleAnswer}
            disabled={isAnswering || isSendingText}
          >
            <Phone className="h-5 w-5 mr-2" />
            {isAnswering ? "Connecting..." : "Answer"}
          </Button>
          <Button
            variant="destructive"
            className="flex-1 h-12 text-base"
            onClick={handleDecline}
            disabled={isAnswering || isSendingText}
          >
            <PhoneOff className="h-5 w-5 mr-2" />
            Decline
          </Button>
        </div>

        {/* Quick text responses - decline with a text message */}
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            Send text & decline
          </div>
          <div className="flex flex-col gap-1.5">
            {QUICK_TEXT_RESPONSES.map((msg) => (
              <Button
                key={msg}
                variant="outline"
                size="sm"
                className="w-full text-xs h-8 justify-start text-gray-700 hover:bg-gray-100"
                onClick={() => handleQuickTextResponse(msg)}
                disabled={isAnswering || isSendingText}
              >
                {isSendingText ? "Sending..." : msg}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

