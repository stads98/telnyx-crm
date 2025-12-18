'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  VisibilityState,
  ColumnSizingState,
  ColumnOrderState,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus,
  Search,
  Calendar as CalendarIcon,
  Phone,
  Mail,
  MessageSquare,
  User,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Loader2,
  CheckCircle2,
  CheckCircle,
  Circle,
  Clock,
  Settings2,
  GripVertical,
  X,
  Save,
  Tag as TagIcon,
  History,
  FileText,
  Edit,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from '@/lib/format-phone';
import { autoFitColumn } from '@/lib/excel-column-utils';
import { useTaskUI } from '@/lib/context/task-ui-context';
import { useSmsUI } from '@/lib/context/sms-ui-context';
import { useEmailUI } from '@/lib/context/email-ui-context';
import { useMakeCall } from '@/hooks/use-make-call';
import { useContactPanel } from '@/lib/context/contact-panel-context';
import { normalizePropertyType } from '@/lib/property-type-mapper';
import { useGlobalCache } from '@/lib/stores/useGlobalCache';
import { CallButtonWithCellHover } from '@/components/ui/call-button-with-cell-hover';

interface TaskTag {
  id: string;
  name: string;
  color: string;
}

interface Task {
  id: string;
  taskType?: string;
  subject: string;
  description?: string;
  dueDate?: Date | string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'completed';
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  assignedToId?: string;
  assignedToName?: string;
  createdById?: string;
  createdByName?: string;
  createdAt: Date | string;
  tags?: TaskTag[];
}

interface UserOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  phone1?: string;
  email?: string;
  email1?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  propertyType?: string;
}

interface ActivityHistoryItem {
  id: string;
  type: 'call' | 'sms' | 'email' | 'activity' | 'sequence' | 'tag_added' | 'tag_removed' | 'task';
  title: string;
  description?: string;
  direction?: 'inbound' | 'outbound';
  status?: string;
  timestamp: string;
  isPinned?: boolean;
  activityId?: string;
  metadata?: Record<string, unknown>;
}

// Activity history cache
const activityHistoryCache = new Map<string, { items: ActivityHistoryItem[]; loading: boolean; timestamp: number }>();

// Separate component for editable description to avoid table re-renders
function EditableDescriptionCell({ taskId, initialValue, onSave }: { taskId: string; initialValue: string; onSave: (value: string) => Promise<void> }) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(initialValue);

  // Sync with external changes
  useEffect(() => {
    if (!isOpen) {
      setValue(initialValue);
    }
  }, [initialValue, isOpen]);

  const handleSave = async () => {
    if (value !== initialValue) {
      await onSave(value);
    }
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (!open && isOpen) {
        handleSave();
      } else {
        setIsOpen(open);
      }
    }}>
      <PopoverTrigger asChild>
        <div
          className="text-sm text-muted-foreground cursor-pointer hover:bg-accent px-2 py-1 rounded truncate"
          onClick={() => setIsOpen(true)}
          title={initialValue ? `${initialValue}\n\nClick to edit` : 'Click to add description'}
        >
          {initialValue || '-'}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[350px] p-2 z-[100]" align="start" side="bottom" sideOffset={5} avoidCollisions={true} collisionPadding={20}>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue(initialValue);
              setIsOpen(false);
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSave();
            }
          }}
          autoFocus
          className="min-h-[120px] w-full resize-y"
          placeholder="Enter description..."
        />
        <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
          <span>Cmd+Enter = save • Esc = cancel</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Separate component for editable subject to avoid table re-renders
function EditableSubjectCell({ taskId, initialValue, onSave }: { taskId: string; initialValue: string; onSave: (value: string) => Promise<void> }) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (!isEditing) {
      setValue(initialValue);
    }
  }, [initialValue, isEditing]);

  const handleSave = async () => {
    if (value.trim() && value !== initialValue) {
      await onSave(value.trim());
    } else {
      setValue(initialValue);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setValue(initialValue);
            setIsEditing(false);
          }
        }}
        autoFocus
        className="h-8 w-full"
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:underline"
      onClick={() => setIsEditing(true)}
      title="Click to edit"
    >
      {initialValue || 'Untitled'}
    </span>
  );
}

// Activity History Cell Component with hover popover
function ActivityHistoryCell({ contactId, contactName }: { contactId?: string; contactName?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<ActivityHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteValue, setNewNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const fetchHistory = async () => {
    if (!contactId) return;

    // Check cache first
    const cached = activityHistoryCache.get(contactId);
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      setItems(cached.items);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activity-history?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const historyItems = data.items || [];
        setItems(historyItems);
        activityHistoryCache.set(contactId, { items: historyItems, loading: false, timestamp: Date.now() });
      }
    } catch (error) {
      console.error('Error fetching activity history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNote = async (activityId: string) => {
    setSavingNote(true);
    try {
      const res = await fetch(`/api/activities/${activityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editNoteValue }),
      });
      if (res.ok) {
        // Update local state
        setItems(prev => prev.map(item =>
          item.activityId === activityId ? { ...item, description: editNoteValue } : item
        ));
        // Invalidate cache
        activityHistoryCache.delete(contactId || '');
        setEditingNote(null);
        toast.success('Note updated');
      } else {
        toast.error('Failed to update note');
      }
    } catch (error) {
      console.error('Error saving note:', error);
      toast.error('Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleAddNewNote = async () => {
    if (!contactId || !newNoteValue.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          type: 'note',
          title: 'Note',
          description: newNoteValue.trim(),
          status: 'completed',
        }),
      });
      if (res.ok) {
        // Invalidate cache and refetch
        activityHistoryCache.delete(contactId);
        await fetchHistory();
        setIsAddingNote(false);
        setNewNoteValue('');
        toast.success('Note added');
      } else {
        toast.error('Failed to add note');
      }
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
    } finally {
      setSavingNote(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'call': return <Phone className="h-3 w-3" />;
      case 'sms': return <MessageSquare className="h-3 w-3" />;
      case 'email': return <Mail className="h-3 w-3" />;
      case 'activity': return <FileText className="h-3 w-3" />;
      case 'note': return <FileText className="h-3 w-3" />;
      case 'task': return <CheckCircle className="h-3 w-3" />;
      default: return <Clock className="h-3 w-3" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'call': return 'text-green-600';
      case 'sms': return 'text-blue-600';
      case 'email': return 'text-purple-600';
      case 'activity': return 'text-orange-600';
      case 'note': return 'text-orange-600';
      case 'task': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  };

  // Find the latest note to show as preview
  const latestNote = items.find(item => (item.type === 'activity' || item.type === 'note') && item.description);
  const noteCount = items.filter(item => item.type === 'activity' || item.type === 'note').length;

  if (!contactId) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (open) fetchHistory();
      if (!open) {
        setIsAddingNote(false);
        setEditingNote(null);
      }
    }}>
      <PopoverTrigger asChild>
        <div
          className="flex items-center gap-1 cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5 min-h-[24px] max-w-full"
          title={latestNote?.description ? `Latest: ${latestNote.description}` : 'Click to view activity history'}
        >
          <History className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          {latestNote?.description ? (
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">
              {latestNote.description.substring(0, 30)}{latestNote.description.length > 30 ? '...' : ''}
            </span>
          ) : items.length > 0 ? (
            <span className="text-xs text-muted-foreground">{items.length}</span>
          ) : (
            <span className="text-xs text-muted-foreground">View</span>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[450px] p-0 z-[100]" align="start" side="right" sideOffset={5}>
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <h4 className="font-medium text-sm">Activity History</h4>
            <p className="text-xs text-muted-foreground">{contactName || 'Contact'} • {items.length} items</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setIsAddingNote(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Note
          </Button>
        </div>

        {/* Add new note section */}
        {isAddingNote && (
          <div className="p-3 border-b bg-accent/30">
            <Textarea
              value={newNoteValue}
              onChange={(e) => setNewNoteValue(e.target.value)}
              placeholder="Enter your note here... (supports multiple lines with bullets using '-')"
              className="min-h-[80px] text-sm mb-2"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setIsAddingNote(false);
                  setNewNoteValue('');
                }}
                disabled={savingNote}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={handleAddNewNote}
                disabled={savingNote || !newNoteValue.trim()}
              >
                {savingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save Note
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="h-[350px]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mb-2" />
              <p className="text-sm">No activity history</p>
              <Button
                size="sm"
                variant="link"
                className="text-xs mt-2"
                onClick={() => setIsAddingNote(true)}
              >
                Add the first note
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <div key={item.id} className="p-3 hover:bg-accent/30">
                  <div className="flex items-start gap-2">
                    <div className={cn('mt-0.5', getTypeColor(item.type))}>
                      {getTypeIcon(item.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{item.title}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(item.timestamp), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      {item.direction && (
                        <Badge variant="outline" className="text-[10px] mt-1">
                          {item.direction}
                        </Badge>
                      )}
                      {editingNote === item.activityId ? (
                        <div className="mt-2">
                          <Textarea
                            value={editNoteValue}
                            onChange={(e) => setEditNoteValue(e.target.value)}
                            placeholder="Edit note... (supports multiple lines with bullets using '-')"
                            className="min-h-[80px] text-sm"
                            autoFocus
                          />
                          <div className="flex gap-2 mt-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setEditingNote(null)}
                              disabled={savingNote}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              onClick={() => handleSaveNote(item.activityId!)}
                              disabled={savingNote}
                            >
                              {savingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : item.description ? (
                        <div className="mt-1 group relative">
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                            {item.description}
                          </p>
                          {(item.type === 'activity' || item.type === 'note') && item.activityId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 text-[10px] px-1.5 mt-1 opacity-60 hover:opacity-100"
                              onClick={() => {
                                setEditingNote(item.activityId!);
                                setEditNoteValue(item.description || '');
                              }}
                            >
                              <Edit className="h-2.5 w-2.5 mr-1" />
                              Edit
                            </Button>
                          )}
                        </div>
                      ) : (item.type === 'activity' || item.type === 'note') && item.activityId ? (
                        <button
                          className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1"
                          onClick={() => {
                            setEditingNote(item.activityId!);
                            setEditNoteValue('');
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          Add note
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export default function TasksExcelView() {
  // Global UI contexts
  const { openTask, setOnTaskCreated } = useTaskUI();
  const { openSms } = useSmsUI();
  const { openEmail } = useEmailUI();
  const { makeCall } = useMakeCall();
  const { openContactPanel } = useContactPanel();

  // Global cache for instant loading
  const globalCache = useGlobalCache();
  const initialLoadDone = useRef(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [savedTaskTypes, setSavedTaskTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    // Hide address columns by default - user can toggle them on
    contactAddress: false,
    contactCity: false,
    contactState: false,
    contactZip: false,
    // propertyType is visible by default
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState({});
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [columnDropdownOpen, setColumnDropdownOpen] = useState(false);

  // Saved views state
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [currentView, setCurrentView] = useState<string>('default');
  const [defaultView, setDefaultView] = useState<string>('default');
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Create task dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    taskType: '',
    subject: '',
    description: '',
    dueDate: undefined as Date | undefined,
    priority: 'low' as 'low' | 'medium' | 'high',
    contactId: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
  });
  const [openContactSearch, setOpenContactSearch] = useState(false);
  const [openCalendar, setOpenCalendar] = useState(false);

  // Follow-up task dialog state
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [completedTask, setCompletedTask] = useState<Task | null>(null);
  const [openFollowUpCalendar, setOpenFollowUpCalendar] = useState(false);
  const [followUpTask, setFollowUpTask] = useState({
    subject: '',
    dueDate: undefined as Date | undefined,
    priority: 'medium' as 'low' | 'medium' | 'high',
  });

  // Edit task dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTaskForm, setEditTaskForm] = useState({
    taskType: '',
    subject: '',
    description: '',
    dueDate: undefined as Date | undefined,
    priority: 'low' as 'low' | 'medium' | 'high',
    contactId: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
  });
  const [openEditCalendar, setOpenEditCalendar] = useState(false);
  const [openEditContactSearch, setOpenEditContactSearch] = useState(false);

  // Filter state - multi-select filters
  const [dueDateFilter, setDueDateFilter] = useState<string[]>([]); // Empty = all dates, multi-select
  const [taskTypeFilter, setTaskTypeFilter] = useState<string[]>([]); // Empty = all types, multi-select
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('open'); // Default to 'open' tasks
  const [priorityFilter, setPriorityFilter] = useState<string[]>(['low', 'medium', 'high']); // Multi-select
  const [assignedUserFilter, setAssignedUserFilter] = useState<string[]>([]); // Empty = all users, multi-select
  const [users, setUsers] = useState<UserOption[]>([]);

  // Available tags for tag editing
  const [availableTags, setAvailableTags] = useState<TaskTag[]>([]);

  useEffect(() => {
    loadData();
    loadSavedViews();
    loadUsers();
    loadAvailableTags();
  }, []);

  // Load available tags
  const loadAvailableTags = async () => {
    try {
      const res = await fetch('/api/tags');
      if (res.ok) {
        const data = await res.json();
        setAvailableTags(data.tags || []);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  // Load users for filter dropdown
  const loadUsers = async () => {
    try {
      const response = await fetch('/api/users/list');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  // Register callback to refresh tasks when a task is created via global modal
  useEffect(() => {
    setOnTaskCreated(() => {
      loadData(true);
    });
    return () => {
      setOnTaskCreated(undefined);
    };
  }, [setOnTaskCreated]);

  // Handle initiating a call using multi-call system
  const handleInitiateCall = async (phone: string, contactId?: string, contactName?: string) => {
    if (!phone) {
      toast.error('No phone number available');
      return;
    }
    await makeCall({
      phoneNumber: phone,
      contactId,
      contactName,
    });
  };

  // Load saved views from localStorage
  const loadSavedViews = () => {
    try {
      const saved = localStorage.getItem('tasks_saved_views');
      const savedDefault = localStorage.getItem('tasks_default_view');
      const savedDefaultViewState = localStorage.getItem('tasks_default_view_state');

      if (saved) {
        const views = JSON.parse(saved);
        setSavedViews(views);

        // Load default view if set to a custom view
        if (savedDefault && savedDefault !== 'default') {
          const defaultViewData = views.find((v: any) => v.name === savedDefault);
          if (defaultViewData) {
            setColumnVisibility(defaultViewData.columnVisibility || {});
            setColumnSizing(defaultViewData.columnSizing || {});
            setColumnFilters(defaultViewData.columnFilters || []);
            setSorting(defaultViewData.sorting || []);
            setColumnOrder(defaultViewData.columnOrder || []);
            setCurrentView(savedDefault);
          }
        } else if (savedDefaultViewState) {
          // Load saved default view state
          const defaultState = JSON.parse(savedDefaultViewState);
          setColumnVisibility(defaultState.columnVisibility || {});
          setColumnSizing(defaultState.columnSizing || {});
          setColumnFilters(defaultState.columnFilters || []);
          setSorting(defaultState.sorting || []);
          setColumnOrder(defaultState.columnOrder || []);
        }
      } else if (savedDefaultViewState) {
        // No custom views but default state exists
        const defaultState = JSON.parse(savedDefaultViewState);
        setColumnVisibility(defaultState.columnVisibility || {});
        setColumnSizing(defaultState.columnSizing || {});
        setColumnFilters(defaultState.columnFilters || []);
        setSorting(defaultState.sorting || []);
        setColumnOrder(defaultState.columnOrder || []);
      }

      if (savedDefault) {
        setDefaultView(savedDefault);
      }
    } catch (error) {
      console.error('Error loading saved views:', error);
    }
  };

  // Auto-save default view state when it changes
  useEffect(() => {
    if (currentView === 'default') {
      const defaultState = {
        columnVisibility,
        columnSizing,
        columnFilters,
        sorting,
        columnOrder,
      };
      localStorage.setItem('tasks_default_view_state', JSON.stringify(defaultState));
    }
  }, [currentView, columnVisibility, columnSizing, columnFilters, sorting, columnOrder]);

  // Save current view
  const saveView = (viewName: string) => {
    const view = {
      name: viewName,
      columnVisibility,
      columnSizing,
      columnFilters,
      sorting,
      columnOrder,
    };
    const updated = [...savedViews.filter(v => v.name !== viewName), view];
    setSavedViews(updated);
    localStorage.setItem('tasks_saved_views', JSON.stringify(updated));
    setCurrentView(viewName);
    toast.success(`View "${viewName}" saved`);
  };

  // Load a saved view
  const loadView = (viewName: string) => {
    const view = savedViews.find(v => v.name === viewName);
    if (view) {
      setColumnVisibility(view.columnVisibility || {});
      setColumnSizing(view.columnSizing || {});
      setColumnFilters(view.columnFilters || []);
      setSorting(view.sorting || []);
      setColumnOrder(view.columnOrder || []);
      setCurrentView(viewName);
      toast.success(`View "${viewName}" loaded`);
    }
  };

  // Set default view
  const setAsDefaultView = (viewName: string) => {
    setDefaultView(viewName);
    localStorage.setItem('tasks_default_view', viewName);
    toast.success(`"${viewName}" set as default view`);
  };

  // Delete a saved view
  const deleteView = (viewName: string) => {
    const updated = savedViews.filter(v => v.name !== viewName);
    setSavedViews(updated);
    localStorage.setItem('tasks_saved_views', JSON.stringify(updated));
    if (currentView === viewName) {
      setCurrentView('default');
    }
    if (defaultView === viewName) {
      setDefaultView('default');
      localStorage.setItem('tasks_default_view', 'default');
    }
    toast.success(`View "${viewName}" deleted`);
  };

  // Inline editing functions
  const startEditing = (rowId: string, columnId: string, currentValue: any) => {
    console.log('[INLINE EDIT] Starting edit:', { rowId, columnId, currentValue });
    setEditingCell({ rowId, columnId });
    setEditValue(currentValue?.toString() || '');
  };

  const cancelEditing = () => {
    console.log('[INLINE EDIT] Canceling edit');
    setEditingCell(null);
    setEditValue('');
  };

  // State for inline date picker
  const [editingDateCell, setEditingDateCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<Date | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // State for inline task type picker
  const [editingTypeCell, setEditingTypeCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  // State for inline priority picker
  const [editingPriorityCell, setEditingPriorityCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);

  const saveEdit = async (rowId: string, columnId: string) => {
    try {
      const task = tasks.find(t => t.id === rowId);
      if (!task) return;

      // Map column ID to API field
      const fieldMap: Record<string, string> = {
        taskType: 'taskType',
        subject: 'subject',
        description: 'description',
        priority: 'priority',
        status: 'status',
      };

      const apiField = fieldMap[columnId];
      if (!apiField) {
        toast.error('Cannot edit this field');
        return;
      }

      console.log('[TASK EDIT] Saving:', { rowId, columnId, apiField, editValue });

      // Update task via API
      const response = await fetch(`/api/tasks/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [apiField]: editValue }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[TASK EDIT] Success:', result);

        // Update local state with the returned task data
        if (result.task) {
          setTasks(prevTasks =>
            prevTasks.map(t => t.id === rowId ? result.task : t)
          );
        } else {
          // Fallback: update just the changed field
          setTasks(prevTasks =>
            prevTasks.map(t =>
              t.id === rowId ? { ...t, [columnId]: editValue } : t
            )
          );
        }
        toast.success('Task updated');
        cancelEditing();
      } else {
        const error = await response.json();
        console.error('[TASK EDIT] Error:', error);
        toast.error(error.error || 'Failed to update task');
      }
    } catch (error) {
      console.error('[TASK EDIT] Exception:', error);
      toast.error('Failed to update task');
    }
  };

  const loadData = async (forceRefresh = false) => {
    try {
      // INSTANT LOAD: Use cached data immediately if available
      const cachedTasks = globalCache.getCached<Task[]>('tasks');
      const cachedContacts = globalCache.getCached<Contact[]>('contacts');

      if (cachedTasks && cachedTasks.length > 0 && !forceRefresh) {
        setTasks(cachedTasks);
        setIsLoading(false);
        // Background refresh if cache is stale
        if (!globalCache.isCacheFresh('tasks')) {
          fetchFreshData(false); // Don't show loading for background refresh
        }
        if (cachedContacts) setContacts(cachedContacts);
        return;
      }

      setIsLoading(true);
      await fetchFreshData(true);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFreshData = async (showLoading: boolean) => {
    try {
      const [tasksRes, contactsRes, taskTypesRes] = await Promise.all([
        fetch('/api/tasks', { cache: 'no-store' }),
        fetch('/api/contacts?limit=1000', { cache: 'force-cache' }),
        fetch('/api/settings/task-types', { cache: 'force-cache' }),
      ]);

      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        const tasksList = tasksData.tasks || [];
        setTasks(tasksList);
        globalCache.setTasks(tasksList); // Update global cache
      }

      if (contactsRes && contactsRes.ok) {
        const contactsData = await contactsRes.json();
        const contactsList = contactsData.contacts || [];
        setContacts(contactsList);
        globalCache.setContacts(contactsList); // Update global cache
      }

      if (taskTypesRes.ok) {
        const taskTypesData = await taskTypesRes.json();
        setSavedTaskTypes(taskTypesData.taskTypes || []);
      }
    } catch (error) {
      console.error('Error fetching fresh data:', error);
    }
  };

  const createTask = async () => {
    if (!newTask.subject.trim()) {
      toast.error('Please enter a task subject');
      return;
    }

    try {
      console.log('Creating task with data:', newTask);

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask),
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('Task created:', data);
        toast.success('Task created successfully');
        setIsCreateDialogOpen(false);
        setNewTask({
          taskType: '',
          subject: '',
          description: '',
          dueDate: undefined,
          priority: 'low',
          contactId: '',
          contactName: '',
          contactPhone: '',
          contactEmail: '',
        });
        loadData();
      } else {
        const errorData = await response.json();
        console.error('Task creation error:', errorData);
        toast.error(errorData.error || 'Failed to create task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task: ' + (error as Error).message);
    }
  };

  const toggleTaskStatus = async (taskId: string, currentStatus: string) => {
    try {
      const newStatus: 'open' | 'completed' = currentStatus === 'open' ? 'completed' : 'open';

      // Find the task being completed
      const task = filteredTasks.find(t => t.id === taskId);

      // INSTANT UPDATE - Update UI immediately without waiting for API
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.id === taskId ? { ...t, status: newStatus } : t
        )
      );
      // Also update global cache for instant cross-page updates
      globalCache.updateTask(taskId, { status: newStatus });

      // Show instant feedback
      toast.success(`Task marked as ${newStatus}`, {
        duration: 2000,
      });

      // Update in background
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        // Revert on error
        const revertStatus: 'open' | 'completed' = currentStatus as 'open' | 'completed';
        setTasks(prevTasks =>
          prevTasks.map(t =>
            t.id === taskId ? { ...t, status: revertStatus } : t
          )
        );
        globalCache.updateTask(taskId, { status: revertStatus });
        toast.error('Failed to update task');
        return;
      }

      // If completing a task, show follow-up dialog (like Pipedrive)
      if (newStatus === 'completed' && task) {
        setCompletedTask(task);
        setFollowUpTask({
          subject: `Follow up: ${task.subject}`,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          priority: 'low', // Default follow-up tasks to low priority
        });
        setShowFollowUpDialog(true);
      }
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  // Create follow-up task from dialog
  const createFollowUpTask = async () => {
    if (!completedTask) return;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: followUpTask.subject,
          description: `Follow-up task for: ${completedTask.subject}`,
          contactId: completedTask.contactId,
          contactName: completedTask.contactName,
          contactPhone: completedTask.contactPhone,
          contactEmail: completedTask.contactEmail,
          dueDate: followUpTask.dueDate?.toISOString(),
          priority: followUpTask.priority,
          status: 'open',
          taskType: completedTask.taskType || 'Follow Up',
        }),
      });

      if (response.ok) {
        const newFollowUpTask = await response.json();

        // Add new follow-up task to the list instantly
        setTasks(prevTasks => [...prevTasks, newFollowUpTask]);

        toast.success('Follow-up task created! 📅', {
          duration: 3000,
        });

        setShowFollowUpDialog(false);
        setCompletedTask(null);
      } else {
        toast.error('Failed to create follow-up task');
      }
    } catch (error) {
      console.error('Error creating follow-up task:', error);
      toast.error('Failed to create follow-up task');
    }
  };

  // Open edit dialog for a task
  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    setEditTaskForm({
      taskType: task.taskType || '',
      subject: task.subject,
      description: task.description || '',
      dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
      priority: task.priority,
      contactId: task.contactId || '',
      contactName: task.contactName || '',
      contactPhone: task.contactPhone || '',
      contactEmail: task.contactEmail || '',
    });
    setIsEditDialogOpen(true);
  };

  // Save edited task
  const saveEditedTask = async () => {
    if (!editingTask) return;

    try {
      const response = await fetch(`/api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: editTaskForm.taskType,
          subject: editTaskForm.subject,
          description: editTaskForm.description,
          dueDate: editTaskForm.dueDate?.toISOString(),
          priority: editTaskForm.priority,
          contactId: editTaskForm.contactId || null,
          contactName: editTaskForm.contactName || null,
          contactPhone: editTaskForm.contactPhone || null,
          contactEmail: editTaskForm.contactEmail || null,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Update task in list
        if (result.task) {
          setTasks(prevTasks =>
            prevTasks.map(t => t.id === editingTask.id ? result.task : t)
          );
        } else {
          setTasks(prevTasks =>
            prevTasks.map(t => t.id === editingTask.id ? {
              ...t,
              taskType: editTaskForm.taskType,
              subject: editTaskForm.subject,
              description: editTaskForm.description,
              dueDate: editTaskForm.dueDate?.toISOString(),
              priority: editTaskForm.priority,
              contactId: editTaskForm.contactId,
              contactName: editTaskForm.contactName,
              contactPhone: editTaskForm.contactPhone,
              contactEmail: editTaskForm.contactEmail,
            } : t)
          );
        }
        toast.success('Task updated successfully');
        setIsEditDialogOpen(false);
        setEditingTask(null);
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update task');
      }
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  // Column display names mapping for Toggle Columns dropdown
  const columnDisplayNames: Record<string, string> = {
    select: 'Select',
    status: 'Status',
    taskType: 'Task Type',
    subject: 'Subject',
    description: 'Description',
    contactName: 'Contact Name',
    contactPhone: 'Phone',
    contactEmail: 'Email',
    dueDate: 'Due Date',
    priority: 'Priority',
    tags: 'Tags',
    contactAddress: 'Address',
    contactCity: 'City',
    contactState: 'State',
    contactZip: 'ZIP',
    propertyType: 'Property Type',
    activityHistory: 'Activity History',
    actions: 'Actions',
  };

  // Define columns
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => toggleTaskStatus(row.original.id, status)}
            >
              {status === 'completed' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          );
        },
        size: 60,
      },
      {
        accessorKey: 'taskType',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-8 px-2"
            >
              Type
              {column.getIsSorted() === 'asc' ? (
                <ChevronUp className="ml-2 h-4 w-4" />
              ) : column.getIsSorted() === 'desc' ? (
                <ChevronDown className="ml-2 h-4 w-4" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              )}
            </Button>
          );
        },
        cell: ({ row }) => {
          const isEditing = editingTypeCell?.rowId === row.original.id && editingTypeCell?.columnId === 'taskType';
          if (isEditing) {
            return (
              <Select
                open={typePickerOpen}
                onOpenChange={setTypePickerOpen}
                value={row.original.taskType || 'General'}
                onValueChange={async (value) => {
                  try {
                    console.log('[TASK TYPE] Updating task:', row.original.id, 'to:', value);
                    const response = await fetch(`/api/tasks/${row.original.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskType: value }),
                    });

                    if (response.ok) {
                      const result = await response.json();
                      console.log('[TASK TYPE] Success:', result);

                      // Update with returned task data if available
                      if (result.task) {
                        setTasks(prevTasks =>
                          prevTasks.map(t =>
                            t.id === row.original.id ? result.task : t
                          )
                        );
                      } else {
                        // Fallback: update just the task type
                        setTasks(prevTasks =>
                          prevTasks.map(t =>
                            t.id === row.original.id ? { ...t, taskType: value } : t
                          )
                        );
                      }
                      toast.success('Task type updated');
                      setEditingTypeCell(null);
                      setTypePickerOpen(false);
                    } else {
                      const error = await response.json();
                      console.error('[TASK TYPE] Error:', error);
                      toast.error(error.error || 'Failed to update task type');
                    }
                  } catch (error) {
                    console.error('[TASK TYPE] Exception:', error);
                    toast.error('Failed to update task type');
                  }
                }}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {savedTaskTypes.length === 0 ? (
                    <SelectItem value="General">General</SelectItem>
                  ) : (
                    savedTaskTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            );
          }
          return (
            <Badge
              variant="outline"
              className="font-normal cursor-pointer hover:bg-accent"
              onClick={() => {
                console.log('[TASK TYPE] Click handler fired for task:', row.original.id);
                setEditingTypeCell({ rowId: row.original.id, columnId: 'taskType' });
                setTypePickerOpen(true);
              }}
            >
              {row.original.taskType || 'General'}
            </Badge>
          );
        },
        size: 150,
      },
      {
        accessorKey: 'subject',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-8 px-2"
            >
              Subject
              {column.getIsSorted() === 'asc' ? (
                <ChevronUp className="ml-2 h-4 w-4" />
              ) : column.getIsSorted() === 'desc' ? (
                <ChevronDown className="ml-2 h-4 w-4" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              )}
            </Button>
          );
        },
        cell: ({ row }) => {
          return (
            <EditableSubjectCell
              taskId={row.original.id}
              initialValue={row.original.subject || ''}
              onSave={async (newValue: string) => {
                try {
                  const res = await fetch(`/api/tasks/${row.original.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subject: newValue }),
                  });
                  if (!res.ok) throw new Error('Failed to update');
                  // Update local state
                  setTasks(prev => prev.map(t =>
                    t.id === row.original.id ? { ...t, subject: newValue } : t
                  ));
                  toast.success('Subject updated');
                } catch (err) {
                  console.error('Failed to save subject:', err);
                  toast.error('Failed to save subject');
                }
              }}
            />
          );
        },
        size: 300,
      },
      {
        accessorKey: 'description',
        header: 'Description',
        cell: ({ row }) => {
          return (
            <EditableDescriptionCell
              taskId={row.original.id}
              initialValue={row.original.description || ''}
              onSave={async (newValue: string) => {
                try {
                  const res = await fetch(`/api/tasks/${row.original.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: newValue }),
                  });
                  if (!res.ok) throw new Error('Failed to update');
                  const result = await res.json();
                  // Update local state
                  setTasks(prev => prev.map(t =>
                    t.id === row.original.id ? { ...t, description: newValue } : t
                  ));
                  toast.success('Description updated');
                } catch (err) {
                  console.error('Failed to save description:', err);
                  toast.error('Failed to save description');
                }
              }}
            />
          );
        },
        size: 250,
      },
      {
        accessorKey: 'contactName',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-8 px-2"
            >
              Contact
              {column.getIsSorted() === 'asc' ? (
                <ChevronUp className="ml-2 h-4 w-4" />
              ) : column.getIsSorted() === 'desc' ? (
                <ChevronDown className="ml-2 h-4 w-4" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              )}
            </Button>
          );
        },
        cell: ({ row }) => {
          const contactId = row.original.contactId;
          const contactName = row.original.contactName;

          if (!contactName) {
            return <span className="text-muted-foreground">-</span>;
          }

          return (
            <div
              className={cn(
                "flex items-center gap-2",
                contactId && "cursor-pointer hover:text-primary hover:underline"
              )}
              onClick={() => {
                if (contactId) {
                  openContactPanel(contactId);
                }
              }}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{contactName}</span>
            </div>
          );
        },
        size: 150,
        minSize: 100,
        maxSize: 300,
      },
      {
        accessorKey: 'contactPhone',
        header: 'Phone',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.contactPhone ? (
              <>
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{formatPhoneNumber(row.original.contactPhone)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        ),
        size: 180,
      },
      {
        accessorKey: 'contactEmail',
        header: 'Email',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.contactEmail ? (
              <>
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm truncate">{row.original.contactEmail}</span>
              </>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        ),
        size: 200,
      },
      {
        accessorKey: 'dueDate',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-8 px-2"
            >
              Due Date
              {column.getIsSorted() === 'asc' ? (
                <ChevronUp className="ml-2 h-4 w-4" />
              ) : column.getIsSorted() === 'desc' ? (
                <ChevronDown className="ml-2 h-4 w-4" />
              ) : (
                <ChevronsUpDown className="ml-2 h-4 w-4" />
              )}
            </Button>
          );
        },
        cell: ({ row }) => {
          const dueDate = row.original.dueDate;
          const isEditingDate = editingDateCell?.rowId === row.original.id && editingDateCell?.columnId === 'dueDate';

          const date = dueDate ? new Date(dueDate) : null;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const isOverdue = date && date < today && row.original.status === 'open';

          return (
            <Popover
              open={isEditingDate && datePickerOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setEditingDateCell(null);
                  setDatePickerOpen(false);
                }
              }}
            >
              <PopoverTrigger asChild>
                <div
                  className={cn(
                    'flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded',
                    isOverdue && 'text-red-500'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('[DUE DATE] Click handler fired for task:', row.original.id);
                    setEditingDateCell({ rowId: row.original.id, columnId: 'dueDate' });
                    setEditingDateValue(date || undefined);
                    setDatePickerOpen(true);
                  }}
                  title="Click to change due date"
                >
                  <Clock className="h-4 w-4" />
                  <span className="text-sm">{date ? format(date, 'MMM dd, yyyy') : '-'}</span>
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-[10000]" align="start" sideOffset={5}>
                <Calendar
                  mode="single"
                  selected={editingDateValue}
                  onSelect={async (newDate) => {
                    if (newDate) {
                      try {
                        console.log('[DUE DATE] Updating task:', row.original.id, 'to:', newDate.toISOString());
                        const response = await fetch(`/api/tasks/${row.original.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dueDate: newDate.toISOString() }),
                        });

                        if (response.ok) {
                          const result = await response.json();
                          console.log('[DUE DATE] Success:', result);

                          // Update with returned task data if available
                          if (result.task) {
                            setTasks(prevTasks =>
                              prevTasks.map(t =>
                                t.id === row.original.id ? result.task : t
                              )
                            );
                          } else {
                            // Fallback: update just the due date
                            setTasks(prevTasks =>
                              prevTasks.map(t =>
                                t.id === row.original.id ? { ...t, dueDate: newDate.toISOString() } : t
                              )
                            );
                          }
                          toast.success('Due date updated');
                        } else {
                          const error = await response.json();
                          console.error('[DUE DATE] Error:', error);
                          toast.error(error.error || 'Failed to update due date');
                        }
                      } catch (error) {
                        console.error('[DUE DATE] Exception:', error);
                        toast.error('Failed to update due date');
                      }
                    }
                    setEditingDateCell(null);
                    setDatePickerOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          );
        },
        size: 150,
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        cell: ({ row }) => {
          const priority = row.original.priority;
          const priorityConfig: Record<string, { label: string; className: string; dotColor: string }> = {
            high: { label: 'High', className: 'bg-red-100 text-red-800 border-red-300', dotColor: 'bg-red-500' },
            medium: { label: 'Medium', className: 'bg-yellow-100 text-yellow-800 border-yellow-300', dotColor: 'bg-yellow-500' },
            low: { label: 'Low', className: 'bg-gray-100 text-gray-800 border-gray-300', dotColor: 'bg-gray-400' },
          };
          const config = priorityConfig[priority] || priorityConfig.low;
          const isEditing = editingPriorityCell?.rowId === row.original.id && editingPriorityCell?.columnId === 'priority';

          if (isEditing) {
            return (
              <Select
                open={priorityPickerOpen}
                onOpenChange={setPriorityPickerOpen}
                value={priority || 'low'}
                onValueChange={async (value) => {
                  try {
                    console.log('[PRIORITY] Updating task:', row.original.id, 'to:', value);
                    const response = await fetch(`/api/tasks/${row.original.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ priority: value }),
                    });

                    if (response.ok) {
                      const result = await response.json();
                      console.log('[PRIORITY] Success:', result);

                      // Update with returned task data if available
                      if (result.task) {
                        setTasks(prevTasks =>
                          prevTasks.map(t =>
                            t.id === row.original.id ? result.task : t
                          )
                        );
                      } else {
                        // Fallback: update just the priority (cast to proper type)
                        setTasks(prevTasks =>
                          prevTasks.map(t =>
                            t.id === row.original.id ? { ...t, priority: value as 'low' | 'medium' | 'high' } : t
                          )
                        );
                      }
                      toast.success('Priority updated');
                      setEditingPriorityCell(null);
                      setPriorityPickerOpen(false);
                    } else {
                      const error = await response.json();
                      console.error('[PRIORITY] Error:', error);
                      toast.error(error.error || 'Failed to update priority');
                    }
                  } catch (error) {
                    console.error('[PRIORITY] Exception:', error);
                    toast.error('Failed to update priority');
                  }
                }}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                      Low
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                      High
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            );
          }

          return (
            <Badge
              variant="outline"
              className={cn(config.className, 'cursor-pointer hover:opacity-80')}
              onClick={() => {
                console.log('[PRIORITY] Click handler fired for task:', row.original.id);
                setEditingPriorityCell({ rowId: row.original.id, columnId: 'priority' });
                setPriorityPickerOpen(true);
              }}
              title="Click to change priority"
            >
              <span className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', config.dotColor)}></span>
                {config.label}
              </span>
            </Badge>
          );
        },
        size: 120,
      },
      {
        id: 'tags',
        header: 'Tags',
        cell: ({ row }) => {
          const tags = row.original.tags || [];
          const [tagPopoverOpen, setTagPopoverOpen] = React.useState(false);
          const [tagSearch, setTagSearch] = React.useState('');
          const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>(
            tags.map((t: TaskTag) => t.id)
          );

          // Sync selectedTagIds when tags change
          React.useEffect(() => {
            setSelectedTagIds(tags.map((t: TaskTag) => t.id));
          }, [tags]);

          const filteredTags = React.useMemo(() => {
            if (!tagSearch) return availableTags;
            return availableTags.filter(t =>
              t.name.toLowerCase().includes(tagSearch.toLowerCase())
            );
          }, [tagSearch]);

          const handleTagToggle = async (tagId: string, checked: boolean) => {
            try {
              const newSelectedIds = checked
                ? [...selectedTagIds, tagId]
                : selectedTagIds.filter(id => id !== tagId);

              setSelectedTagIds(newSelectedIds);

              const selectedTags = availableTags.filter(t => newSelectedIds.includes(t.id));
              const response = await fetch(`/api/tasks/${row.original.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tags: selectedTags.map(t => ({ id: t.id, name: t.name, color: t.color }))
                }),
              });
              if (response.ok) {
                toast.success('Tag updated');
                setTasks(prevTasks =>
                  prevTasks.map(task =>
                    task.id === row.original.id
                      ? { ...task, tags: selectedTags }
                      : task
                  )
                );
              }
            } catch (error) {
              toast.error('Failed to update tag');
            }
          };

          return (
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <div className="flex flex-wrap gap-1 cursor-pointer min-h-[24px] hover:bg-accent/50 rounded px-1 py-0.5">
                  {tags.length === 0 ? (
                    <span className="text-muted-foreground text-xs flex items-center gap-1">
                      <Plus className="h-3 w-3" /> Add tag
                    </span>
                  ) : (
                    <>
                      {tags.slice(0, 2).map((tag: TaskTag) => (
                        <Badge
                          key={tag.id}
                          variant="outline"
                          style={{
                            backgroundColor: `${tag.color}20`,
                            borderColor: tag.color,
                            color: tag.color,
                          }}
                          className="text-xs"
                        >
                          {tag.name}
                        </Badge>
                      ))}
                      {tags.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{tags.length - 2}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="space-y-2">
                  <Input
                    placeholder="Search tags..."
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    className="h-8"
                    autoFocus
                  />
                  <ScrollArea className="h-48">
                    <div className="space-y-1">
                      {filteredTags.map((tag) => (
                        <div
                          key={tag.id}
                          className="flex items-center gap-2 p-1.5 hover:bg-accent rounded cursor-pointer"
                          onClick={() => handleTagToggle(tag.id, !selectedTagIds.includes(tag.id))}
                        >
                          <Checkbox
                            checked={selectedTagIds.includes(tag.id)}
                            onCheckedChange={(checked) => handleTagToggle(tag.id, !!checked)}
                          />
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="text-sm truncate">{tag.name}</span>
                        </div>
                      ))}
                      {filteredTags.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-2">No tags found</p>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </PopoverContent>
            </Popover>
          );
        },
        size: 180,
      },
      {
        accessorKey: 'contactAddress',
        header: 'Address',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          return (
            <div className="text-sm">
              {contact?.address || <span className="text-muted-foreground">-</span>}
            </div>
          );
        },
        size: 250,
      },
      {
        accessorKey: 'contactCity',
        header: 'City',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          return (
            <div className="text-sm">
              {contact?.city || <span className="text-muted-foreground">-</span>}
            </div>
          );
        },
        size: 150,
      },
      {
        accessorKey: 'contactState',
        header: 'State',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          return (
            <div className="text-sm">
              {contact?.state || <span className="text-muted-foreground">-</span>}
            </div>
          );
        },
        size: 80,
      },
      {
        accessorKey: 'contactZip',
        header: 'ZIP',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          return (
            <div className="text-sm">
              {contact?.zip || <span className="text-muted-foreground">-</span>}
            </div>
          );
        },
        size: 100,
      },
      {
        accessorKey: 'propertyType',
        header: 'Property Type',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          return contact?.propertyType ? (
            <Badge variant="outline">{normalizePropertyType(contact.propertyType)}</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
        size: 150,
      },
      {
        id: 'activityHistory',
        header: 'Activity History',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          const contactName = row.original.contactName || `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim();
          return (
            <ActivityHistoryCell
              contactId={row.original.contactId}
              contactName={contactName}
            />
          );
        },
        size: 150,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const contact = contacts.find((c) => c.id === row.original.contactId);
          // Use task's contact info as fallback if contact lookup fails
          const phone = contact?.phone1 || row.original.contactPhone;
          const email = contact?.email1 || contact?.email || row.original.contactEmail;
          const contactName = row.original.contactName || `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim();
          const contactId = contact?.id || row.original.contactId;

          return (
            <div className="flex items-center gap-1">
              {phone ? (
                <CallButtonWithCellHover
                  phoneNumber={phone}
                  contactId={contactId}
                  contactName={contactName}
                  onWebRTCCall={() => handleInitiateCall(phone, contactId, contactName)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8"
                  iconClassName="h-4 w-4"
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  disabled
                  title="No phone number"
                >
                  <Phone className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (phone) {
                    openSms({
                      phoneNumber: phone,
                      contact: contactId ? { id: contactId } : undefined,
                    });
                  } else {
                    toast.error('No phone number available');
                  }
                }}
                title="Text"
                disabled={!phone}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  if (email) {
                    openEmail({
                      email: email,
                      contact: contactId ? { id: contactId } : undefined,
                    });
                  } else {
                    toast.error('No email available');
                  }
                }}
                title="Email"
                disabled={!email}
              >
                <Mail className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  openTask({
                    contact: contactId ? {
                      id: contactId,
                      firstName: contact?.firstName || contactName.split(' ')[0] || '',
                      lastName: contact?.lastName || contactName.split(' ').slice(1).join(' ') || '',
                      email1: email,
                      phone1: phone,
                    } : undefined,
                    contactId: contactId,
                  });
                }}
                title="Create Task"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          );
        },
        enableSorting: false,
        size: 180,
      },
    ],
    [
      contacts,
      tasks,
      editingCell,
      editValue,
      editingTypeCell,
      typePickerOpen,
      editingDateCell,
      datePickerOpen,
      editingDateValue,
      editingPriorityCell,
      priorityPickerOpen,
      savedTaskTypes,
    ]
  );

  // Filter tasks based on filters
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // Apply task type filter (multi-select)
    if (taskTypeFilter.length > 0) {
      filtered = filtered.filter((task) => taskTypeFilter.includes(task.taskType || ''));
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((task) => task.status === statusFilter);
    }

    // Apply due date filter (multi-select - OR logic)
    if (dueDateFilter.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      filtered = filtered.filter((task) => {
        if (!task.dueDate) return false;
        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);

        // Check if task matches ANY of the selected date filters (OR logic)
        return dueDateFilter.some((filterType) => {
          switch (filterType) {
            case 'overdue':
              return dueDate < today && task.status === 'open';
            case 'today':
              return dueDate.getTime() === today.getTime();
            case 'week':
              const weekFromNow = new Date(today);
              weekFromNow.setDate(weekFromNow.getDate() + 7);
              return dueDate >= today && dueDate <= weekFromNow;
            case 'month':
              const monthFromNow = new Date(today);
              monthFromNow.setMonth(monthFromNow.getMonth() + 1);
              return dueDate >= today && dueDate <= monthFromNow;
            default:
              return true;
          }
        });
      });
    }

    // Apply priority filter
    if (priorityFilter.length > 0 && priorityFilter.length < 3) {
      filtered = filtered.filter((task) => priorityFilter.includes(task.priority));
    }

    // Apply assigned user filter (multi-select - OR logic)
    if (assignedUserFilter.length > 0) {
      filtered = filtered.filter((task) => assignedUserFilter.includes(task.assignedToId || ''));
    }

    return filtered;
  }, [tasks, taskTypeFilter, dueDateFilter, statusFilter, priorityFilter, assignedUserFilter]);

  const table = useReactTable({
    data: filteredTasks,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
      columnSizing,
      columnOrder,
    },
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange', // Real-time resize feedback as you drag
    columnResizeDirection: 'ltr', // Only resize the column being dragged, not others
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 100,
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">Manage all your tasks in one place</p>
        </div>
        <Button onClick={() => openTask()}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-64"
          />
        </div>
        {/* Task Type Filter - Multi-select */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-48 justify-between">
              {taskTypeFilter.length === 0 ? 'All Types' : taskTypeFilter.length === 1 ? taskTypeFilter[0] : `${taskTypeFilter.length} Types`}
              <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
            <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Only show task types from Settings - no hardcoded types */}
            {savedTaskTypes.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No task types configured
              </div>
            ) : (
              savedTaskTypes.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={taskTypeFilter.includes(type)}
                  onCheckedChange={(checked) => {
                    setTaskTypeFilter(
                      checked
                        ? [...taskTypeFilter, type]
                        : taskTypeFilter.filter((t) => t !== type)
                    );
                  }}
                >
                  {type}
                </DropdownMenuCheckboxItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="justify-center text-muted-foreground cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                setTaskTypeFilter([]);
              }}
            >
              Reset
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {/* Due Date Filter - Multi-select */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-40 justify-between">
              {dueDateFilter.length === 0 ? 'All Dates' : dueDateFilter.length === 1 ?
                (dueDateFilter[0] === 'overdue' ? 'Overdue' :
                 dueDateFilter[0] === 'today' ? 'Today' :
                 dueDateFilter[0] === 'week' ? 'This Week' : 'This Month')
                : `${dueDateFilter.length} Selected`}
              <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter by Due Date</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={dueDateFilter.includes('overdue')}
              onCheckedChange={(checked) => {
                setDueDateFilter(
                  checked
                    ? [...dueDateFilter, 'overdue']
                    : dueDateFilter.filter((d) => d !== 'overdue')
                );
              }}
            >
              Overdue
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dueDateFilter.includes('today')}
              onCheckedChange={(checked) => {
                setDueDateFilter(
                  checked
                    ? [...dueDateFilter, 'today']
                    : dueDateFilter.filter((d) => d !== 'today')
                );
              }}
            >
              Today
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dueDateFilter.includes('week')}
              onCheckedChange={(checked) => {
                setDueDateFilter(
                  checked
                    ? [...dueDateFilter, 'week']
                    : dueDateFilter.filter((d) => d !== 'week')
                );
              }}
            >
              This Week
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dueDateFilter.includes('month')}
              onCheckedChange={(checked) => {
                setDueDateFilter(
                  checked
                    ? [...dueDateFilter, 'month']
                    : dueDateFilter.filter((d) => d !== 'month')
                );
              }}
            >
              This Month
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setDueDateFilter([])}
            >
              Reset
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority Filter - Multi-select with color badges */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Priority
              {priorityFilter.length < 3 && (
                <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                  {priorityFilter.length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter by Priority</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={priorityFilter.includes('high')}
              onCheckedChange={(checked) => {
                setPriorityFilter(
                  checked
                    ? [...priorityFilter, 'high']
                    : priorityFilter.filter((p) => p !== 'high')
                );
              }}
            >
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                High
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={priorityFilter.includes('medium')}
              onCheckedChange={(checked) => {
                setPriorityFilter(
                  checked
                    ? [...priorityFilter, 'medium']
                    : priorityFilter.filter((p) => p !== 'medium')
                );
              }}
            >
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                Medium
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={priorityFilter.includes('low')}
              onCheckedChange={(checked) => {
                setPriorityFilter(
                  checked
                    ? [...priorityFilter, 'low']
                    : priorityFilter.filter((p) => p !== 'low')
                );
              }}
            >
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-300"></span>
                Low
              </span>
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setPriorityFilter(['low', 'medium', 'high'])}
            >
              Reset
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assigned User Filter - Multi-select */}
        {users.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-40 justify-between">
                {assignedUserFilter.length === 0 ? 'All Users' :
                 assignedUserFilter.length === 1 ?
                   users.find(u => u.id === assignedUserFilter[0])?.name || 'User' :
                   `${assignedUserFilter.length} Users`}
                <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
              <DropdownMenuLabel>Filter by Assigned User</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {users.map((user) => (
                <DropdownMenuCheckboxItem
                  key={user.id}
                  checked={assignedUserFilter.includes(user.id)}
                  onCheckedChange={(checked) => {
                    setAssignedUserFilter(
                      checked
                        ? [...assignedUserFilter, user.id]
                        : assignedUserFilter.filter((id) => id !== user.id)
                    );
                  }}
                >
                  <span className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {user.name}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setAssignedUserFilter([])}
              >
                Reset
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Column Visibility */}
        <DropdownMenu open={columnDropdownOpen} onOpenChange={setColumnDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-2" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">Toggle Columns</DropdownMenuLabel>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => setColumnDropdownOpen(false)}
              >
                Done
              </Button>
            </div>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {columnDisplayNames[column.id] || column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Save Views */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="h-4 w-4 mr-2" />
              Views {currentView !== 'default' && `(${currentView})`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={currentView === 'default'}
              onCheckedChange={() => {
                // Load saved default view state or use hardcoded defaults
                try {
                  const savedDefaultState = localStorage.getItem('tasks_default_view_state');
                  if (savedDefaultState) {
                    const defaultState = JSON.parse(savedDefaultState);
                    setColumnVisibility(defaultState.columnVisibility || {});
                    setColumnSizing(defaultState.columnSizing || {});
                    setColumnFilters(defaultState.columnFilters || []);
                    setSorting(defaultState.sorting || []);
                    setColumnOrder(defaultState.columnOrder || []);
                  } else {
                    // Fallback to original defaults
                    setColumnVisibility({
                      contactAddress: false,
                      contactCity: false,
                      contactState: false,
                      contactZip: false,
                    });
                  }
                } catch {
                  // On error, use hardcoded defaults
                  setColumnVisibility({
                    contactAddress: false,
                    contactCity: false,
                    contactState: false,
                    contactZip: false,
                  });
                }
                setCurrentView('default');
              }}
            >
              Default View {defaultView === 'default' && '⭐'}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <div className="p-2 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setNewViewName('');
                  setShowSaveViewDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Save Current View
              </Button>
              {currentView === 'default' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    // Save current state as the default view state
                    const currentState = {
                      columnVisibility,
                      columnSizing,
                      columnFilters,
                      sorting,
                      columnOrder,
                    };
                    localStorage.setItem('tasks_default_view_state', JSON.stringify(currentState));
                    toast.success('Current settings saved as default');
                  }}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save as Default
                </Button>
              )}
            </div>
            {savedViews.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">My Views</DropdownMenuLabel>
                {savedViews.map((view) => (
                  <div key={view.name} className="space-y-1">
                    <div className="flex items-center justify-between px-2 py-1 hover:bg-muted rounded">
                      <button
                        className={`flex-1 text-left text-sm px-2 py-1 rounded ${
                          currentView === view.name
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => loadView(view.name)}
                      >
                        {view.name} {defaultView === view.name && '⭐'}
                      </button>
                      <button
                        className="text-destructive hover:text-destructive/80 px-2"
                        onClick={() => deleteView(view.name)}
                      >
                        ×
                      </button>
                    </div>
                    {defaultView !== view.name && (
                      <button
                        className="w-full text-xs text-left px-4 py-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                        onClick={() => setAsDefaultView(view.name)}
                      >
                        Set as Default
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto text-sm text-muted-foreground">
          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {table.getFilteredSelectedRowModel().rows.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-medium text-blue-900">
              {table.getFilteredSelectedRowModel().rows.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.resetRowSelection()}
              className="text-blue-600 hover:text-blue-800"
            >
              Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {/* Bulk Status Change */}
            <Select
              onValueChange={async (newStatus) => {
                const selectedIds = table.getFilteredSelectedRowModel().rows.map(r => r.original.id);
                try {
                  const response = await fetch('/api/activities/bulk-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskIds: selectedIds, updates: { status: newStatus } })
                  });
                  if (response.ok) {
                    setTasks(prev => prev.map(t =>
                      selectedIds.includes(t.id) ? { ...t, status: newStatus as 'open' | 'completed' } : t
                    ));
                    table.resetRowSelection();
                    toast.success(`Updated ${selectedIds.length} tasks`);
                  }
                } catch (error) {
                  toast.error('Failed to update tasks');
                }
              }}
            >
              <SelectTrigger className="w-36 h-8">
                <SelectValue placeholder="Change Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>

            {/* Bulk Priority Change */}
            <Select
              onValueChange={async (newPriority) => {
                const selectedIds = table.getFilteredSelectedRowModel().rows.map(r => r.original.id);
                try {
                  const response = await fetch('/api/activities/bulk-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskIds: selectedIds, updates: { priority: newPriority } })
                  });
                  if (response.ok) {
                    setTasks(prev => prev.map(t =>
                      selectedIds.includes(t.id) ? { ...t, priority: newPriority as 'low' | 'medium' | 'high' } : t
                    ));
                    table.resetRowSelection();
                    toast.success(`Updated ${selectedIds.length} tasks`);
                  }
                } catch (error) {
                  toast.error('Failed to update tasks');
                }
              }}
            >
              <SelectTrigger className="w-40 h-8">
                <SelectValue placeholder="Change Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="medium">Medium Priority</SelectItem>
                <SelectItem value="low">Low Priority</SelectItem>
              </SelectContent>
            </Select>

            {/* Bulk Delete */}
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const selectedIds = table.getFilteredSelectedRowModel().rows.map(r => r.original.id);
                if (!confirm(`Delete ${selectedIds.length} task(s)?`)) return;

                try {
                  const response = await fetch('/api/activities/bulk-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskIds: selectedIds })
                  });
                  if (response.ok) {
                    setTasks(prev => prev.filter(t => !selectedIds.includes(t.id)));
                    table.resetRowSelection();
                    toast.success(`Deleted ${selectedIds.length} tasks`);
                  }
                } catch (error) {
                  toast.error('Failed to delete tasks');
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-auto max-h-[calc(100vh-350px)] min-h-[400px]" style={{ overflowX: 'auto', overflowY: 'auto' }}>
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead className="bg-muted/50 sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`border-r border-b px-1.5 py-1 text-left text-xs font-medium relative group ${
                      draggedColumn === header.id ? 'opacity-50 bg-primary/20' : ''
                    }`}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedId = e.dataTransfer.getData('text/plain');
                      if (draggedId === header.id) return;

                      const currentOrder = columnOrder.length > 0
                        ? columnOrder
                        : table.getAllLeafColumns().map(c => c.id);

                      const draggedIndex = currentOrder.indexOf(draggedId);
                      const targetIndex = currentOrder.indexOf(header.id);

                      if (draggedIndex === -1 || targetIndex === -1) return;

                      const newOrder = [...currentOrder];
                      newOrder.splice(draggedIndex, 1);
                      newOrder.splice(targetIndex, 0, draggedId);

                      setColumnOrder(newOrder);
                      setDraggedColumn(null);
                    }}
                  >
                    {header.isPlaceholder ? null : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {header.id !== 'select' && (
                            <div
                              draggable
                              onDragStart={(e) => {
                                setDraggedColumn(header.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', header.id);
                                e.stopPropagation();
                              }}
                              onDragEnd={() => {
                                setDraggedColumn(null);
                              }}
                              className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-gray-100 rounded"
                              title="Drag to reorder column"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <GripVertical className="h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100" />
                            </div>
                          )}
                          <div
                            className={`flex items-center gap-2 ${
                              header.column.getCanSort() ? 'cursor-pointer select-none' : ''
                            }`}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <span className="text-muted-foreground">
                                {{
                                  asc: <ChevronUp className="h-4 w-4" />,
                                  desc: <ChevronDown className="h-4 w-4" />,
                                }[header.column.getIsSorted() as string] ?? (
                                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                      </div>
                    )}
                    {/* Resize Handle - Excel-like column resizer */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => {
                          // Auto-fit column width on double-click (like Excel)
                          const optimalWidth = autoFitColumn(header.column, filteredTasks, 80, 600);
                          setColumnSizing((prev) => ({
                            ...prev,
                            [header.column.id]: optimalWidth,
                          }));
                        }}
                        className={`absolute right-0 top-0 h-full cursor-col-resize select-none touch-none group/resize z-10 ${
                          header.column.getIsResizing() ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-400'
                        }`}
                        style={{
                          // Make the clickable area wider for easier grabbing
                          width: header.column.getIsResizing() ? '3px' : '8px',
                          marginRight: header.column.getIsResizing() ? '0' : '-4px',
                        }}
                        title="Drag to resize, double-click to auto-fit"
                      >
                        {/* Visual indicator on hover */}
                        <div className="absolute inset-0 bg-blue-500 opacity-0 group-hover/resize:opacity-50 transition-opacity" />
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={`hover:bg-muted/50 ${
                    row.getIsSelected() ? 'bg-muted' : ''
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="border-r border-b px-1.5 py-1 text-xs"
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.columnDef.minSize,
                        maxWidth: cell.column.columnDef.maxSize,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center">
                  No tasks found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            {table.getFilteredSelectedRowModel().rows.length} of{' '}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 50, 100, 200].map((pageSize) => (
                  <SelectItem key={pageSize} value={String(pageSize)}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <div className="text-sm">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Follow-up Task Dialog (Like Pipedrive) */}
      <Dialog open={showFollowUpDialog} onOpenChange={setShowFollowUpDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Follow-up Task</DialogTitle>
            <DialogDescription>
              Task completed! Create a follow-up task to continue the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="followup-subject">Task Subject *</Label>
              <Input
                id="followup-subject"
                placeholder="e.g., Follow up on proposal"
                value={followUpTask.subject}
                onChange={(e) => setFollowUpTask({ ...followUpTask, subject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover modal={true} open={openFollowUpCalendar} onOpenChange={setOpenFollowUpCalendar}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !followUpTask.dueDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {followUpTask.dueDate ? format(followUpTask.dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[10000]" align="start" sideOffset={5} side="bottom">
                  <Calendar
                    mode="single"
                    selected={followUpTask.dueDate}
                    onSelect={(date) => {
                      setFollowUpTask({ ...followUpTask, dueDate: date });
                      setOpenFollowUpCalendar(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={followUpTask.priority}
                onValueChange={(value: 'low' | 'medium' | 'high') =>
                  setFollowUpTask({ ...followUpTask, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {completedTask && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                <p className="font-medium">Contact: {completedTask.contactName}</p>
                {completedTask.contactPhone && <p>📞 {formatPhoneNumber(completedTask.contactPhone)}</p>}
                {completedTask.contactEmail && <p>📧 {completedTask.contactEmail}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFollowUpDialog(false);
                setCompletedTask(null);
              }}
            >
              Skip
            </Button>
            <Button
              onClick={createFollowUpTask}
              disabled={!followUpTask.subject.trim()}
            >
              Create Follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>
              Update the task details below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="edit-task-type">Task Type</Label>
              <Select
                value={editTaskForm.taskType || 'General'}
                onValueChange={(value) => setEditTaskForm({ ...editTaskForm, taskType: value })}
              >
                <SelectTrigger id="edit-task-type">
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  {savedTaskTypes.length === 0 ? (
                    <SelectItem value="General">General</SelectItem>
                  ) : (
                    savedTaskTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subject">Subject *</Label>
              <Input
                id="edit-subject"
                placeholder="Task subject"
                value={editTaskForm.subject}
                onChange={(e) => setEditTaskForm({ ...editTaskForm, subject: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                placeholder="Task description"
                value={editTaskForm.description}
                onChange={(e) => setEditTaskForm({ ...editTaskForm, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover modal={true} open={openEditCalendar} onOpenChange={setOpenEditCalendar}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !editTaskForm.dueDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {editTaskForm.dueDate ? format(editTaskForm.dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[10000]" align="start" sideOffset={5} side="bottom">
                  <Calendar
                    mode="single"
                    selected={editTaskForm.dueDate}
                    onSelect={(date) => {
                      setEditTaskForm({ ...editTaskForm, dueDate: date });
                      setOpenEditCalendar(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={editTaskForm.priority}
                onValueChange={(value: 'low' | 'medium' | 'high') =>
                  setEditTaskForm({ ...editTaskForm, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                      Low
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                      High
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editingTask && (editingTask.contactName || editingTask.contactPhone || editingTask.contactEmail) && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                <p className="font-medium mb-1">Associated Contact:</p>
                {editingTask.contactName && <p>👤 {editingTask.contactName}</p>}
                {editingTask.contactPhone && <p>📞 {formatPhoneNumber(editingTask.contactPhone)}</p>}
                {editingTask.contactEmail && <p>📧 {editingTask.contactEmail}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false);
                setEditingTask(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={saveEditedTask}
              disabled={!editTaskForm.subject.trim()}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save View Dialog */}
      <Dialog open={showSaveViewDialog} onOpenChange={setShowSaveViewDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>
              Save your current filters, columns, and sort order as a reusable view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                placeholder="e.g., My Open Tasks, High Priority..."
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newViewName.trim()) {
                    saveView(newViewName.trim());
                    setShowSaveViewDialog(false);
                    setNewViewName('');
                  }
                }}
                autoFocus
              />
            </div>
            {/* Show what will be saved */}
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">This view will save:</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-xs">Column Order</Badge>
                <Badge variant="secondary" className="text-xs">Column Visibility</Badge>
                <Badge variant="secondary" className="text-xs">Column Sizes</Badge>
                <Badge variant="secondary" className="text-xs">Sort Order</Badge>
                <Badge variant="secondary" className="text-xs">Filters</Badge>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSaveViewDialog(false);
                setNewViewName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newViewName.trim()) {
                  saveView(newViewName.trim());
                  setShowSaveViewDialog(false);
                  setNewViewName('');
                }
              }}
              disabled={!newViewName.trim()}
            >
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}




