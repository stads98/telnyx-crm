import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '50')
    const status = searchParams.get('status')
    const checkActive = searchParams.get('checkActive') === 'true'

    // Get the admin ID (for team users, get their admin's ID)
    const adminId = session.user.adminId || session.user.id

    // If checking for active campaigns only
    if (checkActive) {
      const activeCampaign = await prisma.textCampaign.findFirst({
        where: {
          userId: adminId,
          status: { in: ['RUNNING', 'PAUSED', 'ROUND_COMPLETE'] }
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              queueItems: true,
              messages: true,
            }
          }
        }
      })
      return NextResponse.json({
        hasActive: !!activeCampaign,
        activeCampaign
      })
    }

    const where: any = { userId: adminId }
    if (status) {
      where.status = status
    }

    const campaigns = await prisma.textCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            queueItems: true,
            messages: true,
          }
        }
      },
    })

    // Calculate progress for each campaign
    const campaignsWithProgress = campaigns.map(campaign => ({
      ...campaign,
      progress: campaign.totalContacts > 0
        ? Math.round((campaign.sentCount + campaign.failedCount) / campaign.totalContacts * 100)
        : 0,
    }))

    return NextResponse.json({ campaigns: campaignsWithProgress })
  } catch (error) {
    console.error('Error fetching text campaigns:', error)
    return NextResponse.json(
      { error: 'Failed to fetch text campaigns' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      name,
      description,
      templates, // Array: [{ round: 1, content: "message" }, ...]
      includeTagIds,
      excludeTagIds,
      selectedNumbers,
      delaySeconds,
      contactIds, // Pre-selected contact IDs
    } = body

    if (!templates?.length || !selectedNumbers?.length) {
      return NextResponse.json(
        { error: 'Missing required fields: templates and selectedNumbers are required' },
        { status: 400 }
      )
    }

    const adminId = session.user.adminId || session.user.id

    // Build query to get contacts based on tags or direct selection
    let contactQuery: any = {
      deletedAt: null,
      dnc: { not: true },
    }

    if (contactIds?.length) {
      contactQuery.id = { in: contactIds }
    } else if (includeTagIds?.length) {
      contactQuery.tags = {
        some: {
          tagId: { in: includeTagIds }
        }
      }
      if (excludeTagIds?.length) {
        contactQuery.NOT = {
          tags: {
            some: {
              tagId: { in: excludeTagIds }
            }
          }
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Either contactIds or includeTagIds must be provided' },
        { status: 400 }
      )
    }

    // Get matching contacts
    const contacts = await prisma.contact.findMany({
      where: contactQuery,
      select: { id: true, phone1: true, phone2: true, phone3: true },
    })

    // Filter contacts that have at least one phone number
    const validContacts = contacts.filter(c => c.phone1 || c.phone2 || c.phone3)

    if (validContacts.length === 0) {
      return NextResponse.json(
        { error: 'No contacts with valid phone numbers found' },
        { status: 400 }
      )
    }

    // Create campaign with queue items in a transaction
    const campaign = await prisma.$transaction(async (tx) => {
      // Create the campaign
      const newCampaign = await tx.textCampaign.create({
        data: {
          userId: adminId,
          name: name || `Text Campaign ${new Date().toLocaleString()}`,
          description,
          templates: JSON.stringify(templates),
          includeTagIds: includeTagIds || [],
          excludeTagIds: excludeTagIds || [],
          selectedNumbers,
          delaySeconds: delaySeconds || 2,
          maxRounds: templates.length,
          totalContacts: validContacts.length,
          status: 'IDLE',
        },
      })

      // Assign phone numbers to contacts (round-robin)
      const phoneAssignments: Record<string, string> = {}
      validContacts.forEach((contact, idx) => {
        phoneAssignments[contact.id] = selectedNumbers[idx % selectedNumbers.length]
      })

      // Update campaign with phone assignments
      await tx.textCampaign.update({
        where: { id: newCampaign.id },
        data: { phoneAssignments: JSON.stringify(phoneAssignments) },
      })

      // Create queue items for each contact
      await tx.textCampaignQueue.createMany({
        data: validContacts.map((contact, idx) => ({
          campaignId: newCampaign.id,
          contactId: contact.id,
          assignedNumber: selectedNumbers[idx % selectedNumbers.length],
          priority: validContacts.length - idx, // Higher priority = sent first
        })),
      })

      return newCampaign
    })

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Error creating text campaign:', error)
    return NextResponse.json(
      { error: 'Failed to create text campaign' },
      { status: 500 }
    )
  }
}

