import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PATCH /api/tasks/[id] - Update a task
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();

    console.log('[TASKS PATCH] Updating task:', id, body);

    // Validate task exists
    const existingTask = await prisma.activity.findUnique({
      where: { id },
    });

    if (!existingTask) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Map frontend fields to database fields
    const updateData: any = {};

    if (body.taskType !== undefined) updateData.task_type = body.taskType;
    if (body.subject !== undefined) updateData.title = body.subject;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.dueDate !== undefined) updateData.due_date = body.dueDate ? new Date(body.dueDate) : null;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.status !== undefined) {
      updateData.status = body.status === 'completed' ? 'completed' : 'planned';
      if (body.status === 'completed') {
        updateData.completed_at = new Date();
      }
    }
    if (body.contactId !== undefined) updateData.contact_id = body.contactId || null;

    console.log('[TASKS PATCH] Update data:', updateData);

    // Handle tags update
    if (body.tags !== undefined) {
      // Delete existing tags
      await prisma.activityTag.deleteMany({
        where: { activity_id: id },
      });

      // Add new tags
      if (body.tags && body.tags.length > 0) {
        await prisma.activityTag.createMany({
          data: body.tags.map((tag: { id: string }) => ({
            activity_id: id,
            tag_id: tag.id,
          })),
        });
      }
    }

    // Update the task
    const updatedTask = await prisma.activity.update({
      where: { id },
      data: updateData,
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
    });

    console.log('[TASKS PATCH] Task updated successfully');

    // Transform to match expected format
    const task = {
      id: updatedTask.id,
      taskType: updatedTask.task_type || '',
      subject: updatedTask.title,
      description: updatedTask.description || '',
      dueDate: updatedTask.due_date?.toISOString() || null,
      priority: updatedTask.priority || 'low',
      status: updatedTask.status === 'completed' ? 'completed' : 'open',
      contactId: updatedTask.contact_id || '',
      contactName: updatedTask.contact
        ? `${updatedTask.contact.firstName} ${updatedTask.contact.lastName || ''}`
        : '',
      contactPhone: updatedTask.contact?.phone1 || '',
      contactEmail: updatedTask.contact?.email1 || '',
      contactAddress: updatedTask.contact?.propertyAddress || '',
      contactCity: updatedTask.contact?.city || '',
      contactState: updatedTask.contact?.state || '',
      contactZip: updatedTask.contact?.zipCode || '',
      propertyType: updatedTask.contact?.propertyType || '',
      createdAt: updatedTask.created_at.toISOString(),
      tags: updatedTask.activity_tags.map((at) => ({
        id: at.tag.id,
        name: at.tag.name,
        color: at.tag.color,
      })),
    };

    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error('[TASKS PATCH] Error updating task:', error);
    return NextResponse.json(
      { error: 'Failed to update task', details: (error as Error).message },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[id] - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    console.log('[TASKS DELETE] Deleting task:', id);

    // Delete the task
    await prisma.activity.delete({
      where: { id },
    });

    console.log('[TASKS DELETE] Task deleted successfully');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[TASKS DELETE] Error deleting task:', error);
    return NextResponse.json(
      { error: 'Failed to delete task', details: (error as Error).message },
      { status: 500 }
    );
  }
}

