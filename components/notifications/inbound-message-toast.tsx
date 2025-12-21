"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"
import { MessageSquare, Mail, X, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneNumberForDisplay } from "@/lib/phone-utils"

interface InboundMessageToastProps {
  enabled?: boolean
  pollInterval?: number // ms
  // Scope polling to specific pages - if not provided, polls on all pages
  allowedPaths?: string[]
}

interface Notification {
  id: string
  type: 'sms' | 'email'
  contactName: string
  contactId?: string
  phoneNumber?: string
  from?: string
  subject?: string
  body: string
  timestamp: Date
}

const SHOWN_IDS_KEY = 'accrm.shown_notification_ids'
const LAST_CHECK_KEY = 'accrm.last_notification_check'

// Load shown IDs from localStorage on module load
function loadShownIds(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = localStorage.getItem(SHOWN_IDS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    // Keep only the last 500 IDs to prevent unbounded growth
    return new Set(Array.isArray(arr) ? arr.slice(-500) : [])
  } catch { return new Set() }
}

// Load last check time from localStorage
function loadLastCheckTime(): string {
  try {
    if (typeof window === 'undefined') return new Date().toISOString()
    const raw = localStorage.getItem(LAST_CHECK_KEY)
    if (!raw) return new Date().toISOString()
    const data = JSON.parse(raw)
    return data.lastCheck || new Date().toISOString()
  } catch { return new Date().toISOString() }
}

// Save shown IDs to localStorage
function saveShownIds(ids: Set<string>) {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(SHOWN_IDS_KEY, JSON.stringify([...ids].slice(-500)))
  } catch {}
}

// Save last check time to localStorage
function saveLastCheckTime(time: string) {
  try {
    if (typeof window === 'undefined') return
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify({ lastCheck: time }))
  } catch {}
}

export default function InboundMessageToast({
  enabled = true,
  pollInterval = 5000, // Check every 5 seconds
  allowedPaths, // If provided, only poll on these paths
}: InboundMessageToastProps) {
  const router = useRouter()
  const pathname = usePathname()
  // Initialize from localStorage to persist across navigation/remounts
  const lastSmsCheckRef = useRef<string>(loadLastCheckTime())
  const lastEmailCheckRef = useRef<string>(loadLastCheckTime())
  const [notifications, setNotifications] = useState<Notification[]>([])
  // Track which notification IDs have been shown - persisted in localStorage
  const shownNotificationIdsRef = useRef<Set<string>>(loadShownIds())
  // Track visibility state for pausing polling when tab is hidden
  const isVisibleRef = useRef<boolean>(true)
  // Exponential backoff state
  const smsBackoffRef = useRef<number>(1)
  const emailBackoffRef = useRef<number>(1)
  const MAX_BACKOFF = 8 // Max 8x the poll interval (40 seconds at 5s base)

  const addNotification = useCallback((notification: Notification) => {
    // Skip if we've already shown this notification
    if (shownNotificationIdsRef.current.has(notification.id)) return

    setNotifications(prev => {
      // Don't add duplicate notifications
      if (prev.some(n => n.id === notification.id)) return prev
      // Mark as shown and persist to localStorage
      shownNotificationIdsRef.current.add(notification.id)
      saveShownIds(shownNotificationIdsRef.current)
      // Keep max 10 notifications
      const updated = [notification, ...prev].slice(0, 10)
      return updated
    })
  }, [])

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    setNotifications([])
  }, [])

  const handleSmsClick = useCallback((notification: Notification) => {
    if (notification.phoneNumber && notification.contactId) {
      // Navigate to Text Center (messaging section) with this contact pre-selected
      router.push(`/dashboard?section=messaging&contactId=${notification.contactId}`)
    } else if (notification.phoneNumber) {
      // If no contactId, navigate to messaging section - user can search for the number
      router.push(`/dashboard?section=messaging`)
    }
    dismissNotification(notification.id)
  }, [router, dismissNotification])

  // Visibility change handler - pause polling when tab is hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    if (!enabled) return

    // Check if we should poll on this path
    if (allowedPaths && allowedPaths.length > 0) {
      const shouldPoll = allowedPaths.some(path => pathname?.startsWith(path))
      if (!shouldPoll) return
    }

    // Check for new inbound SMS with exponential backoff
    const checkNewSms = async () => {
      // Skip if tab is hidden
      if (!isVisibleRef.current) return

      try {
        const since = lastSmsCheckRef.current
        const res = await fetch(`/api/telnyx/sms/inbound?since=${encodeURIComponent(since)}&limit=5`)

        // Silently ignore 404 errors (endpoint may not be built yet)
        if (res.status === 404) {
          // Increase backoff on 404
          smsBackoffRef.current = Math.min(smsBackoffRef.current * 2, MAX_BACKOFF)
          return
        }

        if (!res.ok) {
          // Increase backoff on error
          smsBackoffRef.current = Math.min(smsBackoffRef.current * 2, MAX_BACKOFF)
          return
        }

        // Reset backoff on success
        smsBackoffRef.current = 1

        const data = await res.json()
        const messages = data.messages || []

        if (messages.length > 0) {
          // Update last check time and persist
          const newTime = new Date().toISOString()
          lastSmsCheckRef.current = newTime
          saveLastCheckTime(newTime)

          // Add notification for each new message
          messages.forEach((msg: any) => {
            // Use stable ID based on message ID for deduplication
            const notificationId = `sms-${msg.id}`

            const contactName = msg.contact
              ? `${msg.contact.firstName || ''} ${msg.contact.lastName || ''}`.trim() || 'Unknown'
              : 'Unknown'

            addNotification({
              id: notificationId,
              type: 'sms',
              contactName,
              contactId: msg.contact?.id,
              phoneNumber: msg.from,
              body: msg.body || '',
              timestamp: new Date(msg.createdAt || Date.now()),
            })
          })
        }
      } catch {
        // Increase backoff on error
        smsBackoffRef.current = Math.min(smsBackoffRef.current * 2, MAX_BACKOFF)
      }
    }

    // Check for new inbound emails with exponential backoff
    const checkNewEmails = async () => {
      // Skip if tab is hidden
      if (!isVisibleRef.current) return

      try {
        const since = lastEmailCheckRef.current
        const res = await fetch(`/api/email/inbound?since=${encodeURIComponent(since)}&limit=5`)

        // Silently ignore 404 errors (endpoint may not be built yet)
        if (res.status === 404) {
          // Increase backoff on 404
          emailBackoffRef.current = Math.min(emailBackoffRef.current * 2, MAX_BACKOFF)
          return
        }

        if (!res.ok) {
          // Increase backoff on error
          emailBackoffRef.current = Math.min(emailBackoffRef.current * 2, MAX_BACKOFF)
          return
        }

        // Reset backoff on success
        emailBackoffRef.current = 1

        const data = await res.json()
        const emails = data.emails || []

        if (emails.length > 0) {
          // Update last check time and persist
          const newTime = new Date().toISOString()
          lastEmailCheckRef.current = newTime
          saveLastCheckTime(newTime)

          // Add notification for each new email
          emails.forEach((email: any) => {
            // Use stable ID based on email ID for deduplication
            const notificationId = `email-${email.id}`

            addNotification({
              id: notificationId,
              type: 'email',
              contactName: email.from || 'Unknown',
              from: email.from,
              subject: email.subject,
              body: email.snippet || email.body || '',
              timestamp: new Date(email.createdAt || Date.now()),
            })
          })
        }
      } catch {
        // Increase backoff on error
        emailBackoffRef.current = Math.min(emailBackoffRef.current * 2, MAX_BACKOFF)
      }
    }

    // Initial check (only if tab is visible)
    if (isVisibleRef.current) {
      checkNewSms()
      checkNewEmails()
    }

    // Set up polling with dynamic intervals based on backoff
    let smsTimeoutId: NodeJS.Timeout
    let emailTimeoutId: NodeJS.Timeout

    const scheduleSmsCheck = () => {
      const interval = pollInterval * smsBackoffRef.current
      smsTimeoutId = setTimeout(() => {
        checkNewSms()
        scheduleSmsCheck()
      }, interval)
    }

    const scheduleEmailCheck = () => {
      const interval = pollInterval * emailBackoffRef.current
      emailTimeoutId = setTimeout(() => {
        checkNewEmails()
        scheduleEmailCheck()
      }, interval)
    }

    scheduleSmsCheck()
    scheduleEmailCheck()

    return () => {
      clearTimeout(smsTimeoutId)
      clearTimeout(emailTimeoutId)
    }
  }, [enabled, pollInterval, addNotification])

  // Don't render if no notifications
  if (notifications.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-h-[80vh] overflow-hidden">
      {/* Clear all button */}
      {notifications.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-end text-xs text-muted-foreground hover:text-foreground mb-1"
          onClick={dismissAll}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear all ({notifications.length})
        </Button>
      )}

      {/* Notification cards */}
      <div className="flex flex-col gap-2 overflow-y-auto">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className="w-[320px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-right-5 duration-300"
          >
            <div className="p-3">
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                  notification.type === 'sms'
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-purple-100 dark:bg-purple-900/30'
                }`}>
                  {notification.type === 'sms' ? (
                    <MessageSquare className="h-5 w-5 text-green-600" />
                  ) : (
                    <Mail className="h-5 w-5 text-purple-600" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                      {notification.type === 'sms' ? 'New SMS' : 'New Email'}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => dismissNotification(notification.id)}
                    >
                      <X className="h-4 w-4 text-gray-400" />
                    </Button>
                  </div>

                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {notification.contactName !== 'Unknown' ? notification.contactName : ''}
                    {notification.phoneNumber && (
                      <span className="ml-1">
                        {notification.contactName !== 'Unknown' ? '· ' : ''}
                        {formatPhoneNumberForDisplay(notification.phoneNumber)}
                      </span>
                    )}
                    {notification.type === 'email' && notification.from && (
                      <span>{notification.from}</span>
                    )}
                  </div>

                  {notification.type === 'email' && notification.subject && (
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-1 truncate">
                      {notification.subject}
                    </div>
                  )}

                  <div className="text-sm text-gray-800 dark:text-gray-200 mt-1 line-clamp-2">
                    {notification.body.substring(0, 100)}{notification.body.length > 100 ? '...' : ''}
                  </div>
                </div>
              </div>

              {/* Actions for SMS */}
              {notification.type === 'sms' && notification.phoneNumber && (
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleSmsClick(notification)}
                  >
                    <MessageSquare className="h-3 w-3 mr-1" />
                    Reply
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

