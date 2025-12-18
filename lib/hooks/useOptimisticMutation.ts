/**
 * Optimistic mutation hook for instant UI updates
 * Updates UI immediately, then syncs with server in background
 */
import { useCallback, useRef } from 'react'
import { useGlobalCache } from '@/lib/stores/useGlobalCache'
import { toast } from 'sonner'

interface MutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>
  onOptimisticUpdate?: (variables: TVariables) => void
  onSuccess?: (data: TData, variables: TVariables) => void
  onError?: (error: Error, variables: TVariables) => void
  onRollback?: (variables: TVariables) => void
  successMessage?: string
  errorMessage?: string
}

export function useOptimisticMutation<TData, TVariables>({
  mutationFn,
  onOptimisticUpdate,
  onSuccess,
  onError,
  onRollback,
  successMessage,
  errorMessage = 'Operation failed'
}: MutationOptions<TData, TVariables>) {
  const pendingRef = useRef(false)

  const mutate = useCallback(async (variables: TVariables) => {
    if (pendingRef.current) return
    pendingRef.current = true

    // Apply optimistic update immediately
    onOptimisticUpdate?.(variables)

    try {
      const result = await mutationFn(variables)
      onSuccess?.(result, variables)
      if (successMessage) {
        toast.success(successMessage)
      }
      return result
    } catch (error) {
      // Rollback on error
      onRollback?.(variables)
      onError?.(error instanceof Error ? error : new Error(errorMessage), variables)
      toast.error(errorMessage)
      throw error
    } finally {
      pendingRef.current = false
    }
  }, [mutationFn, onOptimisticUpdate, onSuccess, onError, onRollback, successMessage, errorMessage])

  return { mutate }
}

// Pre-built optimistic mutations for common operations
export function useOptimisticTaskUpdate() {
  const cache = useGlobalCache()

  return useOptimisticMutation<any, { id: string; updates: any }>({
    mutationFn: async ({ id, updates }) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (!res.ok) throw new Error('Failed to update task')
      return res.json()
    },
    onOptimisticUpdate: ({ id, updates }) => {
      cache.updateTask(id, updates)
    },
    onRollback: () => {
      cache.invalidate('tasks')
    }
  })
}

export function useOptimisticTaskCreate() {
  const cache = useGlobalCache()

  return useOptimisticMutation<any, any>({
    mutationFn: async (task) => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      })
      if (!res.ok) throw new Error('Failed to create task')
      return res.json()
    },
    onOptimisticUpdate: (task) => {
      cache.addTask({ ...task, id: 'temp-' + Date.now() })
    },
    onSuccess: (data) => {
      // Replace temp task with real one
      cache.invalidate('tasks')
    },
    successMessage: 'Task created'
  })
}

export function useOptimisticContactTagUpdate() {
  const cache = useGlobalCache()

  return useOptimisticMutation<any, { contactId: string; tagIds: string[] }>({
    mutationFn: async ({ contactId, tagIds }) => {
      const res = await fetch(`/api/contacts/${contactId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds })
      })
      if (!res.ok) throw new Error('Failed to update tags')
      return res.json()
    },
    onOptimisticUpdate: ({ contactId, tagIds }) => {
      cache.updateContact(contactId, { tagIds })
    },
    onRollback: () => {
      cache.invalidate('contacts')
    }
  })
}

export function useOptimisticBulkTagUpdate() {
  const cache = useGlobalCache()

  return useOptimisticMutation<any, { contactIds: string[]; tagIds: string[]; action: 'add' | 'remove' }>({
    mutationFn: async ({ contactIds, tagIds, action }) => {
      const res = await fetch('/api/contacts/bulk-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds, tagIds, action })
      })
      if (!res.ok) throw new Error('Failed to update tags')
      return res.json()
    },
    onOptimisticUpdate: ({ contactIds, tagIds, action }) => {
      contactIds.forEach(id => {
        const contacts = cache.getCached<any[]>('contacts')
        const contact = contacts?.find(c => c.id === id)
        if (contact) {
          const currentTags = contact.tagIds || []
          const newTags = action === 'add'
            ? [...new Set([...currentTags, ...tagIds])]
            : currentTags.filter((t: string) => !tagIds.includes(t))
          cache.updateContact(id, { tagIds: newTags })
        }
      })
    },
    onRollback: () => {
      cache.invalidate('contacts')
    },
    successMessage: 'Tags updated'
  })
}

