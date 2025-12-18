import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { LoanDocCategory } from '@prisma/client';

// Default checklist items for a DSCR loan
const DEFAULT_CHECKLIST_ITEMS: { label: string; category: LoanDocCategory; required: boolean }[] = [
  // Borrower Documents
  { label: 'Government ID (Front & Back)', category: 'BORROWER', required: true },
  { label: 'Entity Documents (Articles, Operating Agreement)', category: 'BORROWER', required: true },
  { label: 'Credit Authorization', category: 'BORROWER', required: true },
  { label: 'Loan Application', category: 'BORROWER', required: true },
  { label: 'Bank Statements (2 months)', category: 'BORROWER', required: true },
  { label: 'Proof of Funds for Down Payment', category: 'BORROWER', required: true },
  { label: 'REO Schedule', category: 'BORROWER', required: false },
  { label: 'Track Record / Experience', category: 'BORROWER', required: false },
  
  // Property Documents
  { label: 'Purchase Contract', category: 'PROPERTY', required: true },
  { label: 'Rent Roll / Lease Agreements', category: 'PROPERTY', required: true },
  { label: 'Appraisal', category: 'PROPERTY', required: true },
  { label: 'Property Photos', category: 'PROPERTY', required: false },
  
  // Title Documents
  { label: 'Title Commitment', category: 'TITLE', required: true },
  { label: 'Preliminary Title Report', category: 'TITLE', required: false },
  { label: 'Survey', category: 'TITLE', required: false },
  
  // Insurance Documents
  { label: 'Property Insurance Quote', category: 'INSURANCE', required: true },
  { label: 'Hazard Insurance Policy', category: 'INSURANCE', required: true },
  { label: 'Flood Certification', category: 'INSURANCE', required: false },
  
  // Other
  { label: 'Conditional Approval', category: 'OTHER', required: false },
  { label: 'Clear to Close', category: 'OTHER', required: false },
  { label: 'Closing Disclosure', category: 'OTHER', required: false },
  { label: 'Wire Instructions', category: 'OTHER', required: false },
];

// POST - Initialize default checklist items for a deal
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { dealId } = body;

    if (!dealId) {
      return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
    }

    // Check if checklist items already exist for this deal
    const existingItems = await prisma.loanChecklistItem.count({
      where: { dealId }
    });

    if (existingItems > 0) {
      return NextResponse.json({ 
        message: 'Checklist already initialized',
        count: existingItems 
      });
    }

    // Create default checklist items
    const items = await prisma.loanChecklistItem.createMany({
      data: DEFAULT_CHECKLIST_ITEMS.map((item, index) => ({
        dealId,
        label: item.label,
        category: item.category,
        required: item.required,
        orderIndex: index
      }))
    });

    // Fetch the created items with documents
    const checklistItems = await prisma.loanChecklistItem.findMany({
      where: { dealId },
      include: { documents: true },
      orderBy: [{ category: 'asc' }, { orderIndex: 'asc' }]
    });

    return NextResponse.json({ 
      success: true, 
      checklistItems,
      count: items.count
    });
  } catch (error) {
    console.error('Error initializing checklist:', error);
    return NextResponse.json({ error: 'Failed to initialize checklist' }, { status: 500 });
  }
}

