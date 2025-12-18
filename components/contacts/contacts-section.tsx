"use client"

import { useState, useMemo, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, UserPlus, Trash2, Search, Tags } from "lucide-react"
import ContactsDataGrid from "./contacts-data-grid"
import AddContactDialog from "./add-contact-dialog"
import EditContactDialog from "./edit-contact-dialog"
import ContactDetails from "./contact-details" // Import ContactDetails
import AdvancedContactFilter from "../text/advanced-contact-filter"
import BulkTagOperations from "./bulk-tag-operations"
import { useContacts } from "@/lib/context/contacts-context"
import { useSession } from "next-auth/react"
import AssignContactModal from "@/components/admin/assign-contact-modal"
import type { Contact } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { Sheet, SheetContent } from "@/components/ui/sheet"

export default function ContactsSection() {
  const { data: session } = useSession()
  const { contacts, addContact, updateContact, deleteContact, isLoading, error, pagination, loadMoreContacts, goToPage, searchContacts, filterOptions, currentQuery, currentFilters } = useContacts()
  const { toast } = useToast()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [contactToDelete, setContactToDelete] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null) // State for selected contact

  // Check if current user is admin
  const isAdmin = session?.user?.role === 'ADMIN'
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([])
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [showBulkTagOperations, setShowBulkTagOperations] = useState(false)


  // Reset to full list on Contacts page mount ONLY if no default view is set
  // If a default view exists, let the contacts-data-grid load it with its filters
  useEffect(() => {
    // Check if a default view is set - if so, let the grid handle loading with view filters
    const savedDefaultView = localStorage.getItem('contactsGridDefaultView')
    if (!savedDefaultView || savedDefaultView === 'default') {
      // No custom default view - load unfiltered list
      searchContacts('', {})
    }
    // If a default view exists, the contacts-data-grid will load it with its saved filters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Export state (admin only)
  const [exportSelectedOnly, setExportSelectedOnly] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Debounce search - responsive search timing


  // Initialize filtered contacts with all contacts when they're first loaded
  useEffect(() => {
    console.log('🔍 ContactsSection - Contacts changed:', {
      contacts,
      contactsLength: Array.isArray(contacts) ? contacts.length : 'Not an array',
      contactsType: typeof contacts,
      filteredContactsLength: filteredContacts.length,
      isArray: Array.isArray(contacts),
      firstContact: Array.isArray(contacts) ? contacts[0] : 'N/A'
    })

    if (contacts.length > 0 && filteredContacts.length === 0) {
      console.log('🔍 ContactsSection - Setting filtered contacts from context')
      setFilteredContacts(contacts)
    }
  }, [contacts, filteredContacts.length])


  // Use filtered contacts when a search or filters are active (even if zero results)
  const isFilteringActive = Boolean(currentQuery) || (currentFilters && Object.values(currentFilters).some(v => String(v).length > 0))
  const finalFilteredContacts = isFilteringActive ? filteredContacts : contacts



  const handleDeleteContact = (contactId: string) => {
    setContactToDelete(contactId)
    setShowDeleteDialog(true)
  }

  const handleBulkDelete = async (contactIds: string[]) => {
    try {
      // Delete each contact
      for (const contactId of contactIds) {
        await deleteContact(contactId)
      }
      // Clear selection after successful deletion
      setSelectedContactIds([])
      toast({
        title: "Success",
        description: `${contactIds.length} contact(s) deleted successfully`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete contacts",
        variant: "destructive",
      })
    }
  }

  const handleContactSelectionChange = (contactIds: string[]) => {
    setSelectedContactIds(contactIds)
    // Also update the selectedContacts array with actual contact objects
    const selectedContactObjects = finalFilteredContacts.filter(contact =>
      contactIds.includes(contact.id)
    )
    setSelectedContacts(selectedContactObjects)
  }

  const handleSelectAll = async () => {
    try {
      // Build params for fetching all contacts with current filters
      const params = new URLSearchParams({ page: '1', limit: '10000' })
      if (currentQuery) params.set('search', currentQuery)
      if (currentFilters) {
        Object.entries(currentFilters).forEach(([k, v]) => {
          if (v != null && String(v).length > 0) params.set(k, String(v))
        })
      }

      // Fetch all contacts matching current filters
      const res = await fetch(`/api/contacts?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch contacts')

      const data = await res.json()
      const allContacts = data.contacts || data

      if (Array.isArray(allContacts)) {
        const allContactIds = allContacts.map((contact: Contact) => contact.id)
        setSelectedContactIds(allContactIds)
        setSelectedContacts(allContacts)
        toast({
          title: "Success",
          description: `Selected ${allContacts.length} contacts`,
        })
      }
    } catch (error) {
      console.error('Error selecting all contacts:', error)
      toast({
        title: "Error",
        description: "Failed to select all contacts",
        variant: "destructive",
      })
    }
  }

  const handleDeselectAll = () => {
    setSelectedContactIds([])
    setSelectedContacts([])
  }

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact)
    setShowEditDialog(true)
  }

  const confirmDelete = () => {
    if (contactToDelete) {
      deleteContact(contactToDelete)
      setContactToDelete(null)
      setShowDeleteDialog(false)
      if (selectedContact?.id === contactToDelete) {
        setSelectedContact(null) // Clear selected contact if it was deleted
      }
    }
  }

  const handleAddContact = async (newContactData: Omit<Contact, "id" | "createdAt">) => {
    try {
      await addContact(newContactData as any)
      setShowAddDialog(false)
      toast({
        title: "Contact added",
        description: `${(newContactData as any).firstName || ''} ${(newContactData as any).lastName || ''} has been added successfully.`,
      })
    } catch (e) {
      console.error('Failed to add contact', e)
      toast({
        title: "Error",
        description: "Failed to add contact. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleUpdateContact = (id: string, updates: Partial<Contact>) => {
    updateContact(id, updates)
    setShowEditDialog(false)
    setEditingContact(null)
    if (selectedContact?.id === id) {
      setSelectedContact((prev) => (prev ? { ...prev, ...updates } : null))
    }
  }

  const handleContactSelect = (contact: Contact) => {
    setSelectedContact(contact)
  }


  // Export CSV handler (admin only)
  const handleExportCsv = async () => {
    if (!isAdmin) return
    try {
      setExporting(true)
      const payload: any = {
        ...currentFilters,
        search: currentQuery,
        exportAllMatching: !exportSelectedOnly,
      }
      if (exportSelectedOnly) {
        if (selectedContactIds.length === 0) {
          toast({ title: 'No contacts selected', description: 'Select one or more contacts to export, or switch to exporting all filtered contacts.', variant: 'destructive' })
          setExporting(false)
          return
        }
        payload.selectedIds = selectedContactIds
      }

      const res = await fetch('/api/admin/contacts/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || 'Failed to export contacts')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')
      a.download = `contacts-${ts}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed', e)
      toast({ title: 'Export failed', description: 'Please try again or adjust filters.', variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const handleBackToList = () => {
    setSelectedContact(null)
  }

  const hasActiveFilters = selectedContacts.length > 0


  return (
    <div className="min-h-full bg-background">
      {/* Just the data grid - no header, no old filters */}
      <ContactsDataGrid
        onContactSelect={handleContactSelect}
        onEditContact={handleEditContact}
        onDeleteContact={handleDeleteContact}
        onAddContact={() => setShowAddDialog(true)}
      />

      {/* Add Contact Dialog */}
      <AddContactDialog open={showAddDialog} onOpenChange={setShowAddDialog} onAddContact={handleAddContact} />

      {/* Edit Contact Dialog */}
      {editingContact && ( // Ensure editingContact is not null before rendering
        <EditContactDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          contact={editingContact}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this contact? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>


            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Contact Details Drawer */}
      <Sheet modal={false} open={!!selectedContact} onOpenChange={(open) => { if (!open) setSelectedContact(null) }}>
        <SheetContent
          side="right"
          className="w-[80vw] sm:max-w-[900px] lg:max-w-[1100px] p-0"
          overlayClassName="bg-transparent backdrop-blur-0 pointer-events-none"
        >
          {selectedContact && (
            <ContactDetails contact={selectedContact} onBack={() => setSelectedContact(null)} />
          )}
        </SheetContent>
      </Sheet>

      {/* Bulk Tag Operations Dialog */}
      <BulkTagOperations
        open={showBulkTagOperations}
        onOpenChange={setShowBulkTagOperations}
        selectedContactIds={selectedContactIds}
        onComplete={() => {
          // Refresh contacts to show updated tags
          searchContacts(currentQuery, currentFilters)
          // Clear selection
          setSelectedContactIds([])
          setSelectedContacts([])
        }}
      />

    </div>

  )
}
