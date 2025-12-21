import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pipelineId = searchParams.get('pipelineId');
    const pipeline = searchParams.get('pipeline') || 'default';
    const stage = searchParams.get('stage');
    const stageId = searchParams.get('stageId');
    const isLoanDeal = searchParams.get('isLoanDeal');
    const contactId = searchParams.get('contactId');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Status filters - when true, include these deals; when false/null, exclude them
    const showWon = searchParams.get('showWon');
    const showLost = searchParams.get('showLost');
    const showArchived = searchParams.get('showArchived');

    // Build where clause
    const where: any = {};

    // Filter by contact ID if provided (for contact side panel)
    if (contactId) {
      where.contact_id = contactId;
    } else if (pipelineId) {
      // Filter by pipeline ID if provided
      where.pipeline = pipelineId;
    } else if (pipeline !== 'all') {
      where.pipeline = pipeline;
    }

    if (stage) {
      where.stage = stage;
    }

    if (stageId) {
      where.stageId = stageId;
    }

    if (isLoanDeal !== null && isLoanDeal !== undefined) {
      where.isLoanDeal = isLoanDeal === 'true';
    }

    // Build stage filter based on won/lost filters
    // If none are selected, show only active (non-won, non-lost) deals
    // If any are selected, include those statuses

    // Check if any status filter is active
    const wonActive = showWon === 'true';
    const lostActive = showLost === 'true';

    // If no filters are active, show only active deals (exclude won and lost)
    // If specific filters are active, show only those
    if (!wonActive && !lostActive) {
      // Show only active deals - exclude won and lost stages
      // Use NOT to exclude closed and lost stages
      where.OR = [
        { dealStage: null }, // Deals without a stage
        {
          dealStage: {
            isClosedStage: { not: true },
            isLostStage: { not: true }
          }
        }
      ];
    } else {
      // Build filter based on active toggles
      const orConditions: any[] = [];

      if (wonActive) {
        orConditions.push({ dealStage: { isClosedStage: true } });
      }
      if (lostActive) {
        orConditions.push({ dealStage: { isLostStage: true } });
      }

      if (orConditions.length > 0) {
        where.OR = orConditions;
      }
    }

    // Fetch deals and count in parallel for better performance
    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          dealStage: true,
          lender: true,
        },
        orderBy: {
          created_at: 'desc'
        },
        take: limit,
        skip: offset
      }),
      prisma.deal.count({ where })
    ]);

    // Fetch contact information for all deals
    const contactIds = [...new Set(deals.map(d => d.contact_id))];
    const contacts = contactIds.length > 0 ? await prisma.contact.findMany({
      where: {
        id: { in: contactIds }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullName: true,
        propertyAddress: true,
        llcName: true,
        phone1: true,
        email1: true,
      }
    }) : [];

    const contactMap = new Map(contacts.map(c => [c.id, c]));

    // Transform deals to match frontend format
    const transformedDeals = deals.map(deal => {
      const contact = contactMap.get(deal.contact_id);
      return {
        id: deal.id,
        title: deal.name,
        value: Number(deal.value),
        contactId: deal.contact_id,
        contactName: contact ? (contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()) : '',
        contactPhone: contact?.phone1 || '',
        contactEmail: contact?.email1 || '',
        propertyAddress: deal.propertyAddress || contact?.propertyAddress || '',
        llcName: deal.llcName || contact?.llcName || '',
        stage: deal.dealStage?.key || deal.stage,
        stageId: deal.stageId,
        stageLabel: deal.dealStage?.label || deal.stage,
        stageColor: deal.dealStage?.color || '#e5e7eb',
        probability: deal.probability || deal.dealStage?.defaultProbability || 0,
        expectedCloseDate: deal.expected_close_date?.toISOString().split('T')[0] || '',
        notes: deal.notes || '',
        tasks: [],
        assignedTo: deal.assigned_to || '',
        pipelineId: deal.pipeline || 'default',
        archived: false,
        // Status flags based on stage
        isWon: deal.dealStage?.isClosedStage || false,
        isLost: deal.dealStage?.isLostStage || false,
        // Loan-specific fields
        isLoanDeal: deal.isLoanDeal || false,
        lenderId: deal.lenderId,
        lenderName: deal.lender?.name || '',
        loanAmount: deal.loanAmount ? Number(deal.loanAmount) : null,
        propertyValue: deal.propertyValue ? Number(deal.propertyValue) : null,
        ltv: deal.ltv ? Number(deal.ltv) : null,
        loanType: deal.loanType || '',
        interestRate: deal.interestRate ? Number(deal.interestRate) : null,
        dscr: deal.dscr ? Number(deal.dscr) : null,
        loanCopilotData: deal.loanCopilotData || null,
        // Legacy
        loanData: (deal.custom_fields as any)?.loanData || null,
        createdAt: deal.created_at.toISOString().split('T')[0],
        updatedAt: deal.updated_at?.toISOString().split('T')[0] || ''
      };
    });

    return NextResponse.json({
      success: true,
      deals: transformedDeals,
      total,
      limit,
      offset
    });

  } catch (error) {
    console.error('Error fetching deals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deals', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      stage,
      stage_id,
      value,
      probability,
      contact_id,
      expected_close_date,
      source,
      campaign,
      lead_score,
      pipeline,
      notes,
      custom_fields,
      // Loan-specific fields
      is_loan_deal,
      lender_id,
      llc_name,
      property_address,
      property_type,
      loan_amount,
      property_value,
      ltv,
      loan_type,
      interest_rate,
      dscr,
      loan_copilot_data,
    } = body;

    // If stage_id is provided, get the stage key from the database
    // Default to 'lead' which is a valid DealStage enum value
    let stageKey = stage || 'lead';
    let stageProbability = probability;
    if (stage_id) {
      const pipelineStage = await prisma.dealPipelineStage.findUnique({
        where: { id: stage_id }
      });
      if (pipelineStage) {
        // Map custom stage keys to valid DealStage enum values
        // The DealStage enum accepts: lead, qualified, proposal, negotiation, contract, closing, closed_won, closed_lost
        const validEnumStages = ['lead', 'qualified', 'proposal', 'negotiation', 'contract', 'closing', 'closed_won', 'closed_lost'];
        stageKey = validEnumStages.includes(pipelineStage.key) ? pipelineStage.key : 'lead';
        if (probability === undefined || probability === null) {
          stageProbability = pipelineStage.defaultProbability;
        }
      }
    }

    const deal = await prisma.deal.create({
      data: {
        name,
        stage: stageKey,
        stageId: stage_id || null, // Use camelCase field name (Prisma uses @map for DB column)
        value: parseFloat(value) || 0,
        probability: parseInt(stageProbability) || 0,
        contact_id,
        expected_close_date: expected_close_date ? new Date(expected_close_date) : null,
        source,
        campaign,
        lead_score: parseInt(lead_score) || 0,
        pipeline: pipeline || 'default',
        notes,
        custom_fields,
        // Loan-specific fields - use camelCase Prisma field names
        isLoanDeal: is_loan_deal || false,
        lenderId: lender_id || null,
        llcName: llc_name || null,
        propertyAddress: property_address || null,
        propertyType: property_type || null,
        loanAmount: loan_amount ? parseFloat(loan_amount) : null,
        propertyValue: property_value ? parseFloat(property_value) : null,
        ltv: ltv ? parseFloat(ltv) : null,
        loanType: loan_type || null,
        interestRate: interest_rate ? parseFloat(interest_rate) : null,
        dscr: dscr ? parseFloat(dscr) : null,
        loanCopilotData: loan_copilot_data || null,
      },
      include: {
        dealStage: true,
        lender: true,
      }
    });

    return NextResponse.json({
      success: true,
      deal: {
        id: deal.id,
        title: deal.name,
        value: Number(deal.value),
        contactId: deal.contact_id,
        stage: deal.dealStage?.key || deal.stage,
        stageId: deal.stageId,
        stageLabel: deal.dealStage?.label || deal.stage,
        probability: deal.probability || 0,
        expectedCloseDate: deal.expected_close_date?.toISOString().split('T')[0] || '',
        notes: deal.notes || '',
        isLoanDeal: deal.isLoanDeal,
        lenderId: deal.lenderId,
        lenderName: deal.lender?.name || '',
        llcName: deal.llcName,
        propertyAddress: deal.propertyAddress,
        propertyType: deal.propertyType,
        loanAmount: deal.loanAmount ? Number(deal.loanAmount) : null,
        propertyValue: deal.propertyValue ? Number(deal.propertyValue) : null,
        ltv: deal.ltv ? Number(deal.ltv) : null,
        loanType: deal.loanType,
        interestRate: deal.interestRate ? Number(deal.interestRate) : null,
        dscr: deal.dscr ? Number(deal.dscr) : null,
        loanCopilotData: deal.loanCopilotData,
        loanData: (deal.custom_fields as any)?.loanData || null
      }
    });

  } catch (error) {
    console.error('Error creating deal:', error);
    return NextResponse.json(
      { error: 'Failed to create deal', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

