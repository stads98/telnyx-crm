import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: params.id },
      include: {
        dealStage: true,
        lender: true,
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            fullName: true,
            phone1: true,
            email1: true,
          }
        }
      }
    });

    if (!deal) {
      return NextResponse.json(
        { error: 'Deal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deal: {
        id: deal.id,
        title: deal.name,
        value: Number(deal.value),
        contactId: deal.contact_id,
        contactName: deal.contact?.fullName || `${deal.contact?.firstName || ''} ${deal.contact?.lastName || ''}`.trim(),
        contactPhone: deal.contact?.phone1,
        contactEmail: deal.contact?.email1,
        stage: deal.stage,
        stageId: deal.stageId,
        stageName: deal.dealStage?.label,
        stageColor: deal.dealStage?.color,
        probability: deal.probability || 0,
        expectedCloseDate: deal.expected_close_date?.toISOString().split('T')[0] || '',
        notes: deal.notes || '',
        pipeline: deal.pipeline,
        createdAt: deal.created_at.toISOString(),
        updatedAt: deal.updated_at?.toISOString() || '',
        // Loan-specific fields
        isLoanDeal: deal.isLoanDeal,
        lenderId: deal.lenderId,
        lenderName: deal.lender?.name,
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
        // DSCR calculation fields
        isOccupied: deal.isOccupied,
        marketRent: deal.marketRent ? Number(deal.marketRent) : null,
        actualRent: deal.actualRent ? Number(deal.actualRent) : null,
        annualInsurance: deal.annualInsurance ? Number(deal.annualInsurance) : null,
        annualTaxes: deal.annualTaxes ? Number(deal.annualTaxes) : null,
        loanNumber: deal.loanNumber,
        loanTerm: deal.loanTerm,
        isInterestOnly: deal.isInterestOnly,
        prepayPenalty: deal.prepayPenalty,
        points: deal.points ? Number(deal.points) : null,
      }
    });
  } catch (error) {
    console.error('Error fetching deal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deal' },
      { status: 500 }
    );
  }
}

// Valid DealStage enum values from Prisma schema
const VALID_DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'contract', 'closing', 'closed_won', 'closed_lost'];

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      name,
      stage,
      stageId,
      stage_id, // Also accept snake_case version
      value,
      probability,
      contact_id,
      expected_close_date,
      notes,
      // Loan-specific fields
      isLoanDeal,
      lenderId,
      llcName,
      propertyAddress,
      propertyType,
      loanAmount,
      propertyValue,
      ltv,
      loanType,
      interestRate,
      dscr,
      // DSCR calculation fields
      isOccupied,
      marketRent,
      actualRent,
      annualInsurance,
      annualTaxes,
      loanNumber,
      loanTerm,
      isInterestOnly,
      prepayPenalty,
      points,
      loanCopilotData,
    } = body;

    // Support both stageId and stage_id
    const effectiveStageId = stageId || stage_id;

    // Get the current deal to preserve existing stage if needed
    const currentDeal = await prisma.deal.findUnique({
      where: { id: params.id },
      select: { stage: true, stageId: true }
    });

    if (!currentDeal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Determine the stage key to use
    let stageKey = stage;
    let stageProbability = probability;

    if (effectiveStageId) {
      // Look up the pipeline stage to get its key and check if it's won/lost
      const pipelineStage = await prisma.dealPipelineStage.findUnique({
        where: { id: effectiveStageId }
      });

      if (pipelineStage) {
        // Map pipeline stage to a valid DealStage enum value
        const key = pipelineStage.key.toLowerCase();

        // Check if the key directly matches a valid enum value
        if (VALID_DEAL_STAGES.includes(key)) {
          stageKey = key;
        } else if (pipelineStage.isClosedStage) {
          stageKey = 'closed_won';
        } else if (pipelineStage.isLostStage) {
          stageKey = 'closed_lost';
        } else {
          // For custom stages, map to the closest valid stage based on probability
          const prob = pipelineStage.defaultProbability || 0;
          if (prob >= 90) stageKey = 'closing';
          else if (prob >= 75) stageKey = 'contract';
          else if (prob >= 50) stageKey = 'negotiation';
          else if (prob >= 30) stageKey = 'proposal';
          else if (prob >= 20) stageKey = 'qualified';
          else stageKey = 'lead';
        }

        // Use the stage's default probability if not explicitly set
        if (stageProbability === undefined) {
          stageProbability = pipelineStage.defaultProbability;
        }
      }
    }

    // Validate that stageKey is a valid DealStage enum value
    if (stageKey && !VALID_DEAL_STAGES.includes(stageKey)) {
      stageKey = currentDeal.stage; // Keep existing stage if new one is invalid
    }

    const deal = await prisma.deal.update({
      where: { id: params.id },
      data: {
        name,
        stage: stageKey || undefined,
        stageId: effectiveStageId || undefined,
        value: value !== undefined ? parseFloat(value) : undefined,
        probability: stageProbability !== undefined ? parseInt(String(stageProbability)) : undefined,
        contact_id,
        expected_close_date: expected_close_date ? new Date(expected_close_date) : null,
        notes,
        // Loan-specific fields
        isLoanDeal: isLoanDeal !== undefined ? isLoanDeal : undefined,
        lenderId: lenderId !== undefined ? lenderId : undefined,
        llcName: llcName !== undefined ? llcName : undefined,
        propertyAddress: propertyAddress !== undefined ? propertyAddress : undefined,
        propertyType: propertyType !== undefined ? propertyType : undefined,
        loanAmount: loanAmount !== undefined ? parseFloat(loanAmount) : undefined,
        propertyValue: propertyValue !== undefined ? parseFloat(propertyValue) : undefined,
        ltv: ltv !== undefined ? parseFloat(ltv) : undefined,
        loanType: loanType !== undefined ? loanType : undefined,
        interestRate: interestRate !== undefined ? parseFloat(interestRate) : undefined,
        dscr: dscr !== undefined ? parseFloat(dscr) : undefined,
        // DSCR calculation fields
        isOccupied: isOccupied !== undefined ? isOccupied : undefined,
        marketRent: marketRent !== undefined ? parseFloat(marketRent) : undefined,
        actualRent: actualRent !== undefined ? parseFloat(actualRent) : undefined,
        annualInsurance: annualInsurance !== undefined ? parseFloat(annualInsurance) : undefined,
        annualTaxes: annualTaxes !== undefined ? parseFloat(annualTaxes) : undefined,
        loanNumber: loanNumber !== undefined ? loanNumber : undefined,
        loanTerm: loanTerm !== undefined ? loanTerm : undefined,
        isInterestOnly: isInterestOnly !== undefined ? isInterestOnly : undefined,
        prepayPenalty: prepayPenalty !== undefined ? prepayPenalty : undefined,
        points: points !== undefined ? parseFloat(points) : undefined,
        loanCopilotData: loanCopilotData !== undefined ? loanCopilotData : undefined,
      },
      include: {
        dealStage: true,
        lender: true,
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            fullName: true,
            phone1: true,
            email1: true,
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      deal: {
        id: deal.id,
        title: deal.name,
        value: Number(deal.value),
        contactId: deal.contact_id,
        contactName: deal.contact?.fullName || `${deal.contact?.firstName || ''} ${deal.contact?.lastName || ''}`.trim(),
        stage: deal.stage,
        stageId: deal.stageId,
        stageName: deal.dealStage?.label,
        probability: deal.probability || 0,
        expectedCloseDate: deal.expected_close_date?.toISOString().split('T')[0] || '',
        notes: deal.notes || '',
        // Loan-specific fields
        isLoanDeal: deal.isLoanDeal,
        lenderId: deal.lenderId,
        lenderName: deal.lender?.name,
        llcName: deal.llcName,
        propertyAddress: deal.propertyAddress,
        loanAmount: deal.loanAmount ? Number(deal.loanAmount) : null,
        propertyValue: deal.propertyValue ? Number(deal.propertyValue) : null,
        ltv: deal.ltv ? Number(deal.ltv) : null,
        loanType: deal.loanType,
        interestRate: deal.interestRate ? Number(deal.interestRate) : null,
        dscr: deal.dscr ? Number(deal.dscr) : null,
      }
    });
  } catch (error) {
    console.error('Error updating deal:', error);
    return NextResponse.json(
      { error: 'Failed to update deal' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.deal.delete({
      where: { id: params.id }
    });

    return NextResponse.json({
      success: true,
      message: 'Deal deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting deal:', error);
    return NextResponse.json(
      { error: 'Failed to delete deal' },
      { status: 500 }
    );
  }
}

