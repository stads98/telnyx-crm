import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { contactIds } = await request.json()

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json(
        { error: 'contactIds array is required' },
        { status: 400 }
      )
    }

    // Delete all messages for the specified contacts
    // First verify the contacts exist
    const contacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
      },
      select: { id: true, phone1: true, phone2: true, phone3: true },
    })

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: 'No valid contacts found' },
        { status: 404 }
      )
    }

    // Get all phone numbers from these contacts
    const phoneNumbers: string[] = []
    contacts.forEach(contact => {
      if (contact.phone1) phoneNumbers.push(contact.phone1)
      if (contact.phone2) phoneNumbers.push(contact.phone2)
      if (contact.phone3) phoneNumbers.push(contact.phone3)
    })

    // Delete TelnyxMessages for these contacts
    const deleteResult = await prisma.telnyxMessage.deleteMany({
      where: {
        OR: [
          { fromNumber: { in: phoneNumbers } },
          { toNumber: { in: phoneNumbers } },
        ],
      },
    })

    // Also delete from Message table if it exists
    try {
      await prisma.message.deleteMany({
        where: {
          contact_id: { in: contactIds },
        },
      })
    } catch (e) {
      // Message table might not exist or have different structure
      console.log('Note: Could not delete from Message table:', e)
    }

    return NextResponse.json({
      success: true,
      count: contacts.length,
      messagesDeleted: deleteResult.count,
    })
  } catch (error) {
    console.error('Error bulk deleting conversations:', error)
    return NextResponse.json(
      { error: 'Failed to delete conversations' },
      { status: 500 }
    )
  }
}

