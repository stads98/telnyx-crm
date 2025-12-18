import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAdminAuth } from '@/lib/auth-middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Helper: extract last 10 digits from phone number for matching
function normalizePhoneForMatching(phone: string | null): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-10) // Get last 10 digits
}

// Helper: normalize name for matching (trim, lowercase, collapse spaces)
function normalizeNameForMatching(firstName: string | null, lastName: string | null): string {
  const full = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim().toLowerCase()
  return full.replace(/\s+/g, ' ')
}

// Helper: normalize city+state for matching
function normalizeCityStateForMatching(city: string | null, state: string | null): string {
  const c = (city || '').trim().toLowerCase()
  const s = (state || '').trim().toLowerCase()
  if (!c || !s) return ''
  return `${c}|${s}`
}

interface DuplicateContact {
  id: string
  name: string
  phone: string
  city?: string
  state?: string
  propertyAddress: string | null
  propertiesCount: number
  createdAt: Date
  isPrimary: boolean
}

interface DuplicateGroup {
  phone: string
  normalizedPhone: string
  matchType: 'phone' | 'name_location'
  matchKey?: string
  contacts: DuplicateContact[]
  uniqueProperties: string[]
  action: 'merge' | 'skip'
}

interface ScrubPreview {
  totalDuplicateGroups: number
  totalContactsToMerge: number
  totalPropertiesToConsolidate: number
  groups: DuplicateGroup[]
}

// GET: Preview duplicate groups (phone-based + name+city+state fallback matching)
export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const { searchParams } = new URL(request.url)
      const limit = parseInt(searchParams.get('limit') || '100')
      const batchSize = parseInt(searchParams.get('batchSize') || '1000')

      // Build phone -> contacts mapping AND name+location -> contacts mapping
      const phoneMap = new Map<string, any[]>()
      const nameLocationMap = new Map<string, any[]>()
      const contactsWithPhone = new Set<string>() // Track contact IDs that have a valid phone
      let page = 0

      while (true) {
        const contacts = await prisma.contact.findMany({
          skip: page * batchSize,
          take: batchSize,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone1: true,
            city: true,
            state: true,
            propertyAddress: true,
            createdAt: true,
            _count: { select: { properties: true } }
          }
        })
        if (contacts.length === 0) break

        for (const c of contacts) {
          const normalizedPhone = normalizePhoneForMatching(c.phone1)

          // Phone-based matching (primary)
          if (normalizedPhone && normalizedPhone.length >= 10) {
            contactsWithPhone.add(c.id)
            const arr = phoneMap.get(normalizedPhone) || []
            arr.push(c)
            phoneMap.set(normalizedPhone, arr)
          } else {
            // Name+Location fallback for contacts WITHOUT valid phone
            const normalizedName = normalizeNameForMatching(c.firstName, c.lastName)
            const normalizedCityState = normalizeCityStateForMatching(c.city, c.state)

            if (normalizedName && normalizedCityState) {
              const key = `${normalizedName}|${normalizedCityState}`
              const arr = nameLocationMap.get(key) || []
              arr.push(c)
              nameLocationMap.set(key, arr)
            }
          }
        }
        page++
      }

      // Build groups for duplicates
      const groups: DuplicateGroup[] = []
      let totalContactsToMerge = 0
      let totalPropertiesToConsolidate = 0

      // Phone-based duplicates (>1 contact with same phone)
      for (const [normalizedPhone, contacts] of phoneMap.entries()) {
        if (contacts.length <= 1) continue

        // Sort by createdAt (oldest first) - oldest becomes primary
        contacts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        // Collect unique property addresses
        const uniqueProps = new Set<string>()
        const contactData: DuplicateContact[] = contacts.map((c, idx) => {
          if (c.propertyAddress) uniqueProps.add(c.propertyAddress.trim().toLowerCase())
          return {
            id: c.id,
            name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
            phone: c.phone1 || '',
            city: c.city || undefined,
            state: c.state || undefined,
            propertyAddress: c.propertyAddress,
            propertiesCount: c._count?.properties || 0,
            createdAt: c.createdAt,
            isPrimary: idx === 0
          }
        })

        groups.push({
          phone: contacts[0].phone1 || '',
          normalizedPhone,
          matchType: 'phone',
          contacts: contactData,
          uniqueProperties: Array.from(uniqueProps),
          action: 'merge'
        })

        totalContactsToMerge += contacts.length - 1
        totalPropertiesToConsolidate += uniqueProps.size
      }

      // Name+Location duplicates (fallback for contacts without phone)
      for (const [nameLocationKey, contacts] of nameLocationMap.entries()) {
        if (contacts.length <= 1) continue

        // Sort by createdAt (oldest first) - oldest becomes primary
        contacts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        // Collect unique property addresses
        const uniqueProps = new Set<string>()
        const contactData: DuplicateContact[] = contacts.map((c, idx) => {
          if (c.propertyAddress) uniqueProps.add(c.propertyAddress.trim().toLowerCase())
          return {
            id: c.id,
            name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
            phone: c.phone1 || '',
            city: c.city || undefined,
            state: c.state || undefined,
            propertyAddress: c.propertyAddress,
            propertiesCount: c._count?.properties || 0,
            createdAt: c.createdAt,
            isPrimary: idx === 0
          }
        })

        groups.push({
          phone: '', // No phone for name+location matches
          normalizedPhone: '',
          matchType: 'name_location',
          matchKey: nameLocationKey,
          contacts: contactData,
          uniqueProperties: Array.from(uniqueProps),
          action: 'merge'
        })

        totalContactsToMerge += contacts.length - 1
        totalPropertiesToConsolidate += uniqueProps.size
      }

      // Limit results if specified
      const limitedGroups = limit > 0 ? groups.slice(0, limit) : groups

      const preview: ScrubPreview = {
        totalDuplicateGroups: groups.length,
        totalContactsToMerge,
        totalPropertiesToConsolidate,
        groups: limitedGroups
      }

      return NextResponse.json({ success: true, preview })
    } catch (e: any) {
      console.error('scrub-duplicates GET failed:', e)
      return NextResponse.json({ success: false, error: e?.message || 'Unknown error' }, { status: 500 })
    }
  })
}

// POST: Execute merge for duplicate groups
// Body: { groupsToMerge?: string[] } - array of normalizedPhone or nameLocation keys, or empty for all
export async function POST(request: NextRequest) {
  return withAdminAuth(request, async () => {
    try {
      const body = await request.json().catch(() => ({}))
      const { groupsToMerge, dryRun = false } = body

      // Rebuild both phone and name+location maps to find duplicates
      const phoneMap = new Map<string, any[]>()
      const nameLocationMap = new Map<string, any[]>()
      const batchSize = 1000
      let page = 0

      while (true) {
        const contacts = await prisma.contact.findMany({
          skip: page * batchSize,
          take: batchSize,
          orderBy: { createdAt: 'asc' },
          include: {
            properties: true,
            contact_tags: { include: { tag: true } }
          }
        })
        if (contacts.length === 0) break

        for (const c of contacts) {
          const normalizedPhone = normalizePhoneForMatching(c.phone1)

          if (normalizedPhone && normalizedPhone.length >= 10) {
            const arr = phoneMap.get(normalizedPhone) || []
            arr.push(c)
            phoneMap.set(normalizedPhone, arr)
          } else {
            // Name+Location fallback for contacts WITHOUT valid phone
            const normalizedName = normalizeNameForMatching(c.firstName, c.lastName)
            const normalizedCityState = normalizeCityStateForMatching(c.city, c.state)

            if (normalizedName && normalizedCityState) {
              const key = `${normalizedName}|${normalizedCityState}`
              const arr = nameLocationMap.get(key) || []
              arr.push(c)
              nameLocationMap.set(key, arr)
            }
          }
        }
        page++
      }

      // Filter to only groups to merge (if specified)
      const targetKeys = groupsToMerge && Array.isArray(groupsToMerge) && groupsToMerge.length > 0
        ? new Set(groupsToMerge)
        : null

      let mergedGroups = 0
      let contactsDeleted = 0
      let propertiesConsolidated = 0
      const errors: { key: string; error: string }[] = []

      // Helper function to merge a group of contacts
      const mergeGroup = async (groupKey: string, contacts: any[]) => {
        if (contacts.length <= 1) return
        if (targetKeys && !targetKeys.has(groupKey)) return

        // Sort by createdAt - oldest is primary
        contacts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        const primary = contacts[0]
        const duplicates = contacts.slice(1)

        if (dryRun) {
          mergedGroups++
          contactsDeleted += duplicates.length
          return
        }

        try {
          await prisma.$transaction(async (tx) => {
            // Collect all unique property addresses from all duplicates
            const existingAddresses = new Set(
              primary.properties?.map((p: any) => p.address?.trim().toLowerCase()).filter(Boolean) || []
            )

            // Also add primary's propertyAddress if it exists
            if (primary.propertyAddress) {
              existingAddresses.add(primary.propertyAddress.trim().toLowerCase())
            }

            for (const dupe of duplicates) {
              // Add properties from duplicates
              if (dupe.properties && dupe.properties.length > 0) {
                for (const prop of dupe.properties) {
                  const propAddrKey = prop.address?.trim().toLowerCase()
                  if (propAddrKey && !existingAddresses.has(propAddrKey)) {
                    await tx.contactProperty.create({
                      data: {
                        contactId: primary.id,
                        address: prop.address,
                        city: prop.city,
                        state: prop.state,
                        zipCode: prop.zipCode,
                        county: prop.county,
                        llcName: prop.llcName,
                        propertyType: prop.propertyType,
                        bedrooms: prop.bedrooms,
                        totalBathrooms: prop.totalBathrooms,
                        buildingSqft: prop.buildingSqft,
                        lotSizeSqft: prop.lotSizeSqft,
                        effectiveYearBuilt: prop.effectiveYearBuilt,
                        lastSaleDate: prop.lastSaleDate,
                        lastSaleAmount: prop.lastSaleAmount,
                        estValue: prop.estValue,
                        estEquity: prop.estEquity,
                      }
                    })
                    existingAddresses.add(propAddrKey)
                    propertiesConsolidated++
                  }
                }
              }

              // If duplicate has propertyAddress but no properties array entry, add it
              if (dupe.propertyAddress) {
                const dupeAddrKey = dupe.propertyAddress.trim().toLowerCase()
                if (!existingAddresses.has(dupeAddrKey)) {
                  await tx.contactProperty.create({
                    data: {
                      contactId: primary.id,
                      address: dupe.propertyAddress,
                      city: dupe.city,
                      state: dupe.state,
                      zipCode: dupe.zipCode,
                      county: dupe.propertyCounty,
                      llcName: dupe.llcName,
                      propertyType: dupe.propertyType,
                      bedrooms: dupe.bedrooms,
                      totalBathrooms: dupe.totalBathrooms,
                      buildingSqft: dupe.buildingSqft,
                      effectiveYearBuilt: dupe.effectiveYearBuilt,
                      estValue: dupe.estValue ? parseInt(String(dupe.estValue)) : null,
                      estEquity: dupe.estEquity ? parseInt(String(dupe.estEquity)) : null,
                    }
                  })
                  existingAddresses.add(dupeAddrKey)
                  propertiesConsolidated++
                }
              }

              // Reassign related records to primary
              const dupeId = dupe.id
              await tx.message.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.call.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.email.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.activity.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.deal.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.document.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.conversation.updateMany({ where: { contact_id: dupeId }, data: { contact_id: primary.id } })
              await tx.telnyxMessage.updateMany({ where: { contactId: dupeId }, data: { contactId: primary.id } })
              await tx.telnyxCall.updateMany({ where: { contactId: dupeId }, data: { contactId: primary.id } })
              await tx.emailMessage.updateMany({ where: { contactId: dupeId }, data: { contactId: primary.id } })
              await tx.emailConversation.updateMany({ where: { contactId: dupeId }, data: { contactId: primary.id } })
              await tx.contactAssignment.updateMany({ where: { contactId: dupeId }, data: { contactId: primary.id } })
              // Note: Tasks are stored in the Activity model with type='task'

              // Copy tags from duplicate (skip if already exists on primary)
              if (dupe.contact_tags && dupe.contact_tags.length > 0) {
                for (const ct of dupe.contact_tags) {
                  await tx.contactTag.upsert({
                    where: { contact_id_tag_id: { contact_id: primary.id, tag_id: ct.tag_id } },
                    update: {},
                    create: { contact_id: primary.id, tag_id: ct.tag_id }
                  })
                }
              }
            }

            // Delete duplicate contacts (cascade will clean up their properties)
            const dupeIds = duplicates.map(d => d.id)
            await tx.contact.deleteMany({ where: { id: { in: dupeIds } } })

            // Add "Multiple property" tag if primary now has 2+ properties
            const propertyCount = await tx.contactProperty.count({ where: { contactId: primary.id } })
            if (propertyCount > 1) {
              const multiPropTag = await tx.tag.upsert({
                where: { name: 'Multiple property' },
                update: {},
                create: { name: 'Multiple property' }
              })
              await tx.contactTag.upsert({
                where: { contact_id_tag_id: { contact_id: primary.id, tag_id: multiPropTag.id } },
                update: {},
                create: { contact_id: primary.id, tag_id: multiPropTag.id }
              })
            }
          })

          mergedGroups++
          contactsDeleted += duplicates.length
        } catch (err: any) {
          errors.push({ key: groupKey, error: err?.message || 'Unknown error' })
        }
      }

      // Process phone-based duplicates
      for (const [normalizedPhone, contacts] of phoneMap.entries()) {
        await mergeGroup(normalizedPhone, contacts)
      }

      // Process name+location-based duplicates
      for (const [nameLocationKey, contacts] of nameLocationMap.entries()) {
        await mergeGroup(nameLocationKey, contacts)
      }

      return NextResponse.json({
        success: true,
        dryRun,
        summary: {
          mergedGroups,
          contactsDeleted,
          propertiesConsolidated
        },
        errors: errors.length > 0 ? errors : undefined
      })
    } catch (e: any) {
      console.error('scrub-duplicates POST failed:', e)
      return NextResponse.json({ success: false, error: e?.message || 'Unknown error' }, { status: 500 })
    }
  })
}

