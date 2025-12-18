/**
 * Custom hook for cached data fetching with stale-while-revalidate pattern
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useGlobalCache } from '@/lib/stores/useGlobalCache'

type CacheKey = 'contacts' | 'tasks' | 'deals' | 'tags' | 'pipelines' | 'filterOptions'

interface UseCachedDataOptions<T> {
  cacheKey: CacheKey
  fetchFn: () => Promise<T>
  onSuccess?: (data: T) => void
  enabled?: boolean
  refetchOnMount?: boolean
}

interface UseCachedDataResult<T> {
  data: T | null
  isLoading: boolean
  isRefetching: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useCachedData<T>({
  cacheKey,
  fetchFn,
  onSuccess,
  enabled = true,
  refetchOnMount = true
}: UseCachedDataOptions<T>): UseCachedDataResult<T> {
  const cache = useGlobalCache()
  const [isLoading, setIsLoading] = useState(false)
  const [isRefetching, setIsRefetching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)
  const fetchingRef = useRef(false)

  // Get cached data
  const cachedData = cache.getCached<T>(cacheKey)
  const isFresh = cache.isCacheFresh(cacheKey)

  const fetchData = useCallback(async (isBackground = false) => {
    if (fetchingRef.current) return
    fetchingRef.current = true

    try {
      if (isBackground) {
        setIsRefetching(true)
      } else {
        setIsLoading(true)
      }
      setError(null)

      const data = await fetchFn()

      if (mountedRef.current) {
        // Update cache based on key
        switch (cacheKey) {
          case 'contacts':
            cache.setContacts(data as any)
            break
          case 'tasks':
            cache.setTasks(data as any)
            break
          case 'deals':
            cache.setDeals(data as any)
            break
          case 'tags':
            cache.setTags(data as any)
            break
          case 'pipelines':
            cache.setPipelines(data as any)
            break
          case 'filterOptions':
            cache.setFilterOptions(data)
            break
        }
        onSuccess?.(data)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to fetch'))
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
        setIsRefetching(false)
      }
      fetchingRef.current = false
    }
  }, [cacheKey, fetchFn, onSuccess, cache])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    // If we have cached data, show it immediately
    if (cachedData) {
      // If cache is stale and refetchOnMount, do background refresh
      if (!isFresh && refetchOnMount) {
        fetchData(true) // Background refresh
      }
    } else {
      // No cached data, fetch immediately
      fetchData(false)
    }
  }, [enabled, refetchOnMount]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data: cachedData,
    isLoading: isLoading && !cachedData,
    isRefetching,
    error,
    refetch: () => fetchData(false)
  }
}

// Convenience hooks for common data types
export function useCachedTasks() {
  return useCachedData({
    cacheKey: 'tasks',
    fetchFn: async () => {
      const res = await fetch('/api/tasks')
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const data = await res.json()
      return data.tasks || []
    }
  })
}

export function useCachedTags() {
  return useCachedData({
    cacheKey: 'tags',
    fetchFn: async () => {
      const res = await fetch('/api/tags')
      if (!res.ok) throw new Error('Failed to fetch tags')
      const data = await res.json()
      return data.tags || data || []
    }
  })
}

export function useCachedPipelines() {
  return useCachedData({
    cacheKey: 'pipelines',
    fetchFn: async () => {
      const res = await fetch('/api/pipelines')
      if (!res.ok) throw new Error('Failed to fetch pipelines')
      const data = await res.json()
      return data.pipelines || data || []
    }
  })
}

export function useCachedFilterOptions() {
  return useCachedData({
    cacheKey: 'filterOptions',
    fetchFn: async () => {
      const res = await fetch('/api/contacts/filter-options')
      if (!res.ok) throw new Error('Failed to fetch filter options')
      return res.json()
    }
  })
}

