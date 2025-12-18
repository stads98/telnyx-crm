/**
 * In-memory store for pending AMD (Answering Machine Detection) calls
 * 
 * This is used to track calls initiated with AMD enabled so that
 * the webhook handler can access the call metadata when AMD results arrive.
 */

export type AMDStatus = 'initiated' | 'ringing' | 'answered' | 'amd_checking' | 'human_detected' | 'machine_detected' | 'voicemail' | 'no_answer' | 'busy' | 'failed' | 'ended'

export interface PendingAMDCall {
  type?: string             // 'manual_multi_call' or 'power_dialer'
  sessionId?: string
  queueItemId?: string
  contactId?: string        // Optional - may not have a CRM contact
  contactName?: string      // Display name for UI
  fromNumber: string
  toNumber: string
  userId: string
  startedAt: number
  listId?: string
  listEntryId?: string
  // Status tracking for polling
  status: AMDStatus
  amdResult?: 'human' | 'machine' | 'fax' | 'unknown' | 'uncertain'
  hangupCause?: string
}

// Maps callControlId to call metadata
export const pendingAMDCalls = new Map<string, PendingAMDCall>()

// Cleanup old entries (older than 10 minutes)
export function cleanupOldAMDCalls() {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000
  for (const [callControlId, call] of pendingAMDCalls.entries()) {
    if (call.startedAt < tenMinutesAgo) {
      pendingAMDCalls.delete(callControlId)
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupOldAMDCalls, 5 * 60 * 1000)
}

