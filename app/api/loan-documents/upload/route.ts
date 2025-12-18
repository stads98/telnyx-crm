import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const dealId = formData.get('dealId') as string | null;
    const checklistItemId = formData.get('checklistItemId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!dealId) {
      return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
    }

    if (!checklistItemId) {
      return NextResponse.json({ error: 'checklistItemId is required' }, { status: 400 });
    }

    // Create upload directory for this deal
    const uploadDir = path.join(process.cwd(), 'uploads', 'loan-documents', dealId);
    await mkdir(uploadDir, { recursive: true });

    // Generate unique filename while preserving extension
    const ext = path.extname(file.name);
    const storedName = `${uuidv4()}${ext}`;
    const filePath = path.join(uploadDir, storedName);
    const relativePath = `/uploads/loan-documents/${dealId}/${storedName}`;

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Save to database
    const document = await prisma.loanDocument.create({
      data: {
        checklistItemId,
        dealId,
        originalName: file.name,
        storedName,
        filePath: relativePath,
        fileSize: file.size,
        mimeType: file.type || null,
        fileExtension: ext.replace('.', '').toLowerCase() || null,
        uploadedBy: session.user.id,
      }
    });

    // Check if all required docs for this checklist item are now uploaded
    // and auto-mark as completed if documents exist
    const docsCount = await prisma.loanDocument.count({
      where: { checklistItemId }
    });

    if (docsCount > 0) {
      await prisma.loanChecklistItem.update({
        where: { id: checklistItemId },
        data: { completed: true }
      });
    }

    return NextResponse.json({
      success: true,
      document,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}

