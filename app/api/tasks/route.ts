import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// GET /api/tasks - Get all tasks (activities of type 'task')
export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contactId');
    const assignedTo = searchParams.get('assignedTo'); // Comma-separated user IDs
    const status = searchParams.get('status'); // 'open', 'completed', or 'all'
    const limit = parseInt(searchParams.get('limit') || '500'); // Default 500, max 1000
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause
    const whereClause: any = {
      type: 'task',
    };

    // Filter by contactId if provided
    if (contactId) {
      whereClause.contact_id = contactId;
    }

    // Filter by assigned user(s) if provided
    if (assignedTo) {
      const userIds = assignedTo.split(',').filter(id => id.trim());
      if (userIds.length > 0) {
        whereClause.assigned_to = { in: userIds };
      }
    }

    // Filter by status if provided
    if (status && status !== 'all') {
      whereClause.status = status === 'completed' ? 'completed' : { not: 'completed' };
    }

    // Fetch tasks with pagination
    // No authentication required to match other API routes in this CRM
    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where: whereClause,
        include: {
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email1: true,
              phone1: true,
              propertyAddress: true,
              city: true,
              state: true,
              zipCode: true,
              propertyType: true,
            },
          },
          assignedUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          activity_tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
        orderBy: [
          { due_date: 'asc' },
          { created_at: 'desc' },
        ],
        take: Math.min(limit, 1000), // Cap at 1000
        skip: offset,
      }),
      prisma.activity.count({ where: whereClause }),
    ]);

    // Transform to match expected format
    const tasks = activities.map((activity) => ({
      id: activity.id,
      taskType: activity.task_type || '',
      subject: activity.title,
      description: activity.description || '',
      dueDate: activity.due_date?.toISOString() || null,
      priority: activity.priority || 'low',
      status: activity.status === 'completed' ? 'completed' : 'open',
      contactId: activity.contact_id || '',
      contactName: activity.contact
        ? `${activity.contact.firstName} ${activity.contact.lastName || ''}`
        : '',
      contactPhone: activity.contact?.phone1 || '',
      contactEmail: activity.contact?.email1 || '',
      contactAddress: activity.contact?.propertyAddress || '',
      contactCity: activity.contact?.city || '',
      contactState: activity.contact?.state || '',
      contactZip: activity.contact?.zipCode || '',
      propertyType: activity.contact?.propertyType || '',
      assignedToId: activity.assigned_to || '',
      assignedToName: activity.assignedUser
        ? `${activity.assignedUser.firstName} ${activity.assignedUser.lastName || ''}`.trim()
        : '',
      createdById: activity.created_by || '',
      createdByName: activity.createdBy
        ? `${activity.createdBy.firstName} ${activity.createdBy.lastName || ''}`.trim()
        : '',
      createdAt: activity.created_at.toISOString(),
      tags: activity.activity_tags.map((at) => ({
        id: at.tag.id,
        name: at.tag.name,
        color: at.tag.color,
      })),
    }));

    return NextResponse.json({
      tasks,
      total,
      limit: Math.min(limit, 1000),
      offset,
      hasMore: offset + tasks.length < total,
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    console.log('[TASKS POST] Starting task creation...');

    const body = await request.json();
    console.log('[TASKS POST] Request body:', body);

    const { taskType, subject, description, dueDate, priority, contactId } = body;

    if (!subject || !subject.trim()) {
      return NextResponse.json(
        { error: 'Subject is required' },
        { status: 400 }
      );
    }

    // Get or create a default user for task creation
    // Since this CRM doesn't enforce authentication on most routes, we'll use a system user
    let user = await prisma.user.findFirst({
      select: { id: true, adminId: true },
    });

    // If no users exist, create a default system user
    if (!user) {
      console.log('[TASKS POST] No users found, creating default user...');
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);

      user = await prisma.user.create({
        data: {
          email: 'admin@adlercapital.com',
          firstName: 'System',
          lastName: 'Admin',
          password: hashedPassword,
          role: 'ADMIN',
          status: 'active',
        },
        select: { id: true, adminId: true },
      });
      console.log('[TASKS POST] Created default user:', user.id);
    }

    console.log('[TASKS POST] Using user:', user.id);

    // Validate contact exists if contactId is provided
    let validContactId = null;
    if (contactId) {
      const contactExists = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true },
      });
      if (contactExists) {
        validContactId = contactId;
        console.log('[TASKS POST] Contact validated:', contactId);
      } else {
        console.log('[TASKS POST] Contact not found, creating task without contact:', contactId);
      }
    }

    // Create activity
    console.log('[TASKS POST] Creating activity...');
    const activity = await prisma.activity.create({
      data: {
        type: 'task',
        task_type: taskType || null,
        title: subject,
        description: description || null,
        due_date: dueDate ? new Date(dueDate) : null,
        priority: priority || 'low',
        status: 'planned',
        contact_id: validContactId,
        created_by: user.id,
      },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email1: true,
            phone1: true,
          },
        },
      },
    });

    console.log('[TASKS POST] Activity created:', activity.id);

    return NextResponse.json({
      success: true,
      task: {
        id: activity.id,
        taskType: activity.task_type,
        subject: activity.title,
        description: activity.description,
        dueDate: activity.due_date?.toISOString(),
        priority: activity.priority,
        status: activity.status === 'completed' ? 'completed' : 'open',
        contactId: activity.contact_id,
        contactName: activity.contact
          ? `${activity.contact.firstName} ${activity.contact.lastName || ''}`
          : '',
        createdAt: activity.created_at.toISOString(),
      },
    });
  } catch (error) {
    console.error('[TASKS POST] Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task', details: (error as Error).message },
      { status: 500 }
    );
  }
}

