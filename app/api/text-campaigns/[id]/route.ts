import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const campaign = await prisma.textCampaign.findUnique({
      where: { id: params.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        queueItems: {
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                llcName: true,
                phone1: true,
                phone2: true,
                phone3: true,
              },
            },
          },
          orderBy: [
            { status: 'asc' },
            { priority: 'desc' },
          ],
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                llcName: true,
              },
            },
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

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Error fetching text campaign:', error)
    return NextResponse.json(
      { error: 'Failed to fetch text campaign' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, description, templates, delaySeconds, selectedNumbers } = body

    const campaign = await prisma.textCampaign.findUnique({
      where: { id: params.id },
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Only allow updates if campaign is not running
    if (campaign.status === 'RUNNING') {
      return NextResponse.json(
        { error: 'Cannot update a running campaign' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (templates !== undefined) {
      updateData.templates = JSON.stringify(templates)
      updateData.maxRounds = templates.length
    }
    if (delaySeconds !== undefined) updateData.delaySeconds = delaySeconds
    if (selectedNumbers !== undefined) updateData.selectedNumbers = selectedNumbers

    const updated = await prisma.textCampaign.update({
      where: { id: params.id },
      data: updateData,
    })

    return NextResponse.json({ campaign: updated })
  } catch (error) {
    console.error('Error updating text campaign:', error)
    return NextResponse.json(
      { error: 'Failed to update text campaign' },
      { status: 500 }
    )
  }
}

