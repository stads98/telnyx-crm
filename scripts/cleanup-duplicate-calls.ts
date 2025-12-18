/**
 * Cleanup script to remove duplicate call records from TelnyxCall table
 * 
 * This script identifies and removes duplicate calls that were created when:
 * 1. Frontend created a call record via /api/telnyx/webrtc-calls
 * 2. Webhook handler created another record for the same call
 * 
 * Strategy:
 * - Group calls by fromNumber, toNumber, direction, and createdAt (within 30 seconds)
 * - Keep the most complete record (has telnyxCallId, duration, recordingUrl, etc.)
 * - Delete the less complete duplicates
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface CallGroup {
  key: string
  calls: any[]
}

async function cleanupDuplicateCalls() {
  console.log('🔍 Starting duplicate call cleanup...\n')

  try {
    // Fetch all calls ordered by creation time
    const allCalls = await prisma.telnyxCall.findMany({
      orderBy: { createdAt: 'desc' }
    })

    console.log(`📊 Total calls in database: ${allCalls.length}`)

    // Group calls that might be duplicates
    const potentialDuplicates = new Map<string, any[]>()

    for (const call of allCalls) {
      // Create a key based on phone numbers and direction
      const key = `${call.fromNumber}|${call.toNumber}|${call.direction}`
      
      if (!potentialDuplicates.has(key)) {
        potentialDuplicates.set(key, [])
      }
      
      potentialDuplicates.get(key)!.push(call)
    }

    console.log(`📋 Found ${potentialDuplicates.size} unique call patterns\n`)

    let duplicatesFound = 0
    let duplicatesRemoved = 0

    // Process each group to find duplicates
    for (const [key, calls] of potentialDuplicates.entries()) {
      if (calls.length < 2) continue

      // Sort by creation time
      calls.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      // Check for calls within 30 seconds of each other
      for (let i = 0; i < calls.length - 1; i++) {
        const call1 = calls[i]
        const call2 = calls[i + 1]

        const timeDiff = Math.abs(
          new Date(call2.createdAt).getTime() - new Date(call1.createdAt).getTime()
        )

        // If calls are within 30 seconds, they're likely duplicates
        if (timeDiff <= 30000) {
          duplicatesFound++

          // Determine which call to keep (the more complete one)
          const call1Score = getCompletenessScore(call1)
          const call2Score = getCompletenessScore(call2)

          const keepCall = call1Score >= call2Score ? call1 : call2
          const deleteCall = call1Score >= call2Score ? call2 : call1

          console.log(`🔄 Found duplicate:`)
          console.log(`   Keep:   ${keepCall.id} (score: ${call1Score >= call2Score ? call1Score : call2Score})`)
          console.log(`           Created: ${keepCall.createdAt}`)
          console.log(`           Status: ${keepCall.status}, Duration: ${keepCall.duration || 0}s`)
          console.log(`           TelnyxCallId: ${keepCall.telnyxCallId || 'none'}`)
          console.log(`           Recording: ${keepCall.recordingUrl ? 'yes' : 'no'}`)
          console.log(`   Delete: ${deleteCall.id} (score: ${call1Score >= call2Score ? call2Score : call1Score})`)
          console.log(`           Created: ${deleteCall.createdAt}`)
          console.log(`           Status: ${deleteCall.status}, Duration: ${deleteCall.duration || 0}s`)
          console.log(`           TelnyxCallId: ${deleteCall.telnyxCallId || 'none'}`)
          console.log(`           Recording: ${deleteCall.recordingUrl ? 'yes' : 'no'}`)

          // Delete the less complete call
          await prisma.telnyxCall.delete({
            where: { id: deleteCall.id }
          })

          duplicatesRemoved++
          console.log(`   ✅ Deleted duplicate call ${deleteCall.id}\n`)

          // Remove the deleted call from the array to avoid processing it again
          calls.splice(calls.indexOf(deleteCall), 1)
          i-- // Adjust index since we removed an element
        }
      }
    }

    console.log('\n📈 Cleanup Summary:')
    console.log(`   Total calls processed: ${allCalls.length}`)
    console.log(`   Duplicates found: ${duplicatesFound}`)
    console.log(`   Duplicates removed: ${duplicatesRemoved}`)
    console.log(`   Remaining calls: ${allCalls.length - duplicatesRemoved}`)

  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Calculate a completeness score for a call record
 * Higher score = more complete record = should be kept
 */
function getCompletenessScore(call: any): number {
  let score = 0

  if (call.telnyxCallId) score += 10
  if (call.telnyxSessionId) score += 5
  if (call.duration && call.duration > 0) score += 8
  if (call.recordingUrl) score += 7
  if (call.answeredAt) score += 5
  if (call.endedAt) score += 3
  if (call.contactId) score += 4
  if (call.status === 'hangup' || call.status === 'completed') score += 6
  if (call.webhookData) score += 2
  if (call.cost) score += 1

  return score
}

// Run the cleanup
cleanupDuplicateCalls()
  .then(() => {
    console.log('\n✅ Cleanup completed successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Cleanup failed:', error)
    process.exit(1)
  })

