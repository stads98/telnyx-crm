"use client"

import type { TelnyxRTC as TelnyxRTCType } from "@telnyx/webrtc"

// Lazy import to avoid SSR issues
let TelnyxRTCImport: Promise<any> | null = null
function getSDK() {
  if (!TelnyxRTCImport) {
    TelnyxRTCImport = import("@telnyx/webrtc")
  }
  return TelnyxRTCImport
}

type StartCallOpts = { toNumber: string; fromNumber?: string }

type Listener = (event: any) => void

export type InboundCallInfo = {
  callId: string
  callerNumber: string
  callerName?: string
  destinationNumber?: string  // Which Telnyx number was called
  call: any
}

class TelnyxWebRTCClient {
  // VERSION: 2024-12-22-18:00 - REVERT TO SIMPLE AUDIO HANDLING
  private client: any | null = null
  private registered = false
  private currentCall: any | null = null
  private inboundCall: any | null = null
  private listeners: Record<string, Listener[]> = {}
  private audioEl: HTMLAudioElement | null = null
  private ringtoneEl: HTMLAudioElement | null = null
  private localStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private ringtoneOscillator: OscillatorNode | null = null
  private ringtoneGain: GainNode | null = null
  private ringtoneInterval: NodeJS.Timeout | null = null
  // Ringback tone for outbound calls
  private ringbackEl: HTMLAudioElement | null = null
  private ringbackInterval: NodeJS.Timeout | null = null
  // For tracking pending inbound calls from invite messages
  private pendingInboundCallId: string | null = null
  private pendingInboundInfo: { callerNumber?: string; callerName?: string; destinationNumber?: string } | null = null
  // Flag to track if AudioContext has been unlocked by user gesture
  private audioContextUnlocked = false
  // Track outbound call IDs to distinguish from inbound
  private outboundCallIds = new Set<string>()
  // Flag to prevent false inbound detection during outbound call initiation
  private isInitiatingOutbound = false
  // Power dialer mode - auto-answer incoming calls (for transferred calls from dialer)
  private powerDialerMode = false
  // Track multiple active calls for multi-line dialing
  private activeCalls = new Map<string, any>()
  // Audio level monitoring
  private audioMonitorInterval: NodeJS.Timeout | null = null

  constructor() {
    console.log('[RTC] 🔧 WebRTC Client Version: 2024-12-22-18:00 - REVERT TO SIMPLE AUDIO')
  }

  /**
   * Enable/disable power dialer mode
   * When enabled, incoming calls are auto-answered (for transferred calls from power dialer)
   */
  setPowerDialerMode(enabled: boolean) {
    this.powerDialerMode = enabled
    console.log(`[RTC] Power dialer mode: ${enabled ? 'ENABLED' : 'DISABLED'}`)
  }

  isPowerDialerModeEnabled(): boolean {
    return this.powerDialerMode
  }

  on(event: string, handler: Listener) {
    this.listeners[event] = this.listeners[event] || []
    this.listeners[event].push(handler)
  }

  off(event: string, handler: Listener) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter(fn => fn !== handler)
  }

  private emit(event: string, payload?: any) {
    ;(this.listeners[event] || []).forEach((fn) => fn(payload))
  }

  // Initialize Web Audio API ringtone and set up user gesture unlock
  private initRingtone() {
    if (typeof window === 'undefined') return
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      // If AudioContext is suspended (browser policy), we need a user gesture to unlock it
      if (this.audioContext.state === 'suspended') {
        console.log('[RTC] AudioContext suspended, will unlock on user gesture')
        const unlockAudio = () => {
          if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
              console.log('[RTC] 🔊 AudioContext unlocked!')
              this.audioContextUnlocked = true
            }).catch(console.warn)
          }
          // Remove listeners after first interaction
          document.removeEventListener('click', unlockAudio)
          document.removeEventListener('keydown', unlockAudio)
          document.removeEventListener('touchstart', unlockAudio)
        }
        document.addEventListener('click', unlockAudio)
        document.addEventListener('keydown', unlockAudio)
        document.addEventListener('touchstart', unlockAudio)
      } else {
        this.audioContextUnlocked = true
      }
    } catch (e) {
      console.warn('[RTC] Could not create AudioContext for ringtone:', e)
    }
  }

  // Play ringtone using Web Audio API (gentle chime pattern - more pleasant than harsh phone ring)
  private playRingtone() {
    console.log('[RTC] 🔔 playRingtone() called')

    if (!this.audioContext) {
      this.initRingtone()
    }

    this.stopRingtone()

    // Show browser notification FIRST (always works if permission granted)
    this.showInboundNotification()

    // ALWAYS try the fallback ringtone as a backup - it might work if user has interacted
    this.playFallbackRingtone()

    // Try to resume AudioContext if suspended - wait for it to be ready
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('[RTC] ✓ AudioContext resumed for ringtone')
        this.startRingtoneChimes()
      }).catch((err) => {
        console.warn('[RTC] Could not resume AudioContext, fallback already playing:', err)
      })
      return
    }

    this.startRingtoneChimes()
  }

  private startRingtoneChimes() {
    // If AudioContext isn't ready, fallback is already running from playRingtone()
    if (!this.audioContext || this.audioContext.state !== 'running') {
      console.log('[RTC] AudioContext not ready for ringtone chimes (fallback should be running)')
      return
    }

    console.log('[RTC] 🎵 Starting Web Audio API ringtone chimes')

    const playChime = () => {
      if (!this.audioContext || this.audioContext.state !== 'running') {
        console.log('[RTC] AudioContext not ready for ringtone chime')
        return
      }

      try {
        const ctx = this.audioContext
        const now = ctx.currentTime

        // Create a pleasant two-note chime (like iPhone or modern phone ringtones)
        // Notes: E5 (659Hz) and G5 (784Hz) - a pleasant minor third interval
        const notes = [
          { freq: 659.25, start: 0, duration: 0.15 },      // E5
          { freq: 783.99, start: 0.18, duration: 0.15 },   // G5
          { freq: 659.25, start: 0.36, duration: 0.15 },   // E5
          { freq: 783.99, start: 0.54, duration: 0.25 },   // G5 (longer)
        ]

        notes.forEach(note => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()

          // Use triangle wave for softer, more pleasant tone
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(note.freq, now + note.start)

          // Gentle envelope: quick attack, smooth decay
          gain.gain.setValueAtTime(0, now + note.start)
          gain.gain.linearRampToValueAtTime(0.35, now + note.start + 0.02) // Quick attack (louder: 0.35 instead of 0.25)
          gain.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.duration) // Smooth decay

          osc.connect(gain)
          gain.connect(ctx.destination)

          osc.start(now + note.start)
          osc.stop(now + note.start + note.duration + 0.1)
        })
      } catch (e) {
        console.warn('[RTC] Error playing ringtone chime:', e)
      }
    }

    // Play immediately
    playChime()

    // Repeat every 2 seconds (more frequent to be more noticeable)
    this.ringtoneInterval = setInterval(playChime, 2000)
  }

  // Fallback ringtone using HTML audio element
  private playFallbackRingtone() {
    console.log('[RTC] 🔔 playFallbackRingtone() called')

    if (!this.ringtoneEl && typeof document !== 'undefined') {
      console.log('[RTC] Creating fallback ringtone audio element...')
      const el = document.createElement('audio')
      el.loop = true
      el.volume = 0.8 // Louder volume (was 0.5)
      // Use a longer, more noticeable beep pattern with two tones
      // This creates a classic phone ring pattern: two tones alternating
      const duration = 1.0 // seconds (longer)
      const sampleRate = 8000
      const numSamples = Math.floor(duration * sampleRate)
      const buffer = new ArrayBuffer(44 + numSamples)
      const view = new DataView(buffer)

      // WAV header
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i))
        }
      }

      writeString(0, 'RIFF')
      view.setUint32(4, 36 + numSamples, true)
      writeString(8, 'WAVE')
      writeString(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate, true)
      view.setUint16(32, 1, true)
      view.setUint16(34, 8, true)
      writeString(36, 'data')
      view.setUint32(40, numSamples, true)

      // Generate two-tone ring pattern (440Hz and 480Hz alternating - classic US phone ring)
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate
        // Alternate between 440Hz and 480Hz every 0.25 seconds
        const freq = Math.floor(t / 0.25) % 2 === 0 ? 440 : 480
        const value = Math.sin(2 * Math.PI * freq * t)
        view.setUint8(44 + i, (value * 127 + 128))
      }

      const blob = new Blob([buffer], { type: 'audio/wav' })
      el.src = URL.createObjectURL(blob)
      this.ringtoneEl = el
      console.log('[RTC] ✓ Fallback ringtone audio element created')
    }

    if (this.ringtoneEl) {
      console.log('[RTC] Attempting to play fallback ringtone...')
      this.ringtoneEl.play().then(() => {
        console.log('[RTC] ✓✓✓ Fallback ringtone IS PLAYING ✓✓✓')
      }).catch((err) => {
        console.error('[RTC] ✗✗✗ Could not play fallback ringtone (browser may require user interaction):', err)
      })
    } else {
      console.error('[RTC] ✗ ringtoneEl is null!')
    }
  }

  // Show browser notification for inbound call
  private showInboundNotification() {
    if (typeof window === 'undefined' || !('Notification' in window)) return

    if (Notification.permission === 'granted') {
      try {
        new Notification('📞 Incoming Call', {
          body: 'You have an incoming call',
          icon: '/favicon.ico',
          tag: 'inbound-call',
          requireInteraction: true
        })
      } catch (e) {
        console.warn('[RTC] Could not show notification:', e)
      }
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission()
    }
  }

  // Stop ringtone
  private stopRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval)
      this.ringtoneInterval = null
    }
    if (this.ringtoneOscillator) {
      try { this.ringtoneOscillator.stop() } catch {}
      this.ringtoneOscillator = null
    }
    if (this.ringtoneGain) {
      this.ringtoneGain = null
    }
    // Also stop fallback ringtone
    if (this.ringtoneEl) {
      try {
        this.ringtoneEl.pause()
        this.ringtoneEl.currentTime = 0
      } catch {}
    }
  }

  // Play ringback tone for outbound calls (US standard: 440Hz + 480Hz, 2s on, 4s off)
  private playRingback() {
    console.log('[RTC] 🔔 playRingback() - Starting outbound ringback tone')
    this.stopRingback() // Stop any existing ringback

    if (typeof document === 'undefined') return

    // Create ringback audio element if not exists
    if (!this.ringbackEl) {
      console.log('[RTC] Creating ringback audio element...')
      const el = document.createElement('audio')
      el.loop = true
      el.volume = 0.6

      // US ringback: two tones (440Hz + 480Hz) for 2 seconds
      const duration = 2.0 // seconds
      const sampleRate = 8000
      const numSamples = Math.floor(duration * sampleRate)
      const buffer = new ArrayBuffer(44 + numSamples)
      const view = new DataView(buffer)

      // WAV header
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i))
        }
      }

      writeString(0, 'RIFF')
      view.setUint32(4, 36 + numSamples, true)
      writeString(8, 'WAVE')
      writeString(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate, true)
      view.setUint16(32, 1, true)
      view.setUint16(34, 8, true)
      writeString(36, 'data')
      view.setUint32(40, numSamples, true)

      // Generate dual-tone ringback (440Hz + 480Hz mixed)
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate
        // Mix 440Hz and 480Hz (US ringback standard)
        const value = (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) / 2
        view.setUint8(44 + i, (value * 100 + 128)) // Lower amplitude for ringback
      }

      const blob = new Blob([buffer], { type: 'audio/wav' })
      el.src = URL.createObjectURL(blob)
      this.ringbackEl = el
    }

    // Play 2s tone, then 4s silence (standard US ringback cadence)
    const playTone = () => {
      if (!this.ringbackEl) return
      this.ringbackEl.currentTime = 0
      this.ringbackEl.play().then(() => {
        console.log('[RTC] 🔊 Ringback tone playing')
      }).catch((err) => {
        console.warn('[RTC] Could not play ringback:', err)
      })

      // Stop after 2 seconds (the tone duration)
      setTimeout(() => {
        if (this.ringbackEl) {
          this.ringbackEl.pause()
        }
      }, 2000)
    }

    // Play immediately
    playTone()

    // Repeat every 6 seconds (2s tone + 4s silence)
    this.ringbackInterval = setInterval(playTone, 6000)
  }

  // Stop ringback tone
  private stopRingback() {
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval)
      this.ringbackInterval = null
    }
    if (this.ringbackEl) {
      try {
        this.ringbackEl.pause()
        this.ringbackEl.currentTime = 0
      } catch {}
    }
  }

  // Ensure audio element exists for remote audio playback
  private ensureAudioElement() {
    if (this.audioEl || typeof document === 'undefined') return

    // First check if there's already an audio element from a previous session
    let el = document.getElementById('telnyx-remote-audio') as HTMLAudioElement
    if (!el) {
      el = document.createElement('audio')
      el.id = 'telnyx-remote-audio'
      document.body.appendChild(el)
    }
    el.autoplay = true
    // @ts-ignore - playsInline exists in browsers
    el.playsInline = true
    // Don't hide the element - some browsers need it visible
    el.style.position = 'fixed'
    el.style.bottom = '0'
    el.style.left = '0'
    el.style.width = '1px'
    el.style.height = '1px'
    el.style.opacity = '0.01'
    el.volume = 1.0
    el.muted = false
    // Add event listeners for debugging
    el.addEventListener('loadedmetadata', () => {
      console.log('[RTC] Audio element: metadata loaded')
    })
    el.addEventListener('canplay', () => {
      console.log('[RTC] Audio element: can play')
    })
    el.addEventListener('playing', () => {
      console.log('[RTC] Audio element: playing')
      // Double-check volume is not muted
      if (this.audioEl) {
        console.log('[RTC] Audio state when playing: volume=', this.audioEl.volume, 'muted=', this.audioEl.muted)
      }
    })
    el.addEventListener('error', (e) => {
      console.error('[RTC] Audio element error:', e)
    })
    el.addEventListener('stalled', () => {
      console.warn('[RTC] Audio element: stalled')
    })
    el.addEventListener('waiting', () => {
      console.log('[RTC] Audio element: waiting for data')
    })
    this.audioEl = el
    console.log('[RTC] ✓ Audio element created and configured')
  }

  // "Unlock" audio for the browser before any async audio operations
  // This must be called from a user gesture (button click) to work
  private async unlockAudio(): Promise<void> {
    console.log('[RTC] 🔓 Unlocking audio context...')

    // 1. Ensure audio element exists
    this.ensureAudioElement()

    // 2. Try to play the audio element (even with no source) to unlock it
    if (this.audioEl) {
      try {
        // Create a tiny silent audio source and play it
        const silentCtx = new AudioContext()
        const oscillator = silentCtx.createOscillator()
        oscillator.frequency.value = 0 // silent
        oscillator.connect(silentCtx.destination)
        oscillator.start(0)
        oscillator.stop(silentCtx.currentTime + 0.001)

        // Also try to resume any suspended AudioContext
        if (silentCtx.state === 'suspended') {
          await silentCtx.resume()
        }

        // Clean up
        setTimeout(() => silentCtx.close(), 100)

        console.log('[RTC] ✓ AudioContext unlocked')
      } catch (e) {
        console.warn('[RTC] Could not unlock AudioContext:', e)
      }

      // 3. Also try calling play() on the audio element to prime it
      try {
        // If there's no source, play() will fail but it "registers" the user gesture
        await this.audioEl.play().catch(() => {
          // Expected to fail with no source, but this registers intent
        })
        this.audioEl.pause() // stop immediately
        console.log('[RTC] ✓ Audio element primed for playback')
      } catch (e) {
        // Ignore - the attempt is what matters
      }
    }
  }

  // Try to attach remote audio from current call or active calls
  private tryAttachRemoteAudio() {
    if (!this.audioEl) {
      console.warn('[RTC] tryAttachRemoteAudio: No audio element')
      return
    }

    // Try current call first
    let remoteStream = this.currentCall?.remoteStream

    // If no current call stream, try inbound call
    if (!remoteStream && this.inboundCall) {
      remoteStream = this.inboundCall.remoteStream
    }

    // If still no stream, try active calls
    if (!remoteStream && this.activeCalls.size > 0) {
      for (const call of this.activeCalls.values()) {
        if (call?.remoteStream) {
          remoteStream = call.remoteStream
          break
        }
      }
    }

    if (!remoteStream) {
      console.log('[RTC] tryAttachRemoteAudio: No remote stream available yet')
      return
    }

    const audioTracks = remoteStream.getAudioTracks()
    console.log('[RTC] tryAttachRemoteAudio: Found remote stream with', audioTracks.length, 'audio tracks')

    if (audioTracks.length === 0) {
      console.warn('[RTC] tryAttachRemoteAudio: Remote stream has no audio tracks')
      return
    }

    // Check if already attached
    // @ts-ignore
    if (this.audioEl.srcObject === remoteStream) {
      console.log('[RTC] tryAttachRemoteAudio: Already attached')
      return
    }

    try {
      // @ts-ignore
      this.audioEl.srcObject = remoteStream
      this.audioEl.volume = 1.0
      this.audioEl.muted = false
      this.audioEl.play().then(() => {
        console.log('[RTC] ✓ tryAttachRemoteAudio: Audio playing')
      }).catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('[RTC] tryAttachRemoteAudio: Play failed:', err)
        }
      })
    } catch (err) {
      console.error('[RTC] tryAttachRemoteAudio: Error:', err)
    }
  }

  // Attach remote audio from a specific call with enhanced debugging and peer connection handling
  private attachRemoteAudioFromCall(call: any) {
    if (!call) {
      console.warn('[RTC] attachRemoteAudioFromCall: No call provided')
      return
    }

    console.log('[RTC] attachRemoteAudioFromCall: Checking call object...')
    console.log('[RTC] Call properties:', Object.keys(call))

    // Try to get the peer connection from the call
    const peer = call.peer || call.peerConnection || call._peerConnection || call.rtcPeerConnection
    if (peer) {
      console.log('[RTC] Found peer connection, checking receivers...')
      try {
        const receivers = peer.getReceivers()
        console.log('[RTC] Peer has', receivers.length, 'receivers')
        receivers.forEach((receiver: RTCRtpReceiver, i: number) => {
          if (receiver.track?.kind === 'audio') {
            console.log(`[RTC] Audio receiver ${i}: track.enabled=${receiver.track.enabled}, track.readyState=${receiver.track.readyState}`)
          }
        })
      } catch (e) {
        console.warn('[RTC] Could not inspect peer receivers:', e)
      }
    }

    // Get remote stream from call
    let remoteStream = call.remoteStream

    // If no remoteStream, try to build one from the peer connection
    if (!remoteStream && peer) {
      try {
        const receivers = peer.getReceivers()
        const audioReceivers = receivers.filter((r: RTCRtpReceiver) => r.track?.kind === 'audio')
        if (audioReceivers.length > 0) {
          remoteStream = new MediaStream()
          audioReceivers.forEach((r: RTCRtpReceiver) => {
            if (r.track) {
              remoteStream.addTrack(r.track)
            }
          })
          console.log('[RTC] Built remote stream from peer receivers with', remoteStream.getAudioTracks().length, 'tracks')
        }
      } catch (e) {
        console.warn('[RTC] Could not build stream from peer:', e)
      }
    }

    if (!remoteStream) {
      console.warn('[RTC] attachRemoteAudioFromCall: No remote stream available')
      return
    }

    const audioTracks = remoteStream.getAudioTracks()
    console.log('[RTC] Remote stream available, attaching...')
    console.log('[RTC] Remote stream ID:', remoteStream.id)
    console.log('[RTC] Remote audio tracks count:', audioTracks.length)

    if (audioTracks.length === 0) {
      console.warn('[RTC] Remote stream has no audio tracks!')
      return
    }

    audioTracks.forEach((track: MediaStreamTrack, i: number) => {
      console.log(`[RTC] Audio track ${i}: id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`)
      // Force enable the track
      if (!track.enabled) {
        console.log('[RTC] Enabling disabled audio track...')
        track.enabled = true
      }
    })

    if (!this.audioEl) {
      console.warn('[RTC] No audio element, creating one...')
      this.ensureAudioElement()
    }

    if (!this.audioEl) {
      console.error('[RTC] Failed to create audio element')
      return
    }

    try {
      // Clear any existing source
      if (this.audioEl.srcObject) {
        console.log('[RTC] Clearing existing srcObject...')
        this.audioEl.pause()
        this.audioEl.srcObject = null
      }

      // Attach the new stream
      console.log('[RTC] Setting srcObject to remote stream...')
      this.audioEl.srcObject = remoteStream
      this.audioEl.volume = 1.0
      this.audioEl.muted = false
      this.audioEl.autoplay = true

      // Try to set audio output device
      if ('setSinkId' in this.audioEl) {
        console.log('[RTC] setSinkId available, setting to default...')
        try {
          (this.audioEl as any).setSinkId('default').then(() => {
            console.log('[RTC] ✓ Audio output set to default device')
          }).catch((e: any) => {
            console.warn('[RTC] Could not set sinkId:', e)
          })
        } catch (e) {
          console.warn('[RTC] setSinkId error:', e)
        }
      }

      // Play the audio
      this.audioEl.play().then(() => {
        console.log('[RTC] ✓ Remote audio playing (from attachRemoteAudioFromCall)')
        console.log('[RTC] Audio element state: paused=', this.audioEl?.paused, 'volume=', this.audioEl?.volume, 'muted=', this.audioEl?.muted)

        // Start monitoring audio levels
        this.startAudioLevelMonitoring(remoteStream)
      }).catch((err) => {
        if (err.name === 'AbortError') {
          console.log('[RTC] Audio play interrupted - this may be okay')
        } else {
          console.error('[RTC] Failed to play remote audio:', err)
        }
      })
    } catch (err) {
      console.error('[RTC] Error setting remote audio:', err)
    }
  }

  // Monitor audio levels to verify audio is actually flowing
  private startAudioLevelMonitoring(stream: MediaStream) {
    // Stop any existing monitoring
    if (this.audioMonitorInterval) {
      clearInterval(this.audioMonitorInterval)
    }

    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let checkCount = 0
      const maxChecks = 10 // Check 10 times over 5 seconds

      this.audioMonitorInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

        if (checkCount < 5) { // Only log first 5
          console.log(`[RTC] Audio level: ${average.toFixed(2)} (should be > 0 if audio is flowing)`)
        }

        checkCount++
        if (checkCount >= maxChecks) {
          clearInterval(this.audioMonitorInterval!)
          this.audioMonitorInterval = null
          ctx.close()
        }
      }, 500)
    } catch (e) {
      console.warn('[RTC] Could not start audio level monitoring:', e)
    }
  }

  async ensureRegistered() {
    if (this.registered && this.client) return

    console.log("[RTC] 🔄 Fetching credentials...")
    const res = await fetch("/api/telnyx/rtc/creds")
    if (!res.ok) throw new Error("RTC credentials missing or unauthorized")
    const { login, password, sipDomain } = await res.json()
    console.log("[RTC] ✓ Got credentials for user:", login, "domain:", sipDomain)

    const sdk = await getSDK()
    const TelnyxRTC: typeof TelnyxRTCType = (sdk.default || sdk.TelnyxRTC || sdk)
    console.log("[RTC] ✓ SDK loaded")

    // Create WebRTC client with full configuration for proper SIP registration
    this.client = new TelnyxRTC({
      login,
      password,
      // Realm is important for proper SIP registration
      // @ts-ignore - realm exists in SDK but might not be in types
      realm: sipDomain || 'sip.telnyx.com',
      // Enable WebSocket keep-alive for persistent connection
      // @ts-ignore
      pingPongInterval: 30,
      // Logging for debugging
      debug: true,
      debugOutput: 'socket',
    })
    console.log("[RTC] ✓ Client created with realm:", sipDomain || 'sip.telnyx.com')

    // Use the proper ensureAudioElement() method which creates a "barely visible"
    // audio element. Hidden elements cause issues in some browsers (Safari, Chrome).
    this.ensureAudioElement()

    // Create ringtone using Web Audio API for inbound calls
    if (!this.ringtoneEl && typeof document !== 'undefined') {
      // Create a synthetic ringtone using Web Audio API
      this.initRingtone()
    }

    // Promise that resolves on ready with timeout
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("WebRTC connection timeout - Telnyx didn't respond within 30s"))
      }, 30000)

      this.client.on("telnyx.ready", () => {
        clearTimeout(timeout)
        console.log("[RTC] ✅ CONNECTED AND REGISTERED - Ready for inbound calls!")
        this.registered = true
        this.emit("ready")
        resolve()
      })
    })

    this.client.on("telnyx.error", (e: any) => {
      console.error("[RTC] ❌ ERROR:", e)
      this.emit("error", e)
    })

    // Log all socket events for debugging
    this.client.on("telnyx.socket.open", () => {
      console.log("[RTC] 🔌 WebSocket OPENED")
    })
    this.client.on("telnyx.socket.close", (e: any) => {
      console.log("[RTC] 🔌 WebSocket CLOSED:", e)
      this.registered = false
    })
    this.client.on("telnyx.socket.error", (e: any) => {
      console.error("[RTC] 🔌 WebSocket ERROR:", e)
    })

    // Handle inbound calls - detect via telnyx_rtc.invite message
    this.client.on("telnyx.socket.message", (msg: any) => {
      console.log("[RTC] socket.message:", msg)

      // telnyx_rtc.invite indicates an INBOUND call
      if (msg?.method === 'telnyx_rtc.invite') {
        const params = msg.params || {}
        const callId = params.callID || params.callId || params.dialogParams?.callID
        const callerNumber = params.callerIdNumber || params.caller_id_number || params.dialogParams?.callerIdNumber
        const callerName = params.callerIdName || params.caller_id_name || params.dialogParams?.callerIdName
        // Destination is the Telnyx number that was called (callee)
        const destinationNumber = params.calleeIdNumber || params.callee_id_number || params.dialogParams?.calleeIdNumber

        console.log("[RTC] 📞 INBOUND INVITE DETECTED!", { callId, callerNumber, callerName, destinationNumber, params })

        // Store as pending inbound - we'll match it with the call object
        this.pendingInboundCallId = callId
        this.pendingInboundInfo = { callerNumber, callerName, destinationNumber }

        // If we already have an inbound call (callUpdate arrived first), emit update with destination number
        if (this.inboundCall && destinationNumber) {
          const inboundCallId = this.inboundCall.callId || this.inboundCall.id
          console.log("[RTC] 📞 Emitting inboundCallUpdate with destinationNumber:", destinationNumber)
          this.emit("inboundCallUpdate", {
            callId: inboundCallId,
            destinationNumber: destinationNumber,
            callerNumber: callerNumber,
            callerName: callerName
          })
        }
      }

      // telnyx_rtc.media or telnyx_rtc.answer indicates media is ready
      // This is a good time to ensure remote audio is attached
      if (msg?.method === 'telnyx_rtc.media' || msg?.method === 'telnyx_rtc.answer') {
        console.log('[RTC] 🔊 Media/Answer received, ensuring remote audio is attached')
        // Give the SDK a moment to process the media
        setTimeout(() => {
          this.tryAttachRemoteAudio()
        }, 200)
      }
    })

    this.client.on("telnyx.notification", (n: any) => {
      const type = n?.type
      const call = n?.call

      // Handle inbound call notification
      if (type === "callUpdate" && call) {
        const state = call.state
        const direction = call.direction
        const callId = call.callId || call.id

        console.log("[RTC] callUpdate:", { state, direction, callId, isInitiatingOutbound: this.isInitiatingOutbound })

        // Check if this is an inbound call:
        // 1. We're NOT currently initiating an outbound call
        // 2. direction === 'inbound' (when explicitly provided by SDK)
        // 3. OR state is 'new'/'ringing' and we didn't initiate it (not in outboundCallIds, no currentCall)
        // IMPORTANT: If isInitiatingOutbound is true, NEVER treat as inbound
        const isInbound = !this.isInitiatingOutbound && (
          direction === 'inbound' ||
          (state === 'ringing' && !this.outboundCallIds.has(callId) && !this.currentCall) ||
          (state === 'new' && !this.outboundCallIds.has(callId) && !this.currentCall)
        )

        if (isInbound && (state === 'new' || state === 'ringing') && !this.inboundCall) {
          // Get caller info from call object or pending invite
          let callerNumber = call.remoteCallerNumber || call.options?.remoteCallerNumber
          let callerName = call.remoteCallerName || call.options?.remoteCallerName
          let destinationNumber = call.localCallerNumber || call.options?.localCallerNumber

          // Try to get from pending invite info
          if (this.pendingInboundInfo) {
            callerNumber = callerNumber || this.pendingInboundInfo.callerNumber
            callerName = callerName || this.pendingInboundInfo.callerName
            destinationNumber = destinationNumber || this.pendingInboundInfo.destinationNumber
          }

          // Also try various places in the call object
          if (!callerNumber && call.options) {
            callerNumber = call.options.callerIdNumber || call.options.remote_caller_id_number
          }

          console.log("[RTC] 📞 INBOUND CALL RINGING!", {
            from: callerNumber,
            to: destinationNumber,
            callId: callId,
            name: callerName,
            powerDialerMode: this.powerDialerMode
          })

          this.inboundCall = call

          // In power dialer mode, auto-answer the call immediately
          if (this.powerDialerMode) {
            console.log("[RTC] 🤖 POWER DIALER MODE: Auto-answering transferred call...")
            this.answerInbound().then(() => {
              console.log("[RTC] ✅ Auto-answered call in power dialer mode")
            }).catch((err: any) => {
              console.error("[RTC] ❌ Failed to auto-answer in power dialer mode:", err)
            })
            // Don't play ringtone in power dialer mode
          } else {
            // Normal mode: Play ringtone using Web Audio API
            this.playRingtone()
          }

          // Emit inbound call event
          this.emit("inboundCall", {
            callId: callId,
            callerNumber: callerNumber || 'Unknown',
            callerName: callerName,
            destinationNumber: destinationNumber,
            call
          } as InboundCallInfo)

          // Clear pending info
          this.pendingInboundCallId = null
          this.pendingInboundInfo = null
        }

        // Call answered (either direction)
        if (state === 'active' || state === 'answering') {
          // Stop ringtone (for inbound) and ringback (for outbound)
          this.stopRingtone()
          this.stopRingback()

          // Ensure remote audio is playing when call becomes active
          console.log('[RTC] Call active, checking remote audio...')
          const remote = call.remoteStream
          if (remote && this.audioEl) {
            console.log('[RTC] Remote stream available in active state, attaching...')

            // Log detailed stream info
            const audioTracks = remote.getAudioTracks()
            console.log('[RTC] 🔊 Audio tracks:', audioTracks.length)
            audioTracks.forEach((track: MediaStreamTrack, i: number) => {
              console.log(`[RTC] Track ${i}:`, {
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                label: track.label,
                id: track.id
              })
            })

            try {
              // @ts-ignore - srcObject exists in browsers
              this.audioEl.srcObject = remote
              this.audioEl.volume = 1.0
              this.audioEl.muted = false
              this.audioEl.play().then(() => {
                console.log('[RTC] ✓ Remote audio playing (from active state)')

                // Start audio level monitoring to verify data is flowing
                this.startAudioLevelMonitoring(remote)
              }).catch((err) => {
                console.error('[RTC] Failed to play remote audio:', err)
              })
            } catch (err) {
              console.error('[RTC] Error setting remote audio:', err)
            }
          } else {
            console.warn('[RTC] Remote stream not available in active state')
            // Try to get stream from peer connection
            if (call.peer || call.peerConnection || call._peerConnection) {
              const pc = call.peer || call.peerConnection || call._peerConnection
              console.log('[RTC] Trying to get stream from peer connection...')
              const receivers = pc.getReceivers ? pc.getReceivers() : []
              console.log('[RTC] Receivers:', receivers.length)
              receivers.forEach((r: RTCRtpReceiver, i: number) => {
                console.log(`[RTC] Receiver ${i}:`, r.track?.kind, r.track?.readyState)
              })
            }
          }
        }

        // Include callId so listeners can filter for their specific call
        this.emit("callUpdate", { state, direction, callId, raw: n })

        // Always try to attach remote stream when available (backup mechanism)
        const remote = call.remoteStream
        if (remote && this.audioEl && !this.audioEl.srcObject) {
          console.log('[RTC] Attaching remote stream (backup mechanism)')
          try {
            // @ts-ignore - srcObject exists in browsers
            this.audioEl.srcObject = remote
            this.audioEl.volume = 1.0
            this.audioEl.muted = false
            this.audioEl.play().catch((err) => {
              // AbortError is expected when a new audio source interrupts the previous one
              if (err.name === 'AbortError') {
                console.log('[RTC] Audio play interrupted by new source - this is expected')
                return
              }
              console.error('[RTC] Backup audio play failed:', err)
            })
          } catch (err) {
            console.error('[RTC] Backup audio setup failed:', err)
          }
        }

        // Detect call end states (hangup, destroy, failed, bye, cancel, rejected)
        const endStates = ['hangup', 'destroy', 'failed', 'bye', 'cancel', 'rejected']
        if (endStates.includes(state)) {
          console.log("[RTC] ☎️ Call ended with state:", state, "callId:", callId)

          // Stop ringtone (inbound) and ringback (outbound)
          this.stopRingtone()
          this.stopRingback()

          // Remove from activeCalls map
          if (callId) {
            this.activeCalls.delete(callId)
          }

          // Clear current call reference (outbound calls)
          const currentCallId = this.currentCall?.callId || this.currentCall?.id
          const isCurrentCall = currentCallId === call.callId || currentCallId === call.id

          // Only clear audio if this ending call is the one currently playing audio
          // AND there are no more active calls - prevents clearing audio from active call when another call ends
          if (this.audioEl && isCurrentCall && this.activeCalls.size === 0) {
            try {
              // @ts-ignore
              this.audioEl.srcObject = null
              console.log('[RTC] Cleared audio srcObject (no more active calls)')
            } catch {}
          }

          if (isCurrentCall) {
            console.log("[RTC] Clearing currentCall reference")
            this.currentCall = null
            // Only clean up local stream if no other active calls
            if (this.activeCalls.size === 0 && this.localStream) {
              try { this.localStream.getTracks().forEach(t => t.stop()) } catch {}
              this.localStream = null
            }
          }

          // Clear inbound call reference
          if (this.inboundCall?.callId === call.callId || this.inboundCall?.id === call.id) {
            this.inboundCall = null
            this.emit("inboundCallEnded", { callId: call.callId || call.id })
          }
        }
      }
    })

    // Connect (constructor creds handle registration; no explicit login() in SDK v2.22.x)
    console.log("[RTC] 🔄 Connecting to Telnyx...")
    try {
      await this.client.connect()
      console.log("[RTC] ✓ connect() completed, waiting for ready event...")
      await readyPromise
      console.log("[RTC] ✅ FULLY REGISTERED - Ready to receive inbound calls")
    } catch (err) {
      console.error("[RTC] ❌ Failed to connect:", err)
      throw err
    }
  }

  async startCall(opts: StartCallOpts) {
    await this.ensureRegistered()
    if (!this.client) throw new Error("RTC client not ready")

    // "Unlock" audio context and audio element BEFORE starting the call
    // This prevents browser autoplay blocking on later async attaches
    await this.unlockAudio()

    // Trigger mic permission explicitly (localhost is allowed without HTTPS)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      console.log('[RTC] ✓ Microphone access granted for outbound call')
      // Log microphone info
      const audioTracks = stream.getAudioTracks()
      console.log('[RTC] Local audio tracks:', audioTracks.length)
      audioTracks.forEach((track, i) => {
        console.log(`[RTC] Local track ${i}: label="${track.label}", enabled=${track.enabled}, muted=${track.muted}`)
      })
    } catch (err) {
      console.error('[RTC] ✗ Microphone access denied:', err)
      throw new Error("Microphone access denied or unavailable")
    }
    // Ensure tracks are enabled
    stream.getAudioTracks().forEach(t => (t.enabled = true))
    this.localStream = stream
    this.emit('localStreamChanged', { source: 'startCall' })

    // Light E.164 normalization for US numbers
    const digits = (opts.toNumber || '').replace(/\D/g, '')
    let destination = opts.toNumber
    if (opts.toNumber && !opts.toNumber.startsWith('+')) {
      if (digits.length === 10) destination = `+1${digits}`
      else if (digits.length === 11 && digits.startsWith('1')) destination = `+${digits}`
    }

    // Generate a temporary ID to track this as outbound BEFORE the call is created
    // This prevents the callUpdate event from triggering inbound call flow
    const tempOutboundId = `outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.outboundCallIds.add(tempOutboundId)

    // Mark that we're initiating an outbound call - prevents false inbound detection
    this.isInitiatingOutbound = true

    const call = await this.client.newCall({
      destinationNumber: destination,
      callerNumber: opts.fromNumber,
      audio: true,
      video: false,
      // Hint the SDK to reuse our granted stream (ignored if unsupported)
      localStream: stream as any,
    })
    // Some SDK builds expose setLocalStream; attach proactively if present
    if ((call as any)?.setLocalStream) {
      try { (call as any).setLocalStream(stream) } catch {}
    }
    this.currentCall = call

    // Start playing ringback tone for outbound call
    this.playRingback()

    // Clear the initiating flag after a short delay
    setTimeout(() => { this.isInitiatingOutbound = false }, 2000)

    // Track this as an outbound call so we don't mistake it for inbound
    const callId = call?.callId || call?.id
    if (callId) {
      this.outboundCallIds.add(callId)
      // Track in activeCalls map for multi-line dialing
      this.activeCalls.set(callId, call)
      // Clean up temp ID and real ID after call ends (30 minutes max)
      setTimeout(() => {
        this.outboundCallIds.delete(callId)
        this.outboundCallIds.delete(tempOutboundId)
        this.activeCalls.delete(callId)
      }, 30 * 60 * 1000)
    }

    // Listen for when the outbound call becomes active and attach audio
    // This is critical - we need to wait for the remote stream to be ready
    // Extended retry window: 0.5s, 1s, 2s, 3s, 5s, 8s, 12s to handle slow media negotiation
    let outboundAttached = false
    const checkAndAttach = async () => {
      if (outboundAttached) return // Already attached, don't re-attach

      const remoteStream = call?.remoteStream
      if (remoteStream && this.audioEl) {
        const tracks = remoteStream.getAudioTracks()
        // Only attach if we have actual audio tracks
        if (tracks.length === 0) {
          console.log('[RTC] Outbound call: Remote stream exists but no audio tracks yet, retrying...')
          return
        }

        outboundAttached = true
        console.log('[RTC] Outbound call: Remote stream ready, attaching audio...')
        console.log('[RTC] Outbound call: Remote audio tracks:', tracks.length)
        tracks.forEach((t: MediaStreamTrack, i: number) => {
          console.log(`[RTC] Outbound track ${i}: enabled=${t.enabled}, muted=${t.muted}, readyState=${t.readyState}`)
          // Force enable track
          if (!t.enabled) {
            t.enabled = true
            console.log(`[RTC] Outbound track ${i}: Force enabled`)
          }
        })

        // @ts-ignore
        this.audioEl.srcObject = remoteStream
        this.audioEl.volume = 1.0
        this.audioEl.muted = false
        try {
          await this.audioEl.play()
          console.log('[RTC] ✓ Outbound call: Remote audio playing')
          // Start monitoring audio levels
          this.startAudioLevelMonitoring(remoteStream)
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.error('[RTC] Outbound call: Failed to play audio:', err)
          }
        }
      }
    }

    // Extended retry schedule: try at multiple intervals up to 12 seconds
    // This handles slow media negotiation and late-arriving remoteStream
    const retryDelays = [500, 1000, 2000, 3000, 5000, 8000, 12000]
    retryDelays.forEach(delay => {
      setTimeout(checkAndAttach, delay)
    })

    return { sessionId: callId || Math.random().toString(36).slice(2) }
  }
  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  async switchMicrophone(deviceId: string): Promise<boolean> {
    try {
      // Acquire a new stream from the requested device
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } as any,
      })
      // Ensure tracks enabled
      newStream.getAudioTracks().forEach((t) => (t.enabled = true))

      // Replace track on the peer connection if possible
      const call: any = this.currentCall
      const pc: RTCPeerConnection | undefined = call?.peerConnection || call?.pc || call?.peer
      const newTrack = newStream.getAudioTracks()[0]
      let replaced = false
      if (pc && typeof pc.getSenders === 'function') {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio')
        if (sender && typeof sender.replaceTrack === 'function' && newTrack) {
          await sender.replaceTrack(newTrack)
          replaced = true
        }
      }
      if (!replaced && call && typeof call.setLocalStream === 'function') {
        try {
          call.setLocalStream(newStream)
          replaced = true
        } catch {}
      }

      // Stop old stream tracks and adopt the new one
      if (this.localStream) {
        try { this.localStream.getTracks().forEach((t) => t.stop()) } catch {}
      }
      this.localStream = newStream
      this.emit('localStreamChanged', { source: 'switchMicrophone' })
      return true
    } catch (e) {
      console.warn('[RTC] switchMicrophone failed', e)
      return false
    }
  }

  async listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    } catch (e) {
      console.warn('[RTC] enumerateDevices failed', e)
      return []
    }
  }

  // Get current call state for UI updates
  getCallState(): { state: string; callId?: string } | null {
    // Check both currentCall and inboundCall (inboundCall becomes currentCall after answering)
    const activeCall = this.currentCall || this.inboundCall
    if (!activeCall) return null
    return {
      state: activeCall.state || 'unknown',
      callId: activeCall.callId || activeCall.id,
    }
  }

  // Check if there's an active call
  hasActiveCall(): boolean {
    // Check both currentCall and inboundCall
    const activeCall = this.currentCall || this.inboundCall
    if (!activeCall) return false
    const state = activeCall.state
    // Also consider 'ringing', 'new', 'answering' as active states
    const endedStates = ['hangup', 'destroy', 'done', 'failed', 'bye']
    return state && !endedStates.includes(state)
  }

  // Check if there's an inbound call ringing
  hasInboundCall(): boolean {
    return !!this.inboundCall
  }

  // Get inbound call info
  getInboundCallInfo(): InboundCallInfo | null {
    if (!this.inboundCall) return null
    return {
      callId: this.inboundCall.callId || this.inboundCall.id,
      callerNumber: this.inboundCall.remoteCallerNumber || this.inboundCall.options?.remoteCallerNumber || 'Unknown',
      callerName: this.inboundCall.remoteCallerName || this.inboundCall.options?.remoteCallerName,
      call: this.inboundCall
    }
  }

  // Answer an inbound call
  async answerInbound(): Promise<{ sessionId: string }> {
    console.log('[RTC] ========== answerInbound() CALLED ==========')

    if (!this.inboundCall) {
      console.error('[RTC] No inbound call to answer!')
      throw new Error("No inbound call to answer")
    }

    // Stop ringtone
    console.log('[RTC] Stopping ringtone...')
    this.stopRingtone()

    // Get microphone access
    console.log('[RTC] Requesting microphone access...')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      console.log('[RTC] ✓ Microphone access granted')
    } catch (err) {
      console.error('[RTC] ✗ Microphone access denied:', err)
      throw new Error("Microphone access denied or unavailable")
    }
    stream.getAudioTracks().forEach(t => (t.enabled = true))
    this.localStream = stream
    this.emit('localStreamChanged', { source: 'answerInbound' })

    console.log('[RTC] Answering inbound call...')

    // Answer the call
    try {
      await this.inboundCall.answer({
        audio: true,
        video: false,
        localStream: stream as any,
      })
      console.log('[RTC] ✓ Call answered successfully')
    } catch (err) {
      console.error('[RTC] Error answering call:', err)
      throw err
    }

    // Move inbound call to current call
    this.currentCall = this.inboundCall
    this.inboundCall = null

    // Also add to activeCalls map so hangup(sessionId) can find it
    const callId = this.currentCall?.callId || this.currentCall?.id
    if (callId && this.currentCall) {
      this.activeCalls.set(callId, this.currentCall)
      console.log('[RTC] Added answered inbound call to activeCalls:', callId)
    }

    // Emit inboundCallEnded so the notification UI can dismiss
    this.emit("inboundCallEnded", { answered: true })

    // CRITICAL: Immediately attach remote audio stream after answering
    // Wait a moment for the stream to be ready
    await new Promise(resolve => setTimeout(resolve, 500))

    const remoteStream = this.currentCall?.remoteStream
    console.log('[RTC] Remote stream after answer:', remoteStream ? 'Available' : 'Not available')

    if (remoteStream && this.audioEl) {
      try {
        console.log('[RTC] Attaching remote audio stream to audio element')
        // @ts-ignore - srcObject exists in browsers
        this.audioEl.srcObject = remoteStream
        this.audioEl.volume = 1.0
        this.audioEl.muted = false

        // Explicitly play the audio
        await this.audioEl.play()
        console.log('[RTC] ✓ Remote audio playing')
      } catch (err: any) {
        // AbortError is expected when a new audio source interrupts the previous one
        if (err.name === 'AbortError') {
          console.log('[RTC] Audio play interrupted by new source - this is expected')
        } else {
          console.error('[RTC] Error setting up remote audio:', err)
          // Try again without await
          try {
            this.audioEl.play().catch(e => {
              if (e.name !== 'AbortError') {
                console.error('[RTC] Audio play failed:', e)
              }
            })
          } catch {}
        }
      }
    } else {
      console.warn('[RTC] Remote stream not available immediately after answer')
      // Set up a listener to catch it when it becomes available
      const checkRemoteStream = () => {
        const stream = this.currentCall?.remoteStream
        if (stream && this.audioEl) {
          console.log('[RTC] Remote stream now available, attaching...')
          try {
            // @ts-ignore
            this.audioEl.srcObject = stream
            this.audioEl.volume = 1.0
            this.audioEl.muted = false
            this.audioEl.play().catch(e => {
              if (e.name !== 'AbortError') {
                console.error('[RTC] Delayed audio play failed:', e)
              }
            })
          } catch (err) {
            console.error('[RTC] Error in delayed audio setup:', err)
          }
        }
      }

      // Check periodically for up to 3 seconds
      let attempts = 0
      const interval = setInterval(() => {
        attempts++
        checkRemoteStream()
        if (attempts >= 6 || (this.currentCall?.remoteStream && this.audioEl?.srcObject)) {
          clearInterval(interval)
        }
      }, 500)
    }

    return { sessionId: this.currentCall?.callId || this.currentCall?.id || Math.random().toString(36).slice(2) }
  }

  // Decline/reject an inbound call
  async declineInbound(): Promise<void> {
    if (!this.inboundCall) return

    // Stop ringtone
    if (this.ringtoneEl) {
      this.ringtoneEl.pause()
      this.ringtoneEl.currentTime = 0
    }

    try {
      await this.inboundCall.hangup()
    } catch (err) {
      console.warn('[RTC] Error declining call:', err)
    }

    this.inboundCall = null
    this.emit("inboundCallEnded", { declined: true })
  }

  /**
   * Hangup a call
   * @param sessionId - Optional specific call to hangup. If not provided, hangs up current/inbound call.
   */
  async hangup(sessionId?: string) {
    // Stop ringtone if playing
    if (this.ringtoneEl) {
      this.ringtoneEl.pause()
      this.ringtoneEl.currentTime = 0
    }

    try {
      // If sessionId provided, hangup that specific call
      if (sessionId) {
        const call = this.activeCalls.get(sessionId)
        if (call) {
          console.log(`[RTC] Hanging up specific call: ${sessionId}`)
          try {
            await call.hangup()
          } catch (err: any) {
            if (!String(err?.message || "").includes("CALL DOES NOT EXIST")) {
              console.warn("[RTC] hangup error for", sessionId, err)
            }
          }
          this.activeCalls.delete(sessionId)
          // If this was the current call, clear it
          const currentCallId = this.currentCall?.callId || this.currentCall?.id
          if (currentCallId === sessionId) {
            this.currentCall = null
          }
          return
        }
      }

      // Hangup current call
      if (this.currentCall) {
        try {
          await this.currentCall.hangup()
        } catch (err: any) {
          // Suppress SDK error when call already ended
          if (!String(err?.message || "").includes("CALL DOES NOT EXIST")) {
            console.warn("[RTC] hangup error", err)
          }
        }
      }

      // Also hangup inbound call if exists
      if (this.inboundCall) {
        try {
          await this.inboundCall.hangup()
        } catch {}
        this.inboundCall = null
      }
    } finally {
      if (!sessionId) {
        // Only clear current call if no specific sessionId was provided
        this.currentCall = null
        if (this.localStream) {
          try { this.localStream.getTracks().forEach(t => t.stop()) } catch {}
          this.localStream = null
        }
      }
    }
  }

  // Check if the client is registered and ready
  isReady(): boolean {
    return this.registered && !!this.client
  }

  // Get a specific call by sessionId from activeCalls map
  getCallById(callId: string): any | null {
    return this.activeCalls.get(callId) || null
  }

  // Get all active calls
  getAllActiveCalls(): Map<string, any> {
    return new Map(this.activeCalls)
  }

  // Manually ensure remote audio is playing (useful for troubleshooting)
  ensureRemoteAudioPlaying(): boolean {
    if (!this.currentCall) {
      console.warn('[RTC] No active call to ensure audio for')
      return false
    }

    const remoteStream = this.currentCall.remoteStream
    if (!remoteStream) {
      console.warn('[RTC] No remote stream available')
      return false
    }

    if (!this.audioEl) {
      console.error('[RTC] Audio element not initialized')
      return false
    }

    try {
      console.log('[RTC] Manually ensuring remote audio is playing...')
      // @ts-ignore
      this.audioEl.srcObject = remoteStream
      this.audioEl.volume = 1.0
      this.audioEl.muted = false
      this.audioEl.play().then(() => {
        console.log('[RTC] ✓ Remote audio manually started')
      }).catch((err) => {
        // AbortError is expected when a new audio source interrupts the previous one
        if (err.name === 'AbortError') {
          console.log('[RTC] Audio play interrupted by new source - this is expected')
          return
        }
        console.error('[RTC] Failed to manually start audio:', err)
      })
      return true
    } catch (err) {
      console.error('[RTC] Error in ensureRemoteAudioPlaying:', err)
      return false
    }
  }

  // Switch audio to a specific call by ID
  switchAudioToCall(callId: string): boolean {
    const call = this.activeCalls.get(callId)
    if (!call) {
      console.warn('[RTC] Cannot switch audio - call not found:', callId)
      return false
    }

    const remoteStream = call.remoteStream
    if (!remoteStream) {
      console.warn('[RTC] Cannot switch audio - no remote stream for call:', callId)
      return false
    }

    if (!this.audioEl) {
      console.error('[RTC] Audio element not initialized')
      return false
    }

    try {
      console.log('[RTC] Switching audio to call:', callId)
      // Update currentCall reference to this call
      this.currentCall = call
      // @ts-ignore
      this.audioEl.srcObject = remoteStream
      this.audioEl.volume = 1.0
      this.audioEl.muted = false
      this.audioEl.play().then(() => {
        console.log('[RTC] ✓ Audio switched to call:', callId)
      }).catch((err) => {
        if (err.name === 'AbortError') {
          console.log('[RTC] Audio play interrupted by new source - this is expected')
          return
        }
        console.error('[RTC] Failed to switch audio:', err)
      })
      return true
    } catch (err) {
      console.error('[RTC] Error switching audio to call:', err)
      return false
    }
  }
  // Diagnostic function to help debug audio issues
  diagnoseAudio(): void {
    console.log('=== [RTC] AUDIO DIAGNOSTICS ===')
    console.log('[RTC] Audio element exists:', !!this.audioEl)
    if (this.audioEl) {
      console.log('[RTC] Audio element properties:')
      console.log('  - paused:', this.audioEl.paused)
      console.log('  - volume:', this.audioEl.volume)
      console.log('  - muted:', this.audioEl.muted)
      console.log('  - currentTime:', this.audioEl.currentTime)
      console.log('  - readyState:', this.audioEl.readyState)
      console.log('  - networkState:', this.audioEl.networkState)
      console.log('  - srcObject:', this.audioEl.srcObject ? 'set' : 'null')
      if ('sinkId' in this.audioEl) {
        console.log('  - sinkId:', (this.audioEl as any).sinkId || 'default')
      }

      const srcObj = this.audioEl.srcObject as MediaStream
      if (srcObj) {
        const tracks = srcObj.getAudioTracks()
        console.log('[RTC] Remote stream audio tracks:', tracks.length)
        tracks.forEach((track, i) => {
          console.log(`  Track ${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`)
          const settings = track.getSettings()
          console.log(`  Track ${i} settings:`, JSON.stringify(settings))
        })

        // Measure audio level using Web Audio API
        this.measureAudioLevel(srcObj)
      }
    }

    console.log('[RTC] Current call exists:', !!this.currentCall)
    if (this.currentCall) {
      console.log('[RTC] Current call remoteStream:', !!this.currentCall.remoteStream)
      console.log('[RTC] Current call peer connection:', !!this.currentCall.peer)
      if (this.currentCall.remoteStream) {
        const tracks = this.currentCall.remoteStream.getAudioTracks()
        console.log('[RTC] Current call audio tracks:', tracks.length)
        tracks.forEach((track: MediaStreamTrack, i: number) => {
          console.log(`  Call Track ${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`)
        })
      }
      // Check peer connection stats
      if (this.currentCall.peer) {
        this.logPeerConnectionStats(this.currentCall.peer)
      }
    }

    console.log('[RTC] Active calls count:', this.activeCalls.size)
    this.activeCalls.forEach((call, id) => {
      console.log(`[RTC] Call ${id}: remoteStream=${!!call.remoteStream}`)
    })

    console.log('[RTC] Local stream exists:', !!this.localStream)
    if (this.localStream) {
      const tracks = this.localStream.getAudioTracks()
      console.log('[RTC] Local stream audio tracks:', tracks.length)
      tracks.forEach((track, i) => {
        console.log(`  Local Track ${i}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`)
      })
    }

    // List available audio output devices
    this.listAudioDevices()

    console.log('=== [RTC] END DIAGNOSTICS ===')
  }

  // Measure audio level using Web Audio API
  private measureAudioLevel(stream: MediaStream): void {
    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      // Take a few samples
      let sampleCount = 0
      const maxSamples = 5
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        console.log(`[RTC] Audio level sample ${sampleCount + 1}: ${average.toFixed(2)} (0-255 scale)`)
        sampleCount++
        if (sampleCount < maxSamples) {
          setTimeout(checkLevel, 200)
        } else {
          ctx.close()
          console.log('[RTC] Audio level check complete. If levels are 0, no audio data is flowing.')
        }
      }
      checkLevel()
    } catch (e) {
      console.error('[RTC] Could not measure audio level:', e)
    }
  }

  // Log peer connection stats
  private async logPeerConnectionStats(peer: RTCPeerConnection): Promise<void> {
    try {
      const stats = await peer.getStats()
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          console.log('[RTC] Inbound audio RTP stats:', {
            packetsReceived: report.packetsReceived,
            bytesReceived: report.bytesReceived,
            packetsLost: report.packetsLost,
            jitter: report.jitter,
          })
        }
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          console.log('[RTC] Outbound audio RTP stats:', {
            packetsSent: report.packetsSent,
            bytesSent: report.bytesSent,
          })
        }
      })
    } catch (e) {
      console.error('[RTC] Could not get peer stats:', e)
    }
  }

  // List available audio output devices
  private async listAudioDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput')
      console.log('[RTC] Available audio output devices:')
      audioOutputs.forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.label || 'Unknown'} (${d.deviceId})`)
      })
    } catch (e) {
      console.error('[RTC] Could not enumerate devices:', e)
    }
  }

  // Force refresh audio element with current call's remote stream
  forceRefreshAudio(): boolean {
    console.log('[RTC] Force refreshing audio...')

    if (!this.audioEl) {
      console.error('[RTC] No audio element to refresh')
      return false
    }

    // Try current call first
    let remoteStream = this.currentCall?.remoteStream

    // If no current call stream, try to get from active calls
    if (!remoteStream && this.activeCalls.size > 0) {
      const firstCall = this.activeCalls.values().next().value
      remoteStream = firstCall?.remoteStream
      console.log('[RTC] Using stream from active call')
    }

    if (!remoteStream) {
      console.error('[RTC] No remote stream available to refresh')
      return false
    }

    try {
      // Completely reset the audio element
      this.audioEl.srcObject = null
      this.audioEl.load()

      // Re-attach after a brief delay
      setTimeout(() => {
        if (this.audioEl && remoteStream) {
          // @ts-ignore
          this.audioEl.srcObject = remoteStream
          this.audioEl.volume = 1.0
          this.audioEl.muted = false
          this.audioEl.play().then(() => {
            console.log('[RTC] ✓ Audio force refreshed successfully')
            this.diagnoseAudio()
          }).catch(err => {
            console.error('[RTC] Force refresh play failed:', err)
          })
        }
      }, 100)

      return true
    } catch (err) {
      console.error('[RTC] Force refresh failed:', err)
      return false
    }
  }

  // Play a test tone to verify audio output is working
  async playTestTone(): Promise<void> {
    console.log('[RTC] Playing test tone...')
    try {
      const ctx = new AudioContext()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      oscillator.frequency.value = 440 // A4 note
      gainNode.gain.value = 0.3

      oscillator.start()

      setTimeout(() => {
        oscillator.stop()
        ctx.close()
        console.log('[RTC] Test tone finished. If you heard it, your audio output is working.')
      }, 1000)
    } catch (e) {
      console.error('[RTC] Could not play test tone:', e)
    }
  }

  // Set audio output device
  async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    if (!this.audioEl) {
      console.error('[RTC] No audio element')
      return false
    }

    if (!('setSinkId' in this.audioEl)) {
      console.error('[RTC] setSinkId not supported in this browser')
      return false
    }

    try {
      await (this.audioEl as any).setSinkId(deviceId)
      console.log('[RTC] ✓ Audio output device set to:', deviceId)
      return true
    } catch (e) {
      console.error('[RTC] Could not set audio output device:', e)
      return false
    }
  }

  // Try all available audio output devices
  async tryAllAudioDevices(): Promise<void> {
    console.log('[RTC] Trying all audio output devices...')
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput')

      for (const device of audioOutputs) {
        console.log(`[RTC] Trying device: ${device.label || device.deviceId}`)
        const success = await this.setAudioOutputDevice(device.deviceId)
        if (success) {
          // Play test tone on this device
          await this.playTestTone()
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
      }
    } catch (e) {
      console.error('[RTC] Error trying audio devices:', e)
    }
  }
}

export const rtcClient = new TelnyxWebRTCClient()

// Expose rtcClient globally for debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).rtcClient = rtcClient
  console.log('[RTC] rtcClient exposed on window. Use window.rtcClient.diagnoseAudio() to debug audio issues.')
}
