import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redisClient } from '@/lib/cache/redis-client';
import { elasticsearchClient } from '@/lib/search/elasticsearch-client';
import { formatPhoneNumberForTelnyx } from '@/lib/phone-utils';
import { getToken } from 'next-auth/jwt';
import { PROPERTY_TYPE_MAP, normalizePropertyType } from '@/lib/property-type-mapper';

interface Contact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  llcName: string | null;
  phone1: string | null;
  phone2: string | null;
  phone3: string | null;
  email1: string | null;
  email2: string | null;
  email3: string | null;
  propertyAddress: string | null;
  contactAddress: string | null;
  city: string | null;
  state: string | null;

  propertyCounty: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  totalBathrooms: any; // Decimal type from Prisma
  buildingSqft: number | null;
  effectiveYearBuilt: number | null;
  estValue: any; // Decimal type from Prisma
  estEquity: any; // Decimal type from Prisma
  dnc: boolean | null;
  dncReason: string | null;
  dealStatus: string | null;
  notes: string | null;
  avatarUrl: string | null;
  contact_tags: { tag: { id: string; name: string; color: string } }[];
  createdAt: Date;
  updatedAt: Date | null;
}

interface FormattedContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  propertyAddress: string;
  propertyType: string;
  propertyValue: number | null;
  debtOwed: number | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}



export async function GET(request: NextRequest) {
  const startTime = Date.now()

  console.log(`🚀 [API DEBUG] Contacts API route called: ${request.url}`)

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 20000) // Cap at 20000 to allow loading all contacts
    const search = searchParams.get('search')
    const dealStatus = searchParams.get('dealStatus')
    const propertyType = searchParams.get('propertyType')
    const city = searchParams.get('city')
    const state = searchParams.get('state')
    const propertyCounty = searchParams.get('propertyCounty')
    const tags = searchParams.get('tags')
    const excludeTags = searchParams.get('excludeTags') // Tags to exclude from results

    // Financial filters
    const minValue = searchParams.get('minValue') ? parseFloat(searchParams.get('minValue')!) : undefined
    const maxValue = searchParams.get('maxValue') ? parseFloat(searchParams.get('maxValue')!) : undefined
    const minEquity = searchParams.get('minEquity') ? parseFloat(searchParams.get('minEquity')!) : undefined
    const maxEquity = searchParams.get('maxEquity') ? parseFloat(searchParams.get('maxEquity')!) : undefined

    // Property detail filters (NEW)
    const minBedrooms = searchParams.get('minBedrooms') ? parseInt(searchParams.get('minBedrooms')!) : undefined
    const maxBedrooms = searchParams.get('maxBedrooms') ? parseInt(searchParams.get('maxBedrooms')!) : undefined
    const minBathrooms = searchParams.get('minBathrooms') ? parseFloat(searchParams.get('minBathrooms')!) : undefined
    const maxBathrooms = searchParams.get('maxBathrooms') ? parseFloat(searchParams.get('maxBathrooms')!) : undefined
    const minSqft = searchParams.get('minSqft') ? parseInt(searchParams.get('minSqft')!) : undefined
    const maxSqft = searchParams.get('maxSqft') ? parseInt(searchParams.get('maxSqft')!) : undefined
    const minYearBuilt = searchParams.get('minYearBuilt') ? parseInt(searchParams.get('minYearBuilt')!) : undefined
    const maxYearBuilt = searchParams.get('maxYearBuilt') ? parseInt(searchParams.get('maxYearBuilt')!) : undefined
    const minProperties = searchParams.get('minProperties') ? parseInt(searchParams.get('minProperties')!) : undefined
    const maxProperties = searchParams.get('maxProperties') ? parseInt(searchParams.get('maxProperties')!) : undefined

    // Date Added filter (when contact was imported/created)
    const createdAfter = searchParams.get('createdAfter') ? new Date(searchParams.get('createdAfter')!) : undefined
    const createdBefore = searchParams.get('createdBefore') ? new Date(searchParams.get('createdBefore')!) : undefined

    // Property Sold Date filter (lastSaleDate)
    const soldDateFrom = searchParams.get('soldDateFrom') ? new Date(searchParams.get('soldDateFrom')!) : undefined
    const soldDateTo = searchParams.get('soldDateTo') ? new Date(searchParams.get('soldDateTo')!) : undefined

    const hasMultiValues = [dealStatus, propertyType, city, state, propertyCounty, tags].some(v => (v ?? '').includes(','))
    const useElasticsearch = (searchParams.get('useElasticsearch') === 'true' || !!search) && !hasMultiValues

    const filters = {
      search, dealStatus, propertyType, city, state, propertyCounty, tags, excludeTags,
      minValue, maxValue, minEquity, maxEquity,
      minBedrooms, maxBedrooms, minBathrooms, maxBathrooms, minSqft, maxSqft, minYearBuilt, maxYearBuilt
    }

    // Enhanced logging for debugging
    console.log(`🔍 [API DEBUG] Contacts API called - Search: "${search || 'none'}" | Page: ${page} | Limit: ${limit}`)
    console.log(`🔍 [API DEBUG] All params:`, { search, dealStatus, propertyType, city, state, propertyCounty, tags, excludeTags, minValue, maxValue, minEquity, maxEquity })

    // Check if cache should be bypassed
    const noCache = searchParams.get('noCache') === 'true' || searchParams.has('_t')

    // Try cache first for non-search queries (unless noCache is set)
    if (!search && !noCache) {
      try {
        const cached = await redisClient.getCachedContactsPage(page, limit, filters)
        if (cached) {
          // Normalize previously mis-cached shapes (where entire response was stored under contacts)
          let normalized = cached as any
          if (normalized && normalized.contacts && !Array.isArray(normalized.contacts) && Array.isArray(normalized.contacts.contacts)) {
            normalized = normalized.contacts
          }
          if (normalized && Array.isArray(normalized.contacts) && normalized.contacts.length > 0) {
            return NextResponse.json({ ...normalized, source: 'cache' })
          }
          // If cache is empty or invalid, ignore and fall through to DB query
        }
      } catch (error) {
        console.log('⚠️ [API DEBUG] Redis cache failed, continuing without cache:', error)
      }
    }

    let result: any

    // Use Elasticsearch for search queries or when explicitly requested
    if (useElasticsearch && (await elasticsearchClient.isHealthy())) {
      try {
        result = await elasticsearchClient.searchContacts({
          search,
          dealStatus: dealStatus || undefined,
          propertyType: propertyType || undefined,
          city: city || undefined,
          state: state || undefined,
          minValue,
          maxValue,
          page,
          limit,
          sortBy: 'createdAt',
          sortOrder: 'desc'
        })

        // Transform Elasticsearch results to match expected format
        const formattedContacts = result.contacts.map((contact: any) => ({
          id: contact.id,
          firstName: contact.firstName || '',
          lastName: contact.lastName || '',
          phone: contact.phone1 || contact.phone2 || contact.phone3 || '',
          email: contact.email1 || contact.email2 || contact.email3 || '',
          propertyAddress: contact.propertyAddress || '',
          propertyType: contact.propertyType || '',
          propertyValue: contact.estValue ? Number(contact.estValue) : null,
          debtOwed: contact.estValue && contact.estEquity ?
            Number(contact.estValue) - Number(contact.estEquity) : null,
          tags: contact.tags || [],
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
          _score: contact._score,
          _highlights: contact._highlights
        }))

        const response = {
          contacts: formattedContacts,
          pagination: {
            page: result.page,
            limit: result.limit,
            totalCount: result.total,
            totalPages: result.totalPages,
            hasMore: page * limit < result.total
          },
          source: 'elasticsearch'
        }

        // Cache search results briefly
        if (search) {
          await redisClient.cacheSearchResults(search, page, limit, response, 120)
        }

        // If Elasticsearch returned results, respond; otherwise, fall back to DB query below
        if (result.total && result.total > 0 && Array.isArray(formattedContacts) && formattedContacts.length > 0) {
          return NextResponse.json(response)
        } else {
          console.warn('Elasticsearch returned no results; falling back to database query for search=', search)
        }
      } catch (esError) {
        console.error('Elasticsearch error, falling back to database:', esError)
        // Fall through to database query
      }
    }

    // Fallback to database query with optimizations
    const offset = (page - 1) * limit

    // Build where clause for filtering
    const where: any = {
      // Exclude soft-deleted contacts by default
      deletedAt: null
    }

    if (search) {
      // Trim whitespace to handle trailing/leading spaces
      const trimmedSearch = search.trim();

      if (trimmedSearch) {
        // Check if search contains multiple words (like "Daniel Adler")
        const searchWords = trimmedSearch.split(/\s+/).filter(w => w.length > 0);

        // Helper function to create OR condition for a single word across all searchable fields
        const createWordCondition = (word: string) => ({
          OR: [
            { fullName: { contains: word, mode: 'insensitive' } },
            { firstName: { contains: word, mode: 'insensitive' } },
            { lastName: { contains: word, mode: 'insensitive' } },
            { llcName: { contains: word, mode: 'insensitive' } },
            { phone1: { contains: word } },
            { phone2: { contains: word } },
            { phone3: { contains: word } },
            { email1: { contains: word, mode: 'insensitive' } },
            { email2: { contains: word, mode: 'insensitive' } },
            { email3: { contains: word, mode: 'insensitive' } },
            { propertyAddress: { contains: word, mode: 'insensitive' } },
            { city: { contains: word, mode: 'insensitive' } },
            { state: { contains: word, mode: 'insensitive' } },
            { zipCode: { contains: word } },
            { propertyCounty: { contains: word, mode: 'insensitive' } },
            { propertyType: { contains: word, mode: 'insensitive' } },
            { notes: { contains: word, mode: 'insensitive' } },
          ]
        });

        if (searchWords.length > 1) {
          // Multi-word search: ALL words must match somewhere (AND logic)
          // e.g., "Daniel Adler" matches if "Daniel" is in firstName AND "Adler" is in lastName
          where.AND = searchWords.map(word => createWordCondition(word));
        } else {
          // Single word search: match in any searchable field
          where.OR = createWordCondition(searchWords[0]).OR;
        }
      }
    }

    // Helper to parse comma-separated values
    const splitCsv = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean)

    if (dealStatus) {
      const list = splitCsv(dealStatus)
      where.dealStatus = list.length > 1 ? { in: list } : list[0]
    }

    if (propertyType) {
      const requestedTypes = splitCsv(propertyType)
      // Expand each requested type to include all raw values that normalize to it
      const expandedTypes: string[] = []
      for (const reqType of requestedTypes) {
        // Add the requested type itself
        expandedTypes.push(reqType)
        // Also add any raw values from PROPERTY_TYPE_MAP that normalize to this type
        for (const [rawValue, normalizedValue] of Object.entries(PROPERTY_TYPE_MAP)) {
          if (normalizedValue.toLowerCase() === reqType.toLowerCase() ||
              normalizePropertyType(rawValue).toLowerCase() === reqType.toLowerCase()) {
            expandedTypes.push(rawValue)
          }
        }
      }
      // Remove duplicates
      const uniqueTypes = [...new Set(expandedTypes)]
      where.propertyType = uniqueTypes.length > 1 ? { in: uniqueTypes } : uniqueTypes[0]
    }

    if (city) {
      const list = splitCsv(city)
      where.city = list.length > 1 ? { in: list } : { equals: list[0] }
    }

    if (state) {
      const list = splitCsv(state)
      where.state = list.length > 1 ? { in: list } : { equals: list[0] }
    }

    if (propertyCounty) {
      const list = splitCsv(propertyCounty)
      where.propertyCounty = list.length > 1 ? { in: list } : { equals: list[0] }
    }

    if (tags) {
      const tagValues = tags.split(',').map(t => t.trim())
      // Check if values look like UUIDs (tag IDs) or names
      const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
      const areIds = tagValues.every(isUuid)

      where.contact_tags = {
        some: {
          tag: areIds
            ? { id: { in: tagValues } }
            : { name: { in: tagValues } }
        }
      }
    }

    // Exclude contacts that have any of the exclude tags
    // Use AND with NOT to properly combine with other filters
    if (excludeTags) {
      const excludeTagValues = excludeTags.split(',').map(t => t.trim())
      const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
      const areIds = excludeTagValues.every(isUuid)

      // Build NOT conditions for each excluded tag to ensure contacts with ANY excluded tag are removed
      const notConditions = excludeTagValues.map(tagValue => ({
        contact_tags: {
          some: {
            tag: areIds
              ? { id: tagValue }
              : { name: tagValue }
          }
        }
      }))

      // Use AND with NOT array to exclude contacts that have ANY of the excluded tags
      if (!where.AND) where.AND = []
      where.AND.push(...notConditions.map(condition => ({ NOT: condition })))

      console.log('[CONTACTS API] Exclude tags filter applied:', {
        excludeTagValues,
        areIds,
        notConditionsCount: notConditions.length
      })
    }

    // Only apply value/equity filters when there's an active search or when filters are explicitly set
    // This prevents the default filter ranges from excluding contacts when just browsing all contacts
    const hasActiveSearch = search && search.trim().length > 0
    const hasExplicitFilters = dealStatus || propertyType || city || state || propertyCounty || tags

    // Skip value/equity filters if they seem to be default "show all" values
    const isDefaultValueRange = (minValue === 500000 && maxValue === 2500000) ||
                               (minValue === 0 && maxValue >= 2000000)
    const isDefaultEquityRange = (minEquity <= 500 && maxEquity >= 900000000) ||
                                (minEquity === 0 && maxEquity >= 900000000)

    // Check if any property-specific filters are active (value, equity, beds, baths, sqft, year)
    const hasPropertyFilters =
      (!isDefaultValueRange && (minValue !== undefined || maxValue !== undefined)) ||
      (!isDefaultEquityRange && (minEquity !== undefined || maxEquity !== undefined)) ||
      (minBedrooms !== undefined || maxBedrooms !== undefined) ||
      (minBathrooms !== undefined || maxBathrooms !== undefined) ||
      (minSqft !== undefined || maxSqft !== undefined) ||
      (minYearBuilt !== undefined || maxYearBuilt !== undefined)

    // If property filters are active, use OR logic to match primary OR secondary properties
    if (hasPropertyFilters) {
      // Build conditions for primary property (on Contact)
      const primaryPropertyConditions: any = {}

      if (!isDefaultValueRange && (minValue !== undefined || maxValue !== undefined)) {
        primaryPropertyConditions.estValue = {}
        if (minValue !== undefined) primaryPropertyConditions.estValue.gte = minValue
        if (maxValue !== undefined) primaryPropertyConditions.estValue.lte = maxValue
      }

      if (!isDefaultEquityRange && (minEquity !== undefined || maxEquity !== undefined)) {
        primaryPropertyConditions.estEquity = {}
        if (minEquity !== undefined) primaryPropertyConditions.estEquity.gte = minEquity
        if (maxEquity !== undefined) primaryPropertyConditions.estEquity.lte = maxEquity
      }

      if (minBedrooms !== undefined || maxBedrooms !== undefined) {
        primaryPropertyConditions.bedrooms = {}
        if (minBedrooms !== undefined) primaryPropertyConditions.bedrooms.gte = minBedrooms
        if (maxBedrooms !== undefined) primaryPropertyConditions.bedrooms.lte = maxBedrooms
      }

      if (minBathrooms !== undefined || maxBathrooms !== undefined) {
        primaryPropertyConditions.totalBathrooms = {}
        if (minBathrooms !== undefined) primaryPropertyConditions.totalBathrooms.gte = minBathrooms
        if (maxBathrooms !== undefined) primaryPropertyConditions.totalBathrooms.lte = maxBathrooms
      }

      if (minSqft !== undefined || maxSqft !== undefined) {
        primaryPropertyConditions.buildingSqft = {}
        if (minSqft !== undefined) primaryPropertyConditions.buildingSqft.gte = minSqft
        if (maxSqft !== undefined) primaryPropertyConditions.buildingSqft.lte = maxSqft
      }

      if (minYearBuilt !== undefined || maxYearBuilt !== undefined) {
        primaryPropertyConditions.effectiveYearBuilt = {}
        if (minYearBuilt !== undefined) primaryPropertyConditions.effectiveYearBuilt.gte = minYearBuilt
        if (maxYearBuilt !== undefined) primaryPropertyConditions.effectiveYearBuilt.lte = maxYearBuilt
      }

      // Build conditions for secondary properties (in ContactProperty table)
      const secondaryPropertyConditions: any = {}

      if (!isDefaultValueRange && (minValue !== undefined || maxValue !== undefined)) {
        secondaryPropertyConditions.estValue = {}
        if (minValue !== undefined) secondaryPropertyConditions.estValue.gte = minValue
        if (maxValue !== undefined) secondaryPropertyConditions.estValue.lte = maxValue
      }

      if (!isDefaultEquityRange && (minEquity !== undefined || maxEquity !== undefined)) {
        secondaryPropertyConditions.estEquity = {}
        if (minEquity !== undefined) secondaryPropertyConditions.estEquity.gte = minEquity
        if (maxEquity !== undefined) secondaryPropertyConditions.estEquity.lte = maxEquity
      }

      if (minBedrooms !== undefined || maxBedrooms !== undefined) {
        secondaryPropertyConditions.bedrooms = {}
        if (minBedrooms !== undefined) secondaryPropertyConditions.bedrooms.gte = minBedrooms
        if (maxBedrooms !== undefined) secondaryPropertyConditions.bedrooms.lte = maxBedrooms
      }

      if (minBathrooms !== undefined || maxBathrooms !== undefined) {
        secondaryPropertyConditions.totalBathrooms = {}
        if (minBathrooms !== undefined) secondaryPropertyConditions.totalBathrooms.gte = minBathrooms
        if (maxBathrooms !== undefined) secondaryPropertyConditions.totalBathrooms.lte = maxBathrooms
      }

      if (minSqft !== undefined || maxSqft !== undefined) {
        secondaryPropertyConditions.buildingSqft = {}
        if (minSqft !== undefined) secondaryPropertyConditions.buildingSqft.gte = minSqft
        if (maxSqft !== undefined) secondaryPropertyConditions.buildingSqft.lte = maxSqft
      }

      if (minYearBuilt !== undefined || maxYearBuilt !== undefined) {
        secondaryPropertyConditions.effectiveYearBuilt = {}
        if (minYearBuilt !== undefined) secondaryPropertyConditions.effectiveYearBuilt.gte = minYearBuilt
        if (maxYearBuilt !== undefined) secondaryPropertyConditions.effectiveYearBuilt.lte = maxYearBuilt
      }

      // Use OR: match if primary property matches OR any secondary property matches
      where.OR = [
        // Primary property matches all conditions
        primaryPropertyConditions,
        // OR any secondary property matches all conditions
        {
          properties: {
            some: secondaryPropertyConditions
          }
        }
      ]
    }

    // Date Added filter (createdAt)
    if (createdAfter || createdBefore) {
      where.createdAt = {}
      if (createdAfter) where.createdAt.gte = createdAfter
      if (createdBefore) {
        // Set to end of day for createdBefore
        const endOfDay = new Date(createdBefore)
        endOfDay.setHours(23, 59, 59, 999)
        where.createdAt.lte = endOfDay
      }
    }

    // Property Sold Date filter (lastSaleDate)
    if (soldDateFrom || soldDateTo) {
      where.lastSaleDate = {}
      if (soldDateFrom) where.lastSaleDate.gte = soldDateFrom
      if (soldDateTo) {
        // Set to end of day for soldDateTo
        const endOfDay = new Date(soldDateTo)
        endOfDay.setHours(23, 59, 59, 999)
        where.lastSaleDate.lte = endOfDay
      }
    }

    // Filter by property count (number of properties owned)
    // Property count = 1 (if contact has propertyAddress) + count of contact_properties
    if (minProperties !== undefined || maxProperties !== undefined) {
      // Use raw SQL to get contact IDs that match the property count criteria
      // The total count is: 1 (if property_address is not null) + COUNT(contact_properties)
      const propertyCountConditions: string[] = []
      if (minProperties !== undefined) {
        propertyCountConditions.push(`(CASE WHEN c.property_address IS NOT NULL THEN 1 ELSE 0 END) + COUNT(cp.id) >= ${minProperties}`)
      }
      if (maxProperties !== undefined) {
        propertyCountConditions.push(`(CASE WHEN c.property_address IS NOT NULL THEN 1 ELSE 0 END) + COUNT(cp.id) <= ${maxProperties}`)
      }

      const contactIdsWithPropertyCount = await prisma.$queryRawUnsafe<{ id: string }[]>(`
        SELECT c.id
        FROM contacts c
        LEFT JOIN contact_properties cp ON c.id = cp.contact_id
        GROUP BY c.id
        HAVING ${propertyCountConditions.join(' AND ')}
      `)

      const matchingIds = contactIdsWithPropertyCount.map(r => r.id)

      if (matchingIds.length === 0) {
        // No contacts match the property count filter
        where.id = { in: [] }
      } else {
        // Add the matching IDs to the where clause
        if (where.id) {
          // If there's already an id filter, intersect with it
          where.AND = where.AND || []
          ;(where.AND as any[]).push({ id: { in: matchingIds } })
        } else {
          where.id = { in: matchingIds }
        }
      }
    }

    // Always get accurate count for proper pagination
    let totalCount: number
    let contacts: any[]
    let hasMore: boolean

    // Determine which fields to select based on whether we have active filters
    const hasActiveFilters = hasActiveSearch || hasExplicitFilters

    // Get accurate total count and contacts in parallel
    const [exactTotal, rows] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        select: hasActiveFilters ? {
          // Slim payload for filtered results
          id: true,
          firstName: true,
          lastName: true,
          llcName: true,
          phone1: true,
          email1: true,
          propertyAddress: true,
          city: true,
          state: true,
          zipCode: true,
          propertyCounty: true,
          propertyType: true,
          bedrooms: true,
          totalBathrooms: true,
          buildingSqft: true,
          effectiveYearBuilt: true,
          estValue: true,
          estEquity: true,
          dnc: true,
          dealStatus: true,
          createdAt: true,
          updatedAt: true,
          contact_tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
          activities: {
            where: {
              type: 'task',
              status: { not: 'completed' }
            },
            select: {
              id: true,
              type: true,
              title: true,
              status: true,
              priority: true,
              due_date: true,
            },
            orderBy: {
              due_date: 'asc'
            },
            take: 5
          },
          _count: {
            select: {
              properties: true,
            },
          },
          // Include properties for multi-property filter matching
          properties: {
            select: {
              id: true,
              address: true,
              city: true,
              state: true,
              zipCode: true,
              llcName: true,
              propertyType: true,
              bedrooms: true,
              totalBathrooms: true,
              buildingSqft: true,
              estValue: true,
              estEquity: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        } : {
          // Full details for browsing all contacts
          id: true,
          firstName: true,
          lastName: true,
          llcName: true,
          phone1: true,
          phone2: true,
          phone3: true,
          email1: true,
          email2: true,
          email3: true,
          propertyAddress: true,
          contactAddress: true,
          city: true,
          state: true,
          propertyCounty: true,
          propertyType: true,
          bedrooms: true,
          totalBathrooms: true,
          buildingSqft: true,
          effectiveYearBuilt: true,
          estValue: true,
          estEquity: true,
          dnc: true,
          dncReason: true,
          dealStatus: true,
          notes: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
          contact_tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
          _count: {
            select: {
              properties: true,
            },
          },
          properties: {
            select: {
              id: true,
              address: true,
              city: true,
              state: true,
              zipCode: true,
              llcName: true,
              propertyType: true,
              bedrooms: true,
              totalBathrooms: true,
              buildingSqft: true,
              estValue: true,
              estEquity: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          activities: {
            where: {
              type: 'task',
              status: { not: 'completed' }
            },
            select: {
              id: true,
              type: true,
              title: true,
              status: true,
              priority: true,
              due_date: true,
            },
            orderBy: {
              due_date: 'asc'
            },
            take: 5
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: offset,
        take: limit,
      })
    ])

    totalCount = exactTotal
    contacts = rows
    hasMore = offset + contacts.length < totalCount

    console.log(`✅ [API DEBUG] Database query completed: ${totalCount} total, ${contacts.length} returned for "${search}" in ${Date.now() - startTime}ms`)

    if (contacts.length === 0) {
      console.log(`⚠️ [API DEBUG] No contacts returned from database query - this might indicate an issue with the query or filters`)
    } else {
      console.log(`📋 [API DEBUG] First contact sample:`, {
        id: contacts[0]?.id,
        name: `${contacts[0]?.firstName} ${contacts[0]?.lastName}`,
        phone: contacts[0]?.phone1
      })
    }

    // Transform the data to match the expected frontend format
    const formattedContacts = contacts.map((contact) => ({
      id: contact.id,
      firstName: contact.firstName || '',
      lastName: contact.lastName || '',
      fullName: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'Unknown',
      llcName: contact.llcName || '',
      phone1: contact.phone1 || '',
      phone2: contact.phone2 || '',
      phone3: contact.phone3 || '',
      email1: contact.email1 || '',
      email2: contact.email2 || '',
      email3: contact.email3 || '',
      propertyAddress: contact.propertyAddress || '',
      contactAddress: contact.contactAddress || '',
      city: contact.city || '',
      state: contact.state || '',

      propertyCounty: contact.propertyCounty || '',
      propertyType: contact.propertyType || '',
      bedrooms: contact.bedrooms,
      totalBathrooms: contact.totalBathrooms ? Number(contact.totalBathrooms) : null,
      buildingSqft: contact.buildingSqft,
      effectiveYearBuilt: contact.effectiveYearBuilt,
      estValue: contact.estValue ? Number(contact.estValue) : null,
      estEquity: contact.estEquity ? Number(contact.estEquity) : null,
      dnc: contact.dnc,
      dncReason: contact.dncReason || '',
      dealStatus: contact.dealStatus,
      notes: contact.notes || '',
      avatarUrl: contact.avatarUrl || '',
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt?.toISOString() || contact.createdAt.toISOString(),
      // Legacy/compatibility fields
      phone: contact.phone1 || '',
      email: contact.email1 || '',
      propertyValue: contact.estValue ? Number(contact.estValue) : null,
      debtOwed: contact.estValue && contact.estEquity ?
        Number(contact.estValue) - Number(contact.estEquity) : null,
      tags: (contact.contact_tags ?? []).map((ct: { tag: { name: string; id: string; color: string } }) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color || '#3B82F6'
      })),
      activities: (contact.activities ?? []).map((activity: any) => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        status: activity.status,
        priority: activity.priority,
        dueDate: activity.due_date?.toISOString()
      })),
      deals: [], // Deals are not directly on Contact model
      // Property count = 1 (primary property on contact) + ContactProperty records
      // Only count primary if the contact has a propertyAddress
      propertyCount: (contact.propertyAddress ? 1 : 0) + ((contact as any)._count?.properties ?? 0),
      properties: ((contact as any).properties ?? []).map((prop: any) => ({
        id: prop.id,
        address: prop.address,
        city: prop.city,
        state: prop.state,
        zipCode: prop.zipCode,
        llcName: prop.llcName,
        propertyType: prop.propertyType,
        bedrooms: prop.bedrooms,
        totalBathrooms: prop.totalBathrooms,
        buildingSqft: prop.buildingSqft,
        estValue: prop.estValue ? Number(prop.estValue) : null,
        estEquity: prop.estEquity ? Number(prop.estEquity) : null,
      })),
    }));



    const response = {
      contacts: formattedContacts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore
      },
      source: 'database'
    }

    // Cache the results (do not cache empty pages)
    try {
      await redisClient.cacheContactsPage(page, limit, filters, response.contacts, response.pagination)
    } catch (error) {
      console.log('⚠️ [API DEBUG] Redis caching failed, continuing without cache:', error)
    }

    console.log(`📤 [API DEBUG] Sending response with ${response.contacts.length} contacts, pagination:`, response.pagination)

    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ [API DEBUG] Error fetching contacts:', error);
    console.error('❌ [API DEBUG] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('❌ [API DEBUG] Request params:', { search, page, limit, dealStatus, propertyType, city, state });
    return NextResponse.json(
      { error: 'Failed to fetch contacts' },
      { status: 500 }
    );
  }
}

// POST - Create new contact
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Normalize phone numbers to E.164
    const phone1 = formatPhoneNumberForTelnyx(body.phone1 || '') || null
    const phone2 = formatPhoneNumberForTelnyx(body.phone2 || '') || null
    const phone3 = formatPhoneNumberForTelnyx(body.phone3 || '') || null

    // Validate required fields: firstName and phone1
    if (!body.firstName || !String(body.firstName).trim()) {
      return NextResponse.json({ error: 'firstName is required' }, { status: 400 })
    }
    if (!body.phone1 || !phone1) {
      return NextResponse.json({ error: 'phone1 is required and must be a valid phone number' }, { status: 400 })
    }

    // De-dup by phone: if any provided phone matches an existing contact, update it instead of creating new
    // Use normalized E.164 format for efficient indexed lookup
    let existing: any = null
    const phonesToCheck = [phone1, phone2, phone3].filter(Boolean) as string[]
    if (phonesToCheck.length > 0) {
      try {
        // Use direct comparison with normalized phone numbers (much faster than regexp_replace)
        existing = await prisma.contact.findFirst({
          where: {
            OR: phonesToCheck.flatMap(p => [
              { phone1: p },
              { phone2: p },
              { phone3: p },
            ])
          }
        })
      } catch (e) {
        console.warn('Phone dedup lookup failed:', e)
      }
    }

    const contactData = {
      firstName: body.firstName || null,
      lastName: body.lastName || null,
      llcName: body.llcName || null,
      phone1,
      phone2,
      phone3,
      email1: body.email1 || null,
      email2: body.email2 || null,
      email3: body.email3 || null,
      propertyAddress: body.propertyAddress || null,
      contactAddress: body.contactAddress || null,
      city: body.city || null,
      state: body.state || null,
      propertyCounty: body.propertyCounty || null,
      propertyType: body.propertyType || null,
      bedrooms: body.bedrooms || null,
      totalBathrooms: body.totalBathrooms || null,
      buildingSqft: body.buildingSqft || null,
      effectiveYearBuilt: body.effectiveYearBuilt || null,
      estValue: body.estValue || null,
      estEquity: body.estEquity || null,
      dnc: body.dnc || false,
      dncReason: body.dncReason || null,
      dealStatus: body.dealStatus || 'lead',
      notes: body.notes || null,
      avatarUrl: body.avatarUrl || null,
    };

    const createdOrUpdated = existing
      ? await prisma.contact.update({ where: { id: existing.id }, data: contactData })
      : await prisma.contact.create({ data: contactData })

    // If tags provided, upsert names and sync associations (only when at least one tag specified)
    if (Array.isArray(body.tags)) {
      const incoming: Array<{ id?: string; name?: string; color?: string } | string> = body.tags;

      // Only modify associations when user actually provided at least one tag token
      if (incoming.length > 0) {
        const desiredTagIds = new Set<string>();
        const candidatesToCreate = new Map<string, string | undefined>();

        for (const item of incoming) {
          if (typeof item === 'string') {
            const name = item.trim();
            if (name) candidatesToCreate.set(name, undefined);
            continue;
          }
          // Check if this is a temporary tag (created by TagInput when API fails)
          // Temporary tags have IDs starting with 'new:'
          if (item && item.id && item.id.startsWith('new:')) {
            // This is a temporary tag - create it by name
            const name = item.name?.trim() || item.id.replace('new:', '').trim();
            if (name) candidatesToCreate.set(name, item.color);
          } else if (item && item.id) {
            // This is an existing tag with a real ID
            desiredTagIds.add(item.id);
          } else if (item && item.name) {
            const name = item.name.trim();
            if (name) candidatesToCreate.set(name, item.color);
          }
        }

        for (const [name, color] of candidatesToCreate.entries()) {
          const tag = await prisma.tag.upsert({
            where: { name },
            update: color ? { color } : {},
            create: { name, ...(color ? { color } : {}) },
          });
          desiredTagIds.add(tag.id);
        }

        // Replace existing associations with the desired set
        await prisma.contactTag.deleteMany({ where: { contact_id: createdOrUpdated.id } });

        if (desiredTagIds.size > 0) {
          await prisma.contactTag.createMany({
            data: [...desiredTagIds].map((tid) => ({ contact_id: createdOrUpdated.id, tag_id: tid })),
            skipDuplicates: true,
          });
        }
      }
    }

    // Re-fetch full contact with tags to return
    const newContact = await prisma.contact.findUnique({
      where: { id: createdOrUpdated.id },
      include: { contact_tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    })

    if (!newContact) {
      return NextResponse.json({ error: 'Contact not found after creation' }, { status: 500 })
    }

    // If a TEAM_USER created this contact, auto-assign it to them
    try {
      const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
      if (token && token.role === 'TEAM_USER' && token.sub) {
        await prisma.contactAssignment.upsert({
          where: { userId_contactId: { userId: token.sub as string, contactId: newContact.id } },
          update: { assignedBy: token.sub as string },
          create: { userId: token.sub as string, contactId: newContact.id, assignedBy: token.sub as string },
        })
      }
    } catch (e) {
      console.warn('Auto-assign on contact create failed (non-fatal):', e)
    }

    // Transform the data to match the expected frontend format
    const formattedContact = {
      id: newContact.id,
      firstName: newContact.firstName || '',
      lastName: newContact.lastName || '',
      llcName: newContact.llcName || '',
      phone1: newContact.phone1 || '',
      phone2: newContact.phone2 || '',
      phone3: newContact.phone3 || '',
      email1: newContact.email1 || '',
      email2: newContact.email2 || '',
      email3: newContact.email3 || '',
      propertyAddress: newContact.propertyAddress || '',
      contactAddress: newContact.contactAddress || '',
      city: newContact.city || '',
      state: newContact.state || '',
      propertyCounty: newContact.propertyCounty || '',
      propertyType: newContact.propertyType || '',
      bedrooms: newContact.bedrooms,
      totalBathrooms: newContact.totalBathrooms ? Number(newContact.totalBathrooms) : null,
      buildingSqft: newContact.buildingSqft,
      effectiveYearBuilt: newContact.effectiveYearBuilt,
      estValue: newContact.estValue ? Number(newContact.estValue) : null,
      estEquity: newContact.estEquity ? Number(newContact.estEquity) : null,
      dnc: newContact.dnc,
      dncReason: newContact.dncReason || '',
      dealStatus: newContact.dealStatus,
      notes: newContact.notes || '',
      avatarUrl: newContact.avatarUrl || '',
      createdAt: newContact.createdAt.toISOString(),
      updatedAt: newContact.updatedAt?.toISOString() || newContact.createdAt.toISOString(),
      // Legacy/compatibility fields
      phone: newContact.phone1 || '',
      email: newContact.email1 || '',
      propertyValue: newContact.estValue ? Number(newContact.estValue) : null,
      debtOwed: newContact.estValue && newContact.estEquity ?
        Number(newContact.estValue) - Number(newContact.estEquity) : null,
      tags: newContact.contact_tags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color || '#3B82F6'
      })),
    };

    // Index the contact into Elasticsearch (non-blocking on failure)
    try {
      await elasticsearchClient.indexContact({
        id: newContact.id,
        firstName: newContact.firstName || undefined,
        lastName: newContact.lastName || undefined,
        llcName: newContact.llcName || undefined,
        phone1: newContact.phone1 || undefined,
        phone2: newContact.phone2 || undefined,
        phone3: newContact.phone3 || undefined,
        email1: newContact.email1 || undefined,
        email2: newContact.email2 || undefined,
        email3: newContact.email3 || undefined,
        propertyAddress: newContact.propertyAddress || undefined,
        contactAddress: newContact.contactAddress || undefined,
        city: newContact.city || undefined,
        state: newContact.state || undefined,
        propertyCounty: newContact.propertyCounty || undefined,
        propertyType: newContact.propertyType || undefined,
        estValue: newContact.estValue != null ? Number(newContact.estValue) : undefined,
        estEquity: newContact.estEquity != null ? Number(newContact.estEquity) : undefined,
        dnc: typeof newContact.dnc === 'boolean' ? newContact.dnc : undefined,
        dealStatus: newContact.dealStatus || undefined,
        createdAt: newContact.createdAt.toISOString(),
        updatedAt: (newContact.updatedAt?.toISOString() || newContact.createdAt.toISOString()),
        tags: newContact.contact_tags?.map((ct) => ct.tag.name) || [],
      })
    } catch (e) {
      console.warn('ES indexContact failed (non-fatal):', e)
    }

    return NextResponse.json(formattedContact, { status: 201 });
  } catch (error) {
    console.error('Error creating contact:', error);
    return NextResponse.json(
      { error: 'Failed to create contact' },
      { status: 500 }
    );
  }
}
