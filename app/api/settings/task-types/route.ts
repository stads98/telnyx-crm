import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user's session
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get admin user ID (for team users, use their admin's settings)
    const adminId = session.user.adminId || session.user.id;

    // Get task types from user settings
    const settings = await prisma.userSettings.findUnique({
      where: { userId: adminId },
    });

    const taskTypes = settings?.taskTypes || [];

    return NextResponse.json({ taskTypes });
  } catch (error) {
    console.error('Error fetching task types:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task types' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Admin-only route protection
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[TASK TYPES POST] Starting...');

    const { taskTypes } = await request.json();
    console.log('[TASK TYPES POST] Task types to save:', taskTypes);

    if (!Array.isArray(taskTypes)) {
      return NextResponse.json(
        { error: 'Invalid task types format' },
        { status: 400 }
      );
    }

    // Use the authenticated user
    const adminId = session.user.id;
    console.log('[TASK TYPES POST] Admin ID:', adminId);

    // Update or create user settings
    const settings = await prisma.userSettings.upsert({
      where: { userId: adminId },
      update: { taskTypes },
      create: {
        userId: adminId,
        taskTypes,
      },
    });

    console.log('[TASK TYPES POST] Settings saved:', settings.id);

    return NextResponse.json({ success: true, taskTypes: settings.taskTypes });
  } catch (error) {
    console.error('[TASK TYPES POST] Error updating task types:', error);
    return NextResponse.json(
      { error: 'Failed to update task types', details: (error as Error).message },
      { status: 500 }
    );
  }
}

