/**
 * Global Data Cache Store
 * 
 * Provides instant navigation by caching data across page transitions.
 * Uses stale-while-revalidate pattern for background updates.
 */
import { create } from 'zustand'

interface CacheEntry<T> {
  data: T
  timestamp: number
  isLoading: boolean
}

interface GlobalCacheState {
  // Cached data
  contacts: CacheEntry<any[]> | null
  contactsTotal: number
  tasks: CacheEntry<any[]> | null
  deals: CacheEntry<any[]> | null
  tags: CacheEntry<any[]> | null
  pipelines: CacheEntry<any[]> | null
  filterOptions: CacheEntry<any> | null
  
  // Cache TTL (5 minutes default, 30 seconds for frequently changing data)
  cacheTTL: {
    contacts: number
    tasks: number
    deals: number
    tags: number
    pipelines: number
    filterOptions: number
  }
  
  // Actions
  setContacts: (data: any[], total?: number) => void
  setTasks: (data: any[]) => void
  setDeals: (data: any[]) => void
  setTags: (data: any[]) => void
  setPipelines: (data: any[]) => void
  setFilterOptions: (data: any) => void
  
  // Check if cache is fresh
  isCacheFresh: (key: keyof GlobalCacheState['cacheTTL']) => boolean
  
  // Get cached data if fresh, otherwise null
  getCached: <T>(key: keyof GlobalCacheState['cacheTTL']) => T | null
  
  // Mark as loading
  setLoading: (key: keyof GlobalCacheState['cacheTTL'], loading: boolean) => void
  
  // Invalidate specific cache
  invalidate: (key: keyof GlobalCacheState['cacheTTL']) => void
  
  // Invalidate all caches
  invalidateAll: () => void
  
  // Optimistic update helpers
  addContact: (contact: any) => void
  updateContact: (id: string, updates: any) => void
  deleteContact: (id: string) => void
  addTask: (task: any) => void
  updateTask: (id: string, updates: any) => void
  deleteTask: (id: string) => void
  addTag: (tag: any) => void
}

const CACHE_TTL = {
  contacts: 5 * 60 * 1000,      // 5 minutes
  tasks: 30 * 1000,             // 30 seconds (tasks change frequently)
  deals: 60 * 1000,             // 1 minute
  tags: 10 * 60 * 1000,         // 10 minutes (tags rarely change)
  pipelines: 10 * 60 * 1000,    // 10 minutes
  filterOptions: 10 * 60 * 1000 // 10 minutes
}

export const useGlobalCache = create<GlobalCacheState>((set, get) => ({
  contacts: null,
  contactsTotal: 0,
  tasks: null,
  deals: null,
  tags: null,
  pipelines: null,
  filterOptions: null,
  
  cacheTTL: CACHE_TTL,
  
  setContacts: (data, total) => set({
    contacts: { data, timestamp: Date.now(), isLoading: false },
    contactsTotal: total ?? data.length
  }),
  
  setTasks: (data) => set({
    tasks: { data, timestamp: Date.now(), isLoading: false }
  }),
  
  setDeals: (data) => set({
    deals: { data, timestamp: Date.now(), isLoading: false }
  }),
  
  setTags: (data) => set({
    tags: { data, timestamp: Date.now(), isLoading: false }
  }),
  
  setPipelines: (data) => set({
    pipelines: { data, timestamp: Date.now(), isLoading: false }
  }),
  
  setFilterOptions: (data) => set({
    filterOptions: { data, timestamp: Date.now(), isLoading: false }
  }),
  
  isCacheFresh: (key) => {
    const state = get()
    const entry = state[key] as CacheEntry<any> | null
    if (!entry) return false
    return Date.now() - entry.timestamp < state.cacheTTL[key]
  },
  
  getCached: <T,>(key: keyof GlobalCacheState['cacheTTL']): T | null => {
    const state = get()
    const entry = state[key] as CacheEntry<T> | null
    if (!entry) return null
    // Return cached data even if stale (stale-while-revalidate)
    return entry.data
  },
  
  setLoading: (key, loading) => {
    const state = get()
    const entry = state[key] as CacheEntry<any> | null
    if (entry) {
      set({ [key]: { ...entry, isLoading: loading } })
    }
  },
  
  invalidate: (key) => set({ [key]: null }),
  
  invalidateAll: () => set({
    contacts: null,
    tasks: null,
    deals: null,
    tags: null,
    pipelines: null,
    filterOptions: null
  }),
  
  // Optimistic updates
  addContact: (contact) => {
    const state = get()
    if (state.contacts?.data) {
      set({
        contacts: {
          ...state.contacts,
          data: [contact, ...state.contacts.data]
        },
        contactsTotal: state.contactsTotal + 1
      })
    }
  },
  
  updateContact: (id, updates) => {
    const state = get()
    if (state.contacts?.data) {
      set({
        contacts: {
          ...state.contacts,
          data: state.contacts.data.map(c => c.id === id ? { ...c, ...updates } : c)
        }
      })
    }
  },
  
  deleteContact: (id) => {
    const state = get()
    if (state.contacts?.data) {
      set({
        contacts: {
          ...state.contacts,
          data: state.contacts.data.filter(c => c.id !== id)
        },
        contactsTotal: state.contactsTotal - 1
      })
    }
  },
  
  addTask: (task) => {
    const state = get()
    if (state.tasks?.data) {
      set({
        tasks: {
          ...state.tasks,
          data: [task, ...state.tasks.data]
        }
      })
    }
  },
  
  updateTask: (id, updates) => {
    const state = get()
    if (state.tasks?.data) {
      set({
        tasks: {
          ...state.tasks,
          data: state.tasks.data.map(t => t.id === id ? { ...t, ...updates } : t)
        }
      })
    }
  },
  
  deleteTask: (id) => {
    const state = get()
    if (state.tasks?.data) {
      set({
        tasks: {
          ...state.tasks,
          data: state.tasks.data.filter(t => t.id !== id)
        }
      })
    }
  },
  
  addTag: (tag) => {
    const state = get()
    if (state.tags?.data) {
      set({
        tags: {
          ...state.tags,
          data: [...state.tags.data, tag]
        }
      })
    }
  }
}))

