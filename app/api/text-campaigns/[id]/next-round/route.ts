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

    if (campaign.status !== 'ROUND_COMPLETE') {
      return NextResponse.json(
        { error: 'Campaign is not waiting for next round' },
        { status: 400 }
      )
    }

    if (campaign.currentRound >= campaign.maxRounds) {
      return NextResponse.json(
        { error: 'No more rounds available' },
        { status: 400 }
      )
    }

    // Move to next round and reset queue for contacts that haven't responded
    const updatedCampaign = await prisma.$transaction(async (tx) => {
      // Increment the round
      const updated = await tx.textCampaign.update({
        where: { id: params.id },
        data: {
          currentRound: campaign.currentRound + 1,
          currentIndex: 0,
          status: 'RUNNING',
          pausedAt: null,
        },
      })

      // Reset queue items that haven't responded to PENDING for next round
      await tx.textCampaignQueue.updateMany({
        where: {
          campaignId: params.id,
          status: { in: ['SENT', 'PENDING'] },
        },
        data: {
          status: 'PENDING',
          currentRound: campaign.currentRound + 1,
        },
      })

      return updated
    })

    // Start processing the next round
    processTextCampaign(updatedCampaign.id)

    return NextResponse.json({ campaign: updatedCampaign })
  } catch (error) {
    console.error('Error starting next round:', error)
    return NextResponse.json(
      { error: 'Failed to start next round' },
      { status: 500 }
    )
  }
}

