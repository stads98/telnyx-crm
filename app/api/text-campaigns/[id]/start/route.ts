import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { processTextCampaign } from '@/lib/text-campaign-engine'

export async function POST(
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
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.status === 'RUNNING') {
      return NextResponse.json(
        { error: 'Campaign is already running' },
        { status: 400 }
      )
    }

    if (campaign.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Campaign has already completed' },
        { status: 400 }
      )
    }

    // Update campaign status to running
    const updatedCampaign = await prisma.textCampaign.update({
      where: { id: params.id },
      data: {
        status: 'RUNNING',
        startedAt: campaign.startedAt || new Date(),
        pausedAt: null,
      },
    })

    // Start the campaign processing in the background
    processTextCampaign(updatedCampaign.id)

    return NextResponse.json({ campaign: updatedCampaign })
  } catch (error) {
    console.error('Error starting text campaign:', error)
    return NextResponse.json(
      { error: 'Failed to start text campaign' },
      { status: 500 }
    )
  }
}

