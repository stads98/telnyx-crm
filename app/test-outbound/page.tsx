'use client'

import { useState, useEffect } from 'react'
import { simpleOutbound } from '@/lib/webrtc/simple-outbound'

export default function TestOutboundPage() {
  const [status, setStatus] = useState('Not connected')
  const [toNumber, setToNumber] = useState('')
  const [fromNumber, setFromNumber] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isOnCall, setIsOnCall] = useState(false)
  const [credentials, setCredentials] = useState<{ login: string; password: string } | null>(null)

  // Fetch credentials on mount
  useEffect(() => {
    fetch('/api/webrtc-credentials')
      .then(res => res.json())
      .then(data => {
        if (data.login && data.password) {
          setCredentials({ login: data.login, password: data.password })
          setFromNumber(data.phoneNumber || '')
          setStatus('Credentials loaded - click Connect')
        } else {
          setStatus('Error: No credentials')
        }
      })
      .catch(err => {
        setStatus('Error fetching credentials: ' + err.message)
      })
  }, [])

  const handleConnect = async () => {
    if (!credentials) return
    setStatus('Connecting...')
    try {
      await simpleOutbound.connect(credentials.login, credentials.password)
      setIsConnected(true)
      setStatus('✅ Connected and ready!')
    } catch (err: any) {
      setStatus('Error: ' + err.message)
    }
  }

  const handleCall = async () => {
    if (!toNumber) {
      setStatus('Enter a phone number')
      return
    }
    setStatus('Calling...')
    try {
      await simpleOutbound.call(toNumber, fromNumber)
      setIsOnCall(true)
      setStatus('📞 Calling... check console for state updates')
    } catch (err: any) {
      setStatus('Call error: ' + err.message)
    }
  }

  const handleHangup = () => {
    simpleOutbound.hangup()
    setIsOnCall(false)
    setStatus('Call ended')
  }

  const handleDisconnect = () => {
    simpleOutbound.disconnect()
    setIsConnected(false)
    setIsOnCall(false)
    setStatus('Disconnected')
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Simple Outbound Test</h1>
      
      <div className="mb-4 p-3 bg-gray-100 rounded">
        <strong>Status:</strong> {status}
      </div>

      {!isConnected ? (
        <button
          onClick={handleConnect}
          disabled={!credentials}
          className="w-full bg-blue-500 text-white p-3 rounded mb-4 disabled:bg-gray-300"
        >
          Connect to Telnyx
        </button>
      ) : (
        <>
          <div className="mb-4">
            <label className="block mb-1">From Number:</label>
            <input
              type="text"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              className="w-full border p-2 rounded"
              placeholder="+1234567890"
            />
          </div>

          <div className="mb-4">
            <label className="block mb-1">To Number:</label>
            <input
              type="text"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              className="w-full border p-2 rounded"
              placeholder="+1234567890"
            />
          </div>

          {!isOnCall ? (
            <button
              onClick={handleCall}
              className="w-full bg-green-500 text-white p-3 rounded mb-4"
            >
              📞 Call
            </button>
          ) : (
            <button
              onClick={handleHangup}
              className="w-full bg-red-500 text-white p-3 rounded mb-4"
            >
              🔴 Hang Up
            </button>
          )}

          <button
            onClick={handleDisconnect}
            className="w-full bg-gray-500 text-white p-3 rounded"
          >
            Disconnect
          </button>
        </>
      )}

      <div className="mt-6 text-sm text-gray-600">
        <p>Open browser console to see detailed logs.</p>
        <p className="mt-2">This is a minimal test using only Telnyx SDK basics.</p>
      </div>
    </div>
  )
}

