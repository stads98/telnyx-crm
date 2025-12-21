import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { formatPhoneNumberForTelnyx, last10Digits } from '@/lib/phone-utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const contactId = searchParams.get('contactId')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // If no contactId, return all calls (for call history page)
    if (!contactId) {
      return getAllCalls(session.user, search, limit, offset)
    }

    // Build the query based on user role
    let whereClause: any = { id: contactId }

    // If user is a team member, only allow access to assigned contacts
    if (session.user.role === 'TEAM_USER') {
      whereClause = {
        id: contactId,
        assignedUsers: {
          some: {
            userId: session.user.id
          }
        }
      }
    }

    // Get contact to find phone numbers
    const contact = await prisma.contact.findUnique({
      where: whereClause,
      select: {
        id: true,
        phone1: true,
        phone2: true,
        phone3: true,
      }
    })

    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 404 }
      )
    }

    // Normalize phone numbers to E.164 format for consistent matching
    const rawPhones = [contact.phone1, contact.phone2, contact.phone3].filter((p): p is string => Boolean(p))
    const phoneNumbers = rawPhones
      .map(p => formatPhoneNumberForTelnyx(p))
      .filter((p): p is string => Boolean(p))

    // Also include raw phone numbers for backward compatibility with older records
    const allPhoneVariants = [...new Set([...phoneNumbers, ...rawPhones])]

    // Get calls for this contact from TelnyxCall table
    const calls = await prisma.telnyxCall.findMany({
      where: {
        OR: [
          // Calls linked directly to contact
          { contactId: contactId },
          // Outbound calls to contact's phone numbers
          {
            AND: [
              { direction: 'outbound' },
              { toNumber: { in: allPhoneVariants } }
            ]
          },
          // Inbound calls from contact's phone numbers
          {
            AND: [
              { direction: 'inbound' },
              { fromNumber: { in: allPhoneVariants } }
            ]
          }
        ]
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        direction: true,
        status: true,
        duration: true,
        fromNumber: true,
        toNumber: true,
        createdAt: true,
        answeredAt: true,
        endedAt: true,
        hangupCause: true,
        recordingUrl: true,
      }
    })

    // Transform to match timeline format
    const transformedCalls = calls.map(call => ({
      id: call.id,
      direction: call.direction,
      status: call.status,
      duration: call.duration,
      timestamp: call.createdAt,
      createdAt: call.createdAt,
      startTime: call.answeredAt || call.createdAt,
      notes: call.hangupCause ? `Call ended: ${call.hangupCause}` : null,
      fromNumber: call.fromNumber,
      toNumber: call.toNumber,
      recordingUrl: call.recordingUrl,
    }))

    return NextResponse.json(transformedCalls)
  } catch (error) {
    console.error('Error fetching calls:', error)
    return NextResponse.json(
      { error: 'Failed to fetch calls' },
      { status: 500 }
    )
  }
}

// Get all calls for call history page
async function getAllCalls(user: any, search: string | null, limit: number, offset: number) {
  try {
    // Build where clause for search
    const whereClause: any = {}

    if (search) {
      whereClause.OR = [
        { fromNumber: { contains: search } },
        { toNumber: { contains: search } },
      ]
    }

    // Get calls
    const calls = await prisma.telnyxCall.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    })

    // Get total count for pagination
    const total = await prisma.telnyxCall.count({ where: whereClause })

    // Get contact info for calls that have contactId
    const contactIds = calls.map(c => c.contactId).filter(Boolean) as string[]
    const contacts = contactIds.length > 0
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, firstName: true, lastName: true, phone1: true, phone2: true, phone3: true }
        })
      : []
    const contactMap = new Map(contacts.map(c => [c.id, c]))

    // For calls without contactId, try to find contact by phone number
    const callsWithoutContact = calls.filter(c => !c.contactId)
    const phoneNumbersToLookup = callsWithoutContact.flatMap(call => {
      const phones = [call.fromNumber, call.toNumber].filter(Boolean)
      // Also include last 10 digits for matching
      return [...phones, ...phones.map(p => last10Digits(p)).filter(d => d.length === 10)]
    })

    // Build phone lookup map
    const phoneContactMap = new Map<string, typeof contacts[0]>()
    if (phoneNumbersToLookup.length > 0) {
      const contactsByPhone = await prisma.contact.findMany({
        where: {
          OR: [
            { phone1: { in: phoneNumbersToLookup } },
            { phone2: { in: phoneNumbersToLookup } },
            { phone3: { in: phoneNumbersToLookup } },
          ],
          deletedAt: null,
        },
        select: { id: true, firstName: true, lastName: true, phone1: true, phone2: true, phone3: true },
        take: 100, // Limit to prevent huge queries
      })

      // Map each phone number to its contact
      for (const contact of contactsByPhone) {
        const phones = [contact.phone1, contact.phone2, contact.phone3].filter(Boolean) as string[]
        for (const phone of phones) {
          phoneContactMap.set(phone, contact)
          phoneContactMap.set(last10Digits(phone), contact)
        }
      }
    }

    // Transform calls
    const transformedCalls = calls.map(call => {
      // First try to get contact by contactId
      let contact = call.contactId ? contactMap.get(call.contactId) : null

      // If no contact found by ID, try to match by phone number
      if (!contact) {
        const phoneToMatch = call.direction === 'outbound' ? call.toNumber : call.fromNumber
        if (phoneToMatch) {
          contact = phoneContactMap.get(phoneToMatch) || phoneContactMap.get(last10Digits(phoneToMatch)) || null
        }
      }

      return {
        id: call.id,
        direction: call.direction,
        status: call.status,
        duration: call.duration || 0,
        timestamp: call.createdAt,
        createdAt: call.createdAt,
        startTime: call.answeredAt || call.createdAt,
        notes: call.hangupCause ? `Call ended: ${call.hangupCause}` : null,
        fromNumber: call.fromNumber,
        toNumber: call.toNumber,
        recordingUrl: call.recordingUrl,
        contactId: call.contactId || contact?.id || null,
        contact: contact ? {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone1: contact.phone1,
        } : null,
      }
    })

    return NextResponse.json({
      calls: transformedCalls,
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Error fetching all calls:', error)
    return NextResponse.json(
      { error: 'Failed to fetch calls' },
      { status: 500 }
    )
  }
}
