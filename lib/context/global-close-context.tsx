"use client"

import { createContext, useContext, useEffect, useCallback } from 'react'
import { useMultiCall } from './multi-call-context'
import { useSmsUI } from './sms-ui-context'
import { useEmailUI } from './email-ui-context'

type GlobalCloseContextType = {
  closeAllWindows: () => void
}

const GlobalCloseContext = createContext<GlobalCloseContextType | undefined>(undefined)

export function GlobalCloseProvider({ children }: { children: React.ReactNode }) {
  const { hangUpAllCalls, setActiveCalls, setPrimaryCallId } = useMultiCall()
  const { smsSessions, closeSession: closeSmsSession } = useSmsUI()
  const { emailSession, close: closeEmail } = useEmailUI()

  const closeAllWindows = useCallback(() => {
    console.log('[GlobalClose] Cmd/Ctrl+X: Closing all windows...')

    // 1. Hang up all active calls
    hangUpAllCalls()

    // 2. Close all SMS sessions
    smsSessions.forEach(session => {
      closeSmsSession(session.sessionId)
    })

    // 3. Close email session
    if (emailSession) {
      closeEmail()
    }

    // 4. Close contact panels (handled by event)
    window.dispatchEvent(new CustomEvent('close-all-panels'))

    // 5. Wait 1.5 seconds then dismiss all call windows
    setTimeout(() => {
      console.log('[GlobalClose] Dismissing all call windows')
      setActiveCalls(new Map())
      setPrimaryCallId(null)
    }, 1500)
  }, [hangUpAllCalls, smsSessions, closeSmsSession, emailSession, closeEmail, setActiveCalls, setPrimaryCallId])

  // Global keyboard shortcut: Cmd+X (Mac) or Ctrl+X (Windows) to close all windows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+X (Mac) or Ctrl+X (Windows) to close all windows
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        // Don't trigger if user is typing in an input/textarea
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }

        e.preventDefault()
        closeAllWindows()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeAllWindows])

  return (
    <GlobalCloseContext.Provider value={{ closeAllWindows }}>
      {children}
    </GlobalCloseContext.Provider>
  )
}

export function useGlobalClose() {
  const ctx = useContext(GlobalCloseContext)
  if (!ctx) throw new Error('useGlobalClose must be used within GlobalCloseProvider')
  return ctx
}

