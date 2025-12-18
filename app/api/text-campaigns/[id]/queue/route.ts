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

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') // Filter by status
    const round = searchParams.get('round') // Filter by round
    const limit = parseInt(searchParams.get('limit') || '100')

    const where: any = { campaignId: params.id }
    if (status) where.status = status
    if (round) where.currentRound = parseInt(round)

    const queueItems = await prisma.textCampaignQueue.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { priority: 'desc' },
      ],
      take: limit,
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
            propertyAddress: true,
            city: true,
            state: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    })

    // Get counts by status
    const statusCounts = await prisma.textCampaignQueue.groupBy({
      by: ['status'],
      where: { campaignId: params.id },
      _count: { status: true },
    })

    const counts = {
      PENDING: 0,
      SENDING: 0,
      SENT: 0,
      RESPONDED: 0,
      FAILED: 0,
      SKIPPED: 0,
    }

    statusCounts.forEach((sc) => {
      counts[sc.status as keyof typeof counts] = sc._count.status
    })

    return NextResponse.json({ queueItems, counts })
  } catch (error) {
    console.error('Error fetching campaign queue:', error)
    return NextResponse.json(
      { error: 'Failed to fetch campaign queue' },
      { status: 500 }
    )
  }
}

