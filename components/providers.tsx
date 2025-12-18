"use client"

import { SessionProvider } from "next-auth/react"
import { ContactsProvider } from "@/lib/context/contacts-context"
import { ActivitiesProvider } from "@/lib/context/activities-context"
import { CallUIProvider, useCallUI } from "@/lib/context/call-ui-context"
import { SmsUIProvider } from "@/lib/context/sms-ui-context"
import { EmailUIProvider } from "@/lib/context/email-ui-context"
import { TaskUIProvider } from "@/lib/context/task-ui-context"
import { PhoneNumberProvider } from "@/lib/context/phone-number-context"
import { ContactPanelProvider } from "@/lib/context/contact-panel-context"
import { MultiCallProvider, useMultiCall } from "@/lib/context/multi-call-context"
import { GlobalCloseProvider } from "@/lib/context/global-close-context"
import RedesignedCallPopup from "@/components/call/redesigned-call-popup"
import MultiCallCards from "@/components/call/multi-call-cards"
import InlineSmsPanel from "@/components/sms/inline-sms-panel"
import InlineEmailPanel from "@/components/email/inline-email-panel"
import GlobalTaskModal from "@/components/tasks/global-task-modal"
import GlobalContactPanel from "@/components/contacts/global-contact-panel"
import InboundCallNotification from "@/components/call/inbound-call-notification"
import WebRTCAutoRegister from "@/components/call/webrtc-auto-register"
import InboundMessageToast from "@/components/notifications/inbound-message-toast"
import { NotificationsProvider } from "@/lib/context/notifications-context"
import GlobalEventsListener from "@/components/global-events-listener"
import { useCallback } from "react"

interface ProvidersProps {
  children: React.ReactNode
}

// Wrapper component to handle inbound call actions with access to MultiCall context
function InboundCallHandler() {
  const { addInboundCall } = useMultiCall()

  const handleAnswer = useCallback(async () => {
    try {
      const { rtcClient } = await import("@/lib/webrtc/rtc-client")
      const inboundInfo = rtcClient.getInboundCallInfo()

      if (!inboundInfo) {
        console.error("[INBOUND] No inbound call to answer")
        return
      }

      // Get the callId BEFORE answering (it might change after answer)
      const originalCallId = inboundInfo.callId
      console.log("[INBOUND] Answering call with original ID:", originalCallId)

      // Answer the call
      const { sessionId } = await rtcClient.answerInbound()
      console.log("[INBOUND] Call answered, session ID:", sessionId, "original:", originalCallId)

      // Try to look up the contact by phone number using the proper lookup API
      let contact = null
      try {
        const cleanPhone = inboundInfo.callerNumber.replace(/\D/g, '').slice(-10)
        if (cleanPhone) {
          const res = await fetch(`/api/contacts/lookup-by-number?last10=${cleanPhone}`)
          if (res.ok) {
            const data = await res.json()
            if (data && data.id) {
              contact = data // The lookup API returns the contact directly, not in a wrapper
            }
          }
        }
      } catch (e) {
        console.warn("[INBOUND] Could not lookup contact:", e)
      }

      // Log the inbound call to database
      fetch('/api/telnyx/webrtc-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webrtcSessionId: sessionId || originalCallId,
          contactId: contact?.id || null,
          fromNumber: inboundInfo.callerNumber,
          toNumber: inboundInfo.destinationNumber || '',
          direction: 'inbound',
        })
      }).catch(err => console.error('[INBOUND] Failed to log inbound call:', err))

      // Add the inbound call to the multi-call UI (thin window without activity history)
      addInboundCall({
        callId: sessionId || originalCallId,
        contact: contact,
        callerNumber: inboundInfo.callerNumber,
        destinationNumber: inboundInfo.destinationNumber || '',
      })
    } catch (err) {
      console.error("[INBOUND] Error answering call:", err)
    }
  }, [addInboundCall])

  const handleDecline = useCallback(async () => {
    try {
      const { rtcClient } = await import("@/lib/webrtc/rtc-client")
      await rtcClient.declineInbound()
    } catch (err) {
      console.error("[INBOUND] Error declining call:", err)
    }
  }, [])

  return <InboundCallNotification onAnswer={handleAnswer} onDecline={handleDecline} />
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <PhoneNumberProvider>
        <ContactsProvider>
          <ActivitiesProvider>
            <NotificationsProvider>
              <CallUIProvider>
                <MultiCallProvider>
                  <SmsUIProvider>
                    <EmailUIProvider>
                      <TaskUIProvider>
                        <ContactPanelProvider>
                          <GlobalCloseProvider>
                            {children}
                            {/* Auto-register WebRTC for inbound calls */}
                            <WebRTCAutoRegister />
                            {/* Global events listener for toasts/notifications */}
                            <GlobalEventsListener />
                            {/* Global call popup (single call - existing) */}
                            <RedesignedCallPopup />
                            {/* Multi-call cards for manual dialer (multiple calls side-by-side) */}
                            <MultiCallCards />
                            {/* Inbound call notification */}
                            <InboundCallHandler />
                            {/* Global SMS panel */}
                            <InlineSmsPanel />
                            {/* Global Email panel */}
                            <InlineEmailPanel />
                            {/* Global Task Modal */}
                            <GlobalTaskModal />
                            {/* Global Contact Side Panel */}
                            <GlobalContactPanel />
                            {/* Inbound message notifications (SMS/Email) */}
                            <InboundMessageToast />
                          </GlobalCloseProvider>
                        </ContactPanelProvider>
                      </TaskUIProvider>
                    </EmailUIProvider>
                  </SmsUIProvider>
                </MultiCallProvider>
              </CallUIProvider>
            </NotificationsProvider>
          </ActivitiesProvider>
        </ContactsProvider>
      </PhoneNumberProvider>
    </SessionProvider>
  )
}
