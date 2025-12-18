import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const stages = await prisma.dealPipelineStage.findMany({
      where: { pipelineId: id },
      orderBy: { orderIndex: 'asc' }
    });

    return NextResponse.json({
      success: true,
      stages: stages.map(s => ({
        id: s.id,
        key: s.key,
        name: s.label,
        label: s.label,
        order: s.orderIndex,
        orderIndex: s.orderIndex,
        color: s.color,
        defaultProbability: s.defaultProbability,
        isClosedStage: s.isClosedStage,
        isLostStage: s.isLostStage,
      }))
    });
  } catch (error) {
    console.error('Error fetching stages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stages' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { key, label, color, orderIndex, defaultProbability, isClosedStage, isLostStage } = body;

    // Get max order index
    const maxOrder = await prisma.dealPipelineStage.aggregate({
      where: { pipelineId: id },
      _max: { orderIndex: true }
    });

    const stage = await prisma.dealPipelineStage.create({
      data: {
        pipelineId: id,
        key: key || label.toLowerCase().replace(/\s+/g, '_'),
        label,
        color: color || '#6B7280',
        orderIndex: orderIndex ?? (maxOrder._max.orderIndex ?? -1) + 1,
        defaultProbability: defaultProbability ?? 50,
        isClosedStage: isClosedStage || false,
        isLostStage: isLostStage || false,
      }
    });

    return NextResponse.json({
      success: true,
      stage: {
        id: stage.id,
        key: stage.key,
        name: stage.label,
        label: stage.label,
        order: stage.orderIndex,
        orderIndex: stage.orderIndex,
        color: stage.color,
        defaultProbability: stage.defaultProbability,
        isClosedStage: stage.isClosedStage,
        isLostStage: stage.isLostStage,
      }
    });
  } catch (error) {
    console.error('Error creating stage:', error);
    return NextResponse.json(
      { error: 'Failed to create stage' },
      { status: 500 }
    );
  }
}

// PUT - Reorder stages
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { stageIds } = body; // Array of stage IDs in new order

    if (!Array.isArray(stageIds)) {
      return NextResponse.json(
        { error: 'stageIds must be an array' },
        { status: 400 }
      );
    }

    // Update each stage's orderIndex
    await Promise.all(
      stageIds.map((stageId: string, index: number) =>
        prisma.dealPipelineStage.update({
          where: { id: stageId },
          data: { orderIndex: index }
        })
      )
    );

    // Fetch updated stages
    const stages = await prisma.dealPipelineStage.findMany({
      where: { pipelineId: id },
      orderBy: { orderIndex: 'asc' }
    });

    return NextResponse.json({
      success: true,
      stages: stages.map(s => ({
        id: s.id,
        key: s.key,
        name: s.label,
        label: s.label,
        order: s.orderIndex,
        orderIndex: s.orderIndex,
        color: s.color,
        defaultProbability: s.defaultProbability,
        isClosedStage: s.isClosedStage,
        isLostStage: s.isLostStage,
      }))
    });
  } catch (error) {
    console.error('Error reordering stages:', error);
    return NextResponse.json(
      { error: 'Failed to reorder stages' },
      { status: 500 }
    );
  }
}

