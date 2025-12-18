'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Calendar, Clock, User, AlertCircle } from 'lucide-react';
import { format, isPast, differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { useTaskUI } from '@/lib/context/task-ui-context';

interface LoanTasksProps {
  dealId: string;
  contactId: string;
}

interface Task {
  id: string;
  subject: string;
  description?: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed';
  assignedTo?: string;
}

export default function LoanTasks({ dealId, contactId }: LoanTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const { openTask } = useTaskUI();

  useEffect(() => {
    if (contactId) {
      loadTasks();
    }
  }, [dealId, contactId]);

  const loadTasks = async () => {
    if (!contactId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/tasks?contactId=${contactId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks?.map((t: any) => ({
          id: t.id,
          subject: t.subject,
          description: t.description,
          dueDate: t.dueDate,
          priority: t.priority || 'low',
          status: t.status === 'completed' ? 'completed' : 'pending',
          assignedTo: t.assignedTo,
        })) || []);
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        setTasks(prev => prev.map(t => 
          t.id === taskId ? { ...t, status: newStatus } : t
        ));
        toast.success(newStatus === 'completed' ? 'Task completed' : 'Task reopened');
      }
    } catch (error) {
      toast.error('Failed to update task');
    }
  };

  const handleCreateTask = () => {
    openTask({
      contactId,
      title: 'New Loan Task',
      description: `Task for deal ${dealId}`,
    });
  };

  const getUrgencyBadge = (dueDate?: string) => {
    if (!dueDate) return null;
    const date = new Date(dueDate);
    const daysUntil = differenceInDays(date, new Date());
    
    if (isPast(date)) return <Badge variant="destructive">Overdue</Badge>;
    if (daysUntil <= 1) return <Badge className="bg-orange-500">Due Today</Badge>;
    if (daysUntil <= 3) return <Badge className="bg-yellow-500">Due Soon</Badge>;
    return null;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-500';
      case 'medium': return 'text-yellow-500';
      default: return 'text-gray-400';
    }
  };

  const pendingTasks = tasks.filter(t => t.status !== 'completed');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Loan Tasks</h2>
          <p className="text-sm text-muted-foreground">
            {pendingTasks.length} pending, {completedTasks.length} completed
          </p>
        </div>
        <Button className="gap-2" onClick={handleCreateTask}>
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      {/* Pending Tasks */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {pendingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No pending tasks</p>
          ) : (
            <div className="space-y-2">
              {pendingTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50">
                  <Checkbox checked={false} onCheckedChange={() => handleToggleTask(task.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{task.subject}</span>
                      {getUrgencyBadge(task.dueDate)}
                    </div>
                    {task.dueDate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(task.dueDate), 'MMM d, yyyy')}
                      </div>
                    )}
                  </div>
                  <AlertCircle className={`h-4 w-4 ${getPriorityColor(task.priority)}`} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed Tasks</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {completedTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 opacity-60">
                  <Checkbox checked={true} onCheckedChange={() => handleToggleTask(task.id)} />
                  <span className="text-sm line-through">{task.subject}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

