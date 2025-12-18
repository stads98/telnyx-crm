import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

    if (campaign.status !== 'RUNNING') {
      return NextResponse.json(
        { error: 'Campaign is not running' },
        { status: 400 }
      )
    }

    const updatedCampaign = await prisma.textCampaign.update({
      where: { id: params.id },
      data: {
        status: 'PAUSED',
        pausedAt: new Date(),
      },
    })

    return NextResponse.json({ campaign: updatedCampaign })
  } catch (error) {
    console.error('Error pausing text campaign:', error)
    return NextResponse.json(
      { error: 'Failed to pause text campaign' },
      { status: 500 }
    )
  }
}

