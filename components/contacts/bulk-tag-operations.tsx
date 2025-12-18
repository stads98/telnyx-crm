"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TagInput } from "@/components/ui/tag-input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Tags, Plus, Minus, Replace, Layers } from "lucide-react"
import TagTemplates from "@/components/tags/tag-templates"
import type { Tag } from "@/lib/types"

interface BulkTagOperationsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedContactIds: string[]
  onComplete: () => void
}

type Operation = 'add' | 'remove' | 'replace'

const operationConfig = {
  add: {
    label: 'Add Tags',
    description: 'Add selected tags to all selected contacts',
    icon: Plus,
    color: 'text-green-600',
    bgColor: 'bg-green-50'
  },
  remove: {
    label: 'Remove Tags',
    description: 'Remove selected tags from all selected contacts',
    icon: Minus,
    color: 'text-red-600',
    bgColor: 'bg-red-50'
  },
  replace: {
    label: 'Replace Tags',
    description: 'Replace all tags on selected contacts with the selected tags',
    icon: Replace,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50'
  }
}

// Cache for preloaded tags to avoid repeated API calls
let cachedTags: Tag[] | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 30000 // 30 seconds

export default function BulkTagOperations({
  open,
  onOpenChange,
  selectedContactIds,
  onComplete
}: BulkTagOperationsProps) {
  const [operation, setOperation] = useState<Operation>('add')
  const [selectedTags, setSelectedTags] = useState<Tag[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const { toast } = useToast()
  const hasLoadedTags = useRef(false)

  // Preload tags when modal opens
  const loadTags = useCallback(async () => {
    // Check cache first
    const now = Date.now()
    if (cachedTags && (now - cacheTimestamp) < CACHE_DURATION) {
      setAvailableTags(cachedTags)
      return
    }

    setIsLoadingTags(true)
    try {
      const response = await fetch('/api/contacts/tags')
      if (response.ok) {
        const tags = await response.json()
        cachedTags = tags
        cacheTimestamp = now
        setAvailableTags(tags)
      }
    } catch (error) {
      console.error('Failed to load tags:', error)
    } finally {
      setIsLoadingTags(false)
    }
  }, [])

  // Load tags when modal opens
  useEffect(() => {
    if (open && !hasLoadedTags.current) {
      hasLoadedTags.current = true
      loadTags()
    }
    if (!open) {
      hasLoadedTags.current = false
    }
  }, [open, loadTags])

  const config = operationConfig[operation]
  const Icon = config.icon

  const handleSubmit = async () => {
    if (selectedTags.length === 0) {
      toast({
        title: "No tags selected",
        description: "Please select at least one tag to proceed.",
        variant: "destructive"
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/contacts/bulk-tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contactIds: selectedContactIds,
          operation,
          tagIds: selectedTags.filter(t => t.id && !t.id.startsWith('new:')).map(t => t.id),
          tagNames: selectedTags.filter(t => !t.id || t.id.startsWith('new:')).map(t => t.name)
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to perform bulk tag operation')
      }

      const result = await response.json()

      toast({
        title: "Success",
        description: result.message,
      })

      // Reset form
      setSelectedTags([])
      setOperation('add')

      // onComplete will trigger parent to refresh, which should refresh filter options
      onComplete()
      onOpenChange(false)

    } catch (error) {
      console.error('Error performing bulk tag operation:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to perform bulk tag operation',
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setSelectedTags([])
    setOperation('add')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            Bulk Tag Operations
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected Contacts Info */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{selectedContactIds.length}</span> contacts selected
            </p>
          </div>

          {/* Operation Selection */}
          <div className="space-y-2">
            <Label>Operation</Label>
            <Select value={operation} onValueChange={(value: Operation) => setOperation(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(operationConfig).map(([key, config]) => {
                  const Icon = config.icon
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${config.color}`} />
                        {config.label}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            
            {/* Operation Description */}
            <div className={`p-3 rounded-lg ${config.bgColor}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${config.color}`} />
                <span className={`text-sm font-medium ${config.color}`}>
                  {config.label}
                </span>
              </div>
              <p className="text-xs text-gray-600">
                {config.description}
              </p>
            </div>
          </div>

          {/* Tag Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tags</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTemplates(true)}
                className="text-xs h-6 px-2"
              >
                <Layers className="h-3 w-3 mr-1" />
                Templates
              </Button>
            </div>
            <div className="relative">
              {isLoadingTags ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-14" />
                  </div>
                </div>
              ) : (
                <TagInput
                  value={selectedTags}
                  onChange={setSelectedTags}
                  placeholder={`Select tags to ${operation}...`}
                  showSuggestions={false}
                  allowCreate={true}
                />
              )}
            </div>

            {/* Quick tag selection from available tags */}
            {!isLoadingTags && availableTags.length > 0 && selectedTags.length === 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Quick select:</Label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {availableTags.slice(0, 20).map((tag) => (
                    <Badge
                      key={tag.id}
                      style={{
                        backgroundColor: tag.color || '#3B82F6',
                        color: 'white',
                        cursor: 'pointer'
                      }}
                      className="text-xs hover:opacity-80 transition-opacity"
                      onClick={() => setSelectedTags([...selectedTags, tag])}
                    >
                      + {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Selected Tags Preview */}
          {selectedTags.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-500">Selected Tags:</Label>
              <div className="flex flex-wrap gap-1">
                {selectedTags.map((tag) => (
                  <Badge
                    key={tag.id || tag.name}
                    style={{
                      backgroundColor: tag.color || '#3B82F6',
                      color: 'white'
                    }}
                    className="text-xs"
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Warning for Replace Operation */}
          {operation === 'replace' && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800">
                <strong>Warning:</strong> This will remove all existing tags from the selected contacts 
                and replace them with the tags you select above.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isLoading || selectedTags.length === 0}
            className={config.color.replace('text-', 'bg-').replace('-600', '-600 hover:bg-').replace('bg-', 'bg-') + '-700'}
          >
            {isLoading ? 'Processing...' : config.label}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tag Templates Dialog */}
      <TagTemplates
        open={showTemplates}
        onOpenChange={setShowTemplates}
        selectedContactIds={selectedContactIds}
        onTemplateApplied={() => {
          setShowTemplates(false)
          onComplete()
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}
