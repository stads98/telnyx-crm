import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { unlink } from 'fs/promises';
import path from 'path';

// DELETE - Delete a single document
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

    // Get the document to find the file path
    const document = await prisma.loanDocument.findUnique({
      where: { id }
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Delete file from disk
    try {
      const filePath = path.join(process.cwd(), document.filePath);
      await unlink(filePath);
    } catch (e) {
      console.warn('Could not delete file:', document.filePath);
    }

    // Delete from database
    await prisma.loanDocument.delete({
      where: { id }
    });

    // Check if checklist item still has documents
    const remainingDocs = await prisma.loanDocument.count({
      where: { checklistItemId: document.checklistItemId }
    });

    // If no more documents, mark checklist item as not completed
    if (remainingDocs === 0) {
      await prisma.loanChecklistItem.update({
        where: { id: document.checklistItemId },
        data: { completed: false }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}

