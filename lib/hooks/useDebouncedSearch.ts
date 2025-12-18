/**
 * Debounced search hook with caching for instant results
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface SearchResult<T> {
  query: string
  results: T[]
  timestamp: number
}

interface UseDebouncedSearchOptions<T> {
  searchFn: (query: string) => Promise<T[]>
  debounceMs?: number
  minQueryLength?: number
  maxCacheSize?: number
  localData?: T[]
  localSearchFn?: (data: T[], query: string) => T[]
}

interface UseDebouncedSearchResult<T> {
  query: string
  setQuery: (query: string) => void
  results: T[]
  isSearching: boolean
  error: Error | null
  clearSearch: () => void
}

export function useDebouncedSearch<T>({
  searchFn,
  debounceMs = 150,
  minQueryLength = 1,
  maxCacheSize = 50,
  localData,
  localSearchFn
}: UseDebouncedSearchOptions<T>): UseDebouncedSearchResult<T> {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  
  // Cache for search results
  const cacheRef = useRef<Map<string, SearchResult<T>>>(new Map())
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Local search for instant results
  const localResults = useMemo(() => {
    if (!localData || !localSearchFn || query.length < minQueryLength) {
      return null
    }
    return localSearchFn(localData, query)
  }, [localData, localSearchFn, query, minQueryLength])

  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < minQueryLength) {
      setResults([])
      return
    }

    // Check cache first
    const cached = cacheRef.current.get(searchQuery)
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      setResults(cached.results)
      return
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      setIsSearching(true)
      setError(null)

      const searchResults = await searchFn(searchQuery)
      
      // Update cache
      if (cacheRef.current.size >= maxCacheSize) {
        // Remove oldest entry
        const oldestKey = cacheRef.current.keys().next().value
        if (oldestKey) cacheRef.current.delete(oldestKey)
      }
      cacheRef.current.set(searchQuery, {
        query: searchQuery,
        results: searchResults,
        timestamp: Date.now()
      })

      setResults(searchResults)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
      }
    } finally {
      setIsSearching(false)
    }
  }, [searchFn, minQueryLength, maxCacheSize])

  // Debounced search effect
  useEffect(() => {
    // Show local results immediately
    if (localResults !== null) {
      setResults(localResults)
    }

    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Set new debounced search
    debounceTimerRef.current = setTimeout(() => {
      performSearch(query)
    }, debounceMs)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [query, debounceMs, performSearch, localResults])

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults([])
    setError(null)
  }, [])

  return {
    query,
    setQuery,
    results: localResults !== null ? localResults : results,
    isSearching,
    error,
    clearSearch
  }
}

// Helper function for common search patterns
export function createLocalSearchFn<T>(
  fields: (keyof T)[],
  options?: { caseSensitive?: boolean }
) {
  return (data: T[], query: string): T[] => {
    const searchQuery = options?.caseSensitive ? query : query.toLowerCase()
    return data.filter(item => {
      return fields.some(field => {
        const value = item[field]
        if (typeof value === 'string') {
          const compareValue = options?.caseSensitive ? value : value.toLowerCase()
          return compareValue.includes(searchQuery)
        }
        return false
      })
    })
  }
}

