'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  Loader2,
  User,
} from 'lucide-react';

export interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskCreated?: (task: any) => void;
  // Pre-fill props
  initialContactId?: string;
  initialContactName?: string;
  initialSubject?: string;
  initialType?: string;
  initialDueDate?: Date;
  initialPriority?: 'low' | 'medium' | 'high';
  initialDescription?: string;
}

interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  phone1?: string;
  email1?: string;
  propertyAddress?: string;
}

const DEFAULT_TASK_TYPES = [
  'Follow Up',
  'Call',
  'Email',
  'Meeting',
  'Site Visit',
  'Document Review',
  'General',
];

export default function UnifiedCreateTaskModal({
  open,
  onOpenChange,
  onTaskCreated,
  initialContactId,
  initialContactName,
  initialSubject = '',
  initialType = 'Follow Up',
  initialDueDate,
  initialPriority = 'low',
  initialDescription = '',
}: CreateTaskModalProps) {
  // Form state
  const [subject, setSubject] = useState(initialSubject);
  const [description, setDescription] = useState(initialDescription);
  const [contactId, setContactId] = useState(initialContactId || '');
  const [contactName, setContactName] = useState(initialContactName || '');
  const [taskType, setTaskType] = useState(initialType);
  const [dueDate, setDueDate] = useState<Date | undefined>(initialDueDate);
  const [dueTime, setDueTime] = useState('09:00');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(initialPriority);

  // Ref to track contactId for reliable access during submit (prevents stale closure issues)
  const contactIdRef = useRef(contactId);
  useEffect(() => {
    contactIdRef.current = contactId;
  }, [contactId]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [savedTaskTypes, setSavedTaskTypes] = useState<string[]>(DEFAULT_TASK_TYPES);
  const [contactSearchOpen, setContactSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Reset form when modal opens with new initial values
  useEffect(() => {
    if (open) {
      setSubject(initialSubject);
      setDescription(initialDescription);
      setContactId(initialContactId || '');
      setContactName(initialContactName || '');
      setTaskType(initialType);
      setDueDate(initialDueDate);
      setPriority(initialPriority);
      setDueTime('09:00');
    }
  }, [open, initialSubject, initialDescription, initialContactId, initialContactName, initialType, initialDueDate, initialPriority]);

  // Load contacts and task types
  useEffect(() => {
    if (open) {
      loadContacts();
      loadTaskTypes();
    }
  }, [open]);

  const loadContacts = async () => {
    try {
      const res = await fetch('/api/contacts?limit=500');
      if (res.ok) {
        const data = await res.json();
        const contactList = data.contacts || [];
        console.log('[TaskModal] Loaded', contactList.length, 'contacts');
        setContacts(contactList);
      } else {
        console.error('[TaskModal] Failed to load contacts, status:', res.status);
      }
    } catch (error) {
      console.error('[TaskModal] Failed to load contacts:', error);
    }
  };

  const loadTaskTypes = async () => {
    try {
      const res = await fetch('/api/settings/task-types');
      if (res.ok) {
        const data = await res.json();
        if (data.taskTypes?.length > 0) {
          setSavedTaskTypes(data.taskTypes);
        }
      }
    } catch (error) {
      console.error('Failed to load task types:', error);
    }
  };

  const getContactDisplayName = (contact: Contact) => {
    return `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Use ref as fallback in case state is stale (closure issue)
    const effectiveContactId = contactId || contactIdRef.current;

    console.log('[TaskModal] Submit clicked, contactId (state):', contactId, 'contactId (ref):', contactIdRef.current, 'subject:', subject);

    // Validation
    if (!subject.trim()) {
      toast.error('Please enter a task subject');
      return;
    }

    if (!effectiveContactId) {
      toast.error('Please select a contact');
      console.error('[TaskModal] Submit failed: no contactId. State:', contactId, 'Ref:', contactIdRef.current);
      return;
    }

    // Validate contactId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(effectiveContactId)) {
      toast.error('Invalid contact selected. Please select a contact again.');
      console.error('[TaskModal] Submit failed: contactId is not a valid UUID:', effectiveContactId);
      return;
    }

    setLoading(true);
    try {
      // Build due date with time
      const dueDateTime = dueDate
        ? new Date(`${format(dueDate, 'yyyy-MM-dd')}T${dueTime}:00`).toISOString()
        : undefined;

      const payload = {
        contactId: effectiveContactId,
        taskType,
        subject: subject.trim(),
        description: description.trim(),
        dueDate: dueDateTime,
        priority,
        status: 'open',
      };

      console.log('[TaskModal] Submitting payload:', payload);

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create task');
      }

      const newTask = await response.json();
      console.log('[TaskModal] Task created:', newTask);
      toast.success('Task created successfully');

      // Reset form
      setSubject('');
      setDescription('');
      setContactId('');
      setContactName('');
      setTaskType('Follow Up');
      setDueDate(undefined);
      setPriority('low');
      setDueTime('09:00');

      // Callback
      onTaskCreated?.(newTask);
      onOpenChange(false);
    } catch (error) {
      console.error('[TaskModal] Error creating task:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onOpenChange(false);
    }
  }, [onOpenChange]);

  const selectedContact = contacts.find((c) => c.id === contactId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[550px]"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>
            Create a new task for a contact
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Subject - Most important, first */}
          <div className="space-y-2">
            <Label htmlFor="subject">
              Subject <span className="text-red-500">*</span>
            </Label>
            <Input
              id="subject"
              placeholder="e.g., Call to discuss refinance options"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
          </div>

          {/* Description - Right below Subject */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Additional details or notes..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Contact Selector */}
          <div className="space-y-2">
            <Label>
              Contact <span className="text-red-500">*</span>
            </Label>
            <Popover open={contactSearchOpen} onOpenChange={setContactSearchOpen} modal={true}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={contactSearchOpen}
                  className="w-full justify-between font-normal"
                >
                  {contactId && selectedContact ? (
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {getContactDisplayName(selectedContact)}
                    </span>
                  ) : contactId && contactName ? (
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {contactName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select a contact...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[400px] p-0"
                align="start"
                sideOffset={4}
                style={{ zIndex: 99999 }}
              >
                <Command shouldFilter={true}>
                  <CommandInput
                    placeholder="Search contacts..."
                    autoFocus
                  />
                  <CommandList>
                    <CommandEmpty>No contacts found.</CommandEmpty>
                    <CommandGroup className="max-h-[300px] overflow-auto">
                      {contacts.length === 0 && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          Loading contacts...
                        </div>
                      )}
                      {contacts.map((c) => {
                        const displayName = getContactDisplayName(c);
                        const searchValue = `${displayName} ${c.propertyAddress || ''} ${c.phone1 || ''}`.toLowerCase();
                        const isSelected = contactId === c.id;
                        return (
                          <CommandItem
                            key={c.id}
                            value={searchValue}
                            onSelect={() => {
                              console.log('[TaskModal] Contact selected:', c.id, displayName);
                              // Use functional updates to ensure state is committed
                              setContactId(c.id);
                              setContactName(displayName);
                              // Close popover after a microtask to ensure state updates commit
                              setTimeout(() => {
                                setContactSearchOpen(false);
                              }, 0);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                isSelected ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {displayName}
                              </span>
                              {c.propertyAddress && (
                                <span className="text-xs text-muted-foreground">
                                  {c.propertyAddress}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Task Type */}
          <div className="space-y-2">
            <Label>Task Type</Label>
            <Select value={taskType} onValueChange={setTaskType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {savedTaskTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen} modal={true}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !dueDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 z-[9999]" align="start" sideOffset={5}>
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={(date) => {
                      setDueDate(date);
                      setCalendarOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Due Time</Label>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>

          {/* Priority - No emojis, just color-coded dots */}
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as 'low' | 'medium' | 'high')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-300"></span>
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

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

