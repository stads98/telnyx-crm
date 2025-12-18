import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET - Fetch all checklist items with their documents for a deal
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dealId = searchParams.get('dealId');

    if (!dealId) {
      return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
    }

    // Fetch checklist items with their documents
    const checklistItems = await prisma.loanChecklistItem.findMany({
      where: { dealId },
      include: {
        documents: {
          orderBy: { uploadedAt: 'desc' }
        }
      },
      orderBy: [
        { category: 'asc' },
        { orderIndex: 'asc' }
      ]
    });

    return NextResponse.json({ checklistItems });
  } catch (error) {
    console.error('Error fetching loan documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

// POST - Create a new checklist item
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { dealId, label, category, required } = body;

    if (!dealId || !label) {
      return NextResponse.json({ error: 'dealId and label are required' }, { status: 400 });
    }

    // Get max order index for this deal
    const maxOrder = await prisma.loanChecklistItem.aggregate({
      where: { dealId },
      _max: { orderIndex: true }
    });

    const checklistItem = await prisma.loanChecklistItem.create({
      data: {
        dealId,
        label,
        category: category || 'OTHER',
        required: required || false,
        orderIndex: (maxOrder._max.orderIndex || 0) + 1
      },
      include: { documents: true }
    });

    return NextResponse.json({ checklistItem });
  } catch (error) {
    console.error('Error creating checklist item:', error);
    return NextResponse.json({ error: 'Failed to create checklist item' }, { status: 500 });
  }
}

