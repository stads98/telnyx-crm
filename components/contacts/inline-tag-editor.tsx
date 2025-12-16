'use client';

import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Plus, Tag as TagIcon, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface InlineTagEditorProps {
  contactId: string;
  initialTags: Tag[];
  onTagsChange?: (tags: Tag[]) => void;
}

export default function InlineTagEditor({ contactId, initialTags, onTagsChange }: InlineTagEditorProps) {
  const [tags, setTags] = useState<Tag[]>(Array.isArray(initialTags) ? initialTags : []);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTagColor, setNewTagColor] = useState('#3B82F6');

  useEffect(() => {
    loadAvailableTags();
  }, []);

  const loadAvailableTags = async () => {
    try {
      const response = await fetch('/api/tags');
      if (response.ok) {
        const data = await response.json();
        // API returns { tags: [...] } so extract the array
        setAvailableTags(Array.isArray(data.tags) ? data.tags : Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
      setAvailableTags([]);
    }
  };

  const updateContactTags = async (newTags: Tag[]) => {
    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: newTags.map(t => ({ id: t.id, name: t.name, color: t.color }))
        }),
      });

      if (!response.ok) throw new Error('Failed to update tags');

      const updatedContact = await response.json();
      setTags(newTags);
      onTagsChange?.(newTags);

      // Dispatch event to notify contacts list to update this contact
      window.dispatchEvent(new CustomEvent('contact-updated', {
        detail: { contactId, updatedContact }
      }));

      toast.success('Tags updated');
    } catch (error) {
      toast.error('Failed to update tags');
      console.error('Error updating tags:', error);
    }
  };

  const addTag = (tag: Tag) => {
    if (tags.some(t => t.id === tag.id)) return;
    const newTags = [...tags, tag];
    updateContactTags(newTags);
    setSearchQuery('');
  };

  const removeTag = (tagId: string) => {
    const newTags = tags.filter(t => t.id !== tagId);
    updateContactTags(newTags);
  };

  const createNewTag = async () => {
    if (!searchQuery.trim()) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: searchQuery.trim(),
          color: newTagColor,
        }),
      });

      if (!response.ok) throw new Error('Failed to create tag');

      const newTag = await response.json();
      await loadAvailableTags();
      addTag(newTag);
      setSearchQuery('');
      toast.success(`Tag "${newTag.name}" created`);
    } catch (error) {
      toast.error('Failed to create tag');
      console.error('Error creating tag:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredTags = (Array.isArray(availableTags) ? availableTags : []).filter(tag =>
    !(Array.isArray(tags) ? tags : []).some(t => t.id === tag.id) &&
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const exactMatch = (Array.isArray(availableTags) ? availableTags : []).find(
    tag => tag.name.toLowerCase() === searchQuery.toLowerCase()
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <TagIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
      
      {tags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="text-xs pr-1"
          style={{
            backgroundColor: `${tag.color}15`,
            borderColor: tag.color,
            color: tag.color
          }}
        >
          {tag.name}
          <button
            onClick={() => removeTag(tag.id)}
            className="ml-1 hover:bg-black/10 rounded-full p-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-6 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Add Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <div className="space-y-2">
              <Input
                placeholder="Search or create tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    e.preventDefault();
                    if (exactMatch) {
                      addTag(exactMatch);
                    } else {
                      createNewTag();
                    }
                  }
                }}
                autoFocus
              />

              {searchQuery && !exactMatch && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-md border border-blue-200">
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer"
                  />
                  <div className="flex-1">
                    <p className="text-xs text-gray-600">Create new tag:</p>
                    <p className="text-sm font-medium">{searchQuery}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={createNewTag}
                    disabled={isCreating}
                    className="h-8"
                  >
                    {isCreating ? 'Creating...' : <Check className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>

            <ScrollArea className="h-48">
              <div className="space-y-1">
                {filteredTags.length === 0 && !searchQuery && (
                  <p className="text-sm text-gray-500 text-center py-4">No tags available</p>
                )}
                {filteredTags.length === 0 && searchQuery && exactMatch === undefined && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No matching tags. Press Enter to create.
                  </p>
                )}
                {filteredTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => addTag(tag)}
                    className="w-full flex items-center gap-2 p-2 hover:bg-gray-100 rounded-md text-left"
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm">{tag.name}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

