"use client"

/**
 * SIMPLE OUTBOUND CALL CLIENT
 * Minimal implementation following Telnyx WebRTC docs exactly
 * https://developers.telnyx.com/development/webrtc/js-sdk/quickstart
 */

let TelnyxRTCModule: any = null

async function loadSDK() {
  if (!TelnyxRTCModule) {
    TelnyxRTCModule = await import("@telnyx/webrtc")
  }
  return TelnyxRTCModule.TelnyxRTC || TelnyxRTCModule.default || TelnyxRTCModule
}

class SimpleOutboundClient {
  private client: any = null
  private audioEl: HTMLAudioElement | null = null
  private currentCall: any = null
  private isReady = false

  async connect(login: string, password: string): Promise<void> {
    console.log('[SIMPLE] Connecting...')
    
    // 1. Create audio element FIRST (per Telnyx docs)
    if (!this.audioEl && typeof document !== 'undefined') {
      this.audioEl = document.createElement('audio')
      this.audioEl.id = 'simple-remote-audio'
      this.audioEl.autoplay = true
      document.body.appendChild(this.audioEl)
      console.log('[SIMPLE] Audio element created')
    }

    // 2. Load SDK
    const TelnyxRTC = await loadSDK()
    console.log('[SIMPLE] SDK loaded')

    // 3. Create client
    this.client = new TelnyxRTC({
      login,
      password,
    })

    // 4. Set remoteElement on CLIENT (this is the key per Telnyx docs)
    this.client.remoteElement = 'simple-remote-audio'
    console.log('[SIMPLE] Set client.remoteElement = simple-remote-audio')

    // 5. Set up event handlers
    this.client.on('telnyx.ready', () => {
      console.log('[SIMPLE] ✅ Ready!')
      this.isReady = true
    })

    this.client.on('telnyx.error', (err: any) => {
      console.error('[SIMPLE] Error:', err)
    })

    this.client.on('telnyx.notification', (notification: any) => {
      const call = notification.call
      if (!call) return
      
      console.log('[SIMPLE] Call state:', call.state)
      
      if (call.state === 'active') {
        console.log('[SIMPLE] ✅ Call is ACTIVE - audio should be playing')
        // Log audio element state
        if (this.audioEl) {
          console.log('[SIMPLE] Audio element state:', {
            srcObject: this.audioEl.srcObject ? 'SET' : 'NOT SET',
            paused: this.audioEl.paused,
            muted: this.audioEl.muted,
            volume: this.audioEl.volume,
            readyState: this.audioEl.readyState
          })
        }
      }
      
      if (call.state === 'hangup' || call.state === 'destroy') {
        console.log('[SIMPLE] Call ended')
        this.currentCall = null
      }
    })

    // 6. Connect
    await this.client.connect()
    console.log('[SIMPLE] connect() called, waiting for ready...')
    
    // Wait for ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 15000)
      const check = () => {
        if (this.isReady) {
          clearTimeout(timeout)
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }

  async call(toNumber: string, fromNumber: string): Promise<any> {
    if (!this.client || !this.isReady) {
      throw new Error('Client not ready')
    }

    console.log('[SIMPLE] Calling', toNumber, 'from', fromNumber)

    // Format E.164
    let destination = toNumber
    const digits = toNumber.replace(/\D/g, '')
    if (!toNumber.startsWith('+')) {
      if (digits.length === 10) destination = `+1${digits}`
      else if (digits.length === 11 && digits.startsWith('1')) destination = `+${digits}`
    }

    this.currentCall = await this.client.newCall({
      destinationNumber: destination,
      callerNumber: fromNumber,
      audio: true,
      video: false,
    })

    console.log('[SIMPLE] Call created:', this.currentCall?.id)
    return this.currentCall
  }

  hangup(): void {
    if (this.currentCall) {
      this.currentCall.hangup()
      this.currentCall = null
    }
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
    if (this.audioEl) {
      this.audioEl.remove()
      this.audioEl = null
    }
    this.isReady = false
  }
}

// Export singleton
export const simpleOutbound = new SimpleOutboundClient()

