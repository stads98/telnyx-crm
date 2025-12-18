import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { unlink } from 'fs/promises';
import path from 'path';

// PATCH - Update a checklist item (toggle completed, update label, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { completed, label, category, required, notes } = body;

    const updateData: any = {};
    if (completed !== undefined) updateData.completed = completed;
    if (label !== undefined) updateData.label = label;
    if (category !== undefined) updateData.category = category;
    if (required !== undefined) updateData.required = required;
    if (notes !== undefined) updateData.notes = notes;

    const checklistItem = await prisma.loanChecklistItem.update({
      where: { id },
      data: updateData,
      include: { documents: true }
    });

    return NextResponse.json({ checklistItem });
  } catch (error) {
    console.error('Error updating checklist item:', error);
    return NextResponse.json({ error: 'Failed to update checklist item' }, { status: 500 });
  }
}

// DELETE - Delete a checklist item and its documents
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Get all documents for this checklist item to delete files
    const documents = await prisma.loanDocument.findMany({
      where: { checklistItemId: id }
    });

    // Delete files from disk
    for (const doc of documents) {
      try {
        const filePath = path.join(process.cwd(), doc.filePath);
        await unlink(filePath);
      } catch (e) {
        console.warn('Could not delete file:', doc.filePath);
      }
    }

    // Delete checklist item (documents cascade deleted)
    await prisma.loanChecklistItem.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    return NextResponse.json({ error: 'Failed to delete checklist item' }, { status: 500 });
  }
}

