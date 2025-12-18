'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Pipeline, PipelineStage, Lender } from '@/types/deals';
import AddContactDialog from '@/components/contacts/add-contact-dialog';

interface ContactProperty {
	id: string;
	address?: string;
	city?: string;
	state?: string;
	zipCode?: string;
	llcName?: string | null;
}

interface Contact {
	id: string;
	firstName?: string;
	lastName?: string;
	fullName?: string;
	propertyAddress?: string;
	city?: string;
	state?: string;
	zipCode?: string;
	llcName?: string | null;
	properties?: ContactProperty[];
}

// Helper to format number with commas
const formatNumberWithCommas = (value: string): string => {
  const num = value.replace(/[^0-9]/g, '');
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

// Helper to parse formatted number back to plain number string
const parseFormattedNumber = (value: string): string => {
  return value.replace(/,/g, '');
};

interface NewDealDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline?: Pipeline;
  lenders: Lender[];
  isLoanPipeline: boolean;
  onSuccess: () => void;
}

// Loan types as requested
const LOAN_TYPES = [
  'Cashout Refinance (DSCR)',
  'Rate/Term Refinance (DSCR)',
  'Purchase (DSCR)',
  'Fix & Flip (Bridge)',
  'Construction (Bridge)',
];

// Property types
const PROPERTY_TYPES = [
  'SFR (Single Family)',
  '2-4 Unit',
  'Multi-family (5+)',
  'Condo',
  'Townhome',
  'Mixed Use',
  'Commercial',
];

export default function NewDealDialogV2({
  open,
  onOpenChange,
  pipeline,
  lenders,
  isLoanPipeline,
  onSuccess,
}: NewDealDialogV2Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactSearchOpen, setContactSearchOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [isAddingNewProperty, setIsAddingNewProperty] = useState(false);
  const [showQuickAddContact, setShowQuickAddContact] = useState(false);
  const [quickContactName, setQuickContactName] = useState('');
  const [newPropertyAddress, setNewPropertyAddress] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    value: '',
    valueFormatted: '',
    contactId: '',
    stageId: '',
    expectedCloseDate: '',
    notes: '',
    // Loan-specific fields
    isLoanDeal: isLoanPipeline,
    lenderId: '',
    llcName: '',
    propertyAddress: '',
    propertyType: '',
    loanAmount: '',
    loanAmountFormatted: '',
    propertyValue: '',
    propertyValueFormatted: '',
    loanType: '',
    interestRate: '',
  });

  useEffect(() => {
    if (open) {
      loadContacts();
      // Set default stage
      if (pipeline?.stages?.length) {
        setFormData(prev => ({ ...prev, stageId: pipeline.stages[0].id }));
      }
    }
  }, [open, pipeline]);

  useEffect(() => {
    setFormData(prev => ({ ...prev, isLoanDeal: isLoanPipeline }));
  }, [isLoanPipeline]);

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const res = await fetch('/api/contacts?limit=1000&includeProperties=true');
      if (res.ok) {
        const data = await res.json();
        console.log('[NewDealDialog] Loaded contacts:', data.contacts?.length);
        setContacts(data.contacts || []);
      } else {
        console.error('[NewDealDialog] Failed to load contacts:', res.status);
      }
    } catch (error) {
      console.error('Error loading contacts:', error);
    } finally {
      setLoadingContacts(false);
    }
  };

  // Quick add contact
  const handleQuickAddContact = async () => {
    if (!quickContactName.trim()) return;

    const nameParts = quickContactName.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName }),
      });

      if (res.ok) {
        const data = await res.json();
        const newContact = data.contact;
        setContacts(prev => [newContact, ...prev]);
        setSelectedContact(newContact);
        setFormData(prev => ({ ...prev, contactId: newContact.id }));
        setShowQuickAddContact(false);
        setQuickContactName('');
        setContactSearchOpen(false);
        toast.success('Contact created');
      } else {
        toast.error('Failed to create contact');
      }
    } catch (error) {
      toast.error('Failed to create contact');
    }
  };

  // Filter contacts based on search
  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts;
    const search = contactSearch.toLowerCase();
    return contacts.filter(c => {
      const fullName = c.fullName || `${c.firstName || ''} ${c.lastName || ''}`;
      return fullName.toLowerCase().includes(search) ||
        c.llcName?.toLowerCase().includes(search) ||
        c.propertyAddress?.toLowerCase().includes(search);
    });
  }, [contacts, contactSearch]);

  // Get all properties for selected contact
  const contactProperties = useMemo(() => {
    if (!selectedContact) return [];
    const properties: { id: string; address: string; isNew?: boolean }[] = [];

    // Add primary property
    if (selectedContact.propertyAddress) {
      const fullAddress = [
        selectedContact.propertyAddress,
        selectedContact.city,
        selectedContact.state,
        selectedContact.zipCode
      ].filter(Boolean).join(', ');
      properties.push({ id: 'primary', address: fullAddress });
    }

    // Add additional properties
    if (selectedContact.properties) {
      selectedContact.properties.forEach(prop => {
        if (prop.propertyAddress) {
          const fullAddress = [
            prop.propertyAddress,
            prop.city,
            prop.state,
            prop.zipCode
          ].filter(Boolean).join(', ');
          properties.push({ id: prop.id, address: fullAddress });
        }
      });
    }

    return properties;
  }, [selectedContact]);

  const handleContactSelect = (contact: Contact) => {
    setSelectedContact(contact);
    setContactSearchOpen(false);
    setContactSearch('');

    // Build full property address
    const fullAddress = [
      contact.propertyAddress,
      contact.city,
      contact.state,
      contact.zipCode
    ].filter(Boolean).join(', ');

    setFormData(prev => ({
      ...prev,
      contactId: contact.id,
      propertyAddress: fullAddress || prev.propertyAddress,
      llcName: contact.llcName || prev.llcName,
    }));
  };

  const handleCurrencyInput = (field: 'value' | 'loanAmount' | 'propertyValue', inputValue: string) => {
    const plainValue = parseFormattedNumber(inputValue);
    const formattedValue = formatNumberWithCommas(plainValue);

    if (field === 'value') {
      setFormData(prev => ({ ...prev, value: plainValue, valueFormatted: formattedValue }));
    } else if (field === 'loanAmount') {
      setFormData(prev => ({ ...prev, loanAmount: plainValue, loanAmountFormatted: formattedValue }));
    } else if (field === 'propertyValue') {
      setFormData(prev => ({ ...prev, propertyValue: plainValue, propertyValueFormatted: formattedValue }));
    }
  };

  const calculateLTV = () => {
    const loanAmount = parseFloat(formData.loanAmount) || 0;
    const propertyValue = parseFloat(formData.propertyValue) || 0;
    if (propertyValue > 0) {
      return ((loanAmount / propertyValue) * 100).toFixed(1);
    }
    return '0';
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.contactId) {
      toast.error('Title and contact are required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.title,
          value: parseFloat(formData.value) || 0,
          contact_id: formData.contactId,
          stage_id: formData.stageId || null,
          expected_close_date: formData.expectedCloseDate || null,
          notes: formData.notes,
          pipeline: pipeline?.id || 'default',
          // Loan-specific fields
          is_loan_deal: formData.isLoanDeal,
          lender_id: formData.lenderId || null,
          llc_name: formData.llcName || null,
          property_address: formData.propertyAddress || null,
          property_type: formData.propertyType || null,
          loan_amount: formData.loanAmount ? parseFloat(formData.loanAmount) : null,
          property_value: formData.propertyValue ? parseFloat(formData.propertyValue) : null,
          ltv: formData.propertyValue ? parseFloat(calculateLTV()) : null,
          loan_type: formData.loanType || null,
          interest_rate: formData.interestRate ? parseFloat(formData.interestRate) : null,
        })
      });

      if (res.ok) {
        onSuccess();
        resetForm();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to create deal');
      }
    } catch (error) {
      toast.error('Failed to create deal');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSelectedContact(null);
    setContactSearch('');
    setShowQuickAddContact(false);
    setQuickContactName('');
    setIsAddingNewProperty(false);
    setNewPropertyAddress('');
    setFormData({
      title: '', value: '', valueFormatted: '', contactId: '', stageId: pipeline?.stages?.[0]?.id || '',
      expectedCloseDate: '', notes: '', isLoanDeal: isLoanPipeline, lenderId: '',
      llcName: '', propertyAddress: '', propertyType: '', loanAmount: '', loanAmountFormatted: '',
      propertyValue: '', propertyValueFormatted: '', loanType: '', interestRate: '',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New {isLoanPipeline ? 'Loan' : 'Deal'}</DialogTitle>
          <DialogDescription>
            Add a new {isLoanPipeline ? 'loan' : 'deal'} to {pipeline?.name || 'the pipeline'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Deal Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={isLoanPipeline ? "e.g., 123 Main St - DSCR Loan" : "e.g., Property Purchase"}
              />
            </div>
	            <div>
	              <Label>Contact *</Label>
	              <Popover open={contactSearchOpen} onOpenChange={setContactSearchOpen}>
	                <PopoverTrigger asChild>
	                  <Button
	                    variant="outline"
	                    role="combobox"
	                    aria-expanded={contactSearchOpen}
	                    className="w-full justify-between font-normal"
	                  >
	                    {selectedContact
	                      ? (selectedContact.fullName || `${selectedContact.firstName || ''} ${selectedContact.lastName || ''}`.trim())
	                      : "Search contacts..."}
	                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
	                  </Button>
	                </PopoverTrigger>
	                <PopoverContent
	                  className="w-[350px] p-0 z-[100]"
	                  align="start"
	                  side="bottom"
	                  sideOffset={4}
	                >
	                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search by name, LLC, or address..."
                      value={contactSearch}
                      onValueChange={setContactSearch}
                    />
                    {loadingContacts ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Loading contacts...</span>
                      </div>
                    ) : (
                      <>
                        {filteredContacts.length === 0 && !showQuickAddContact && (
                          <div className="py-4 px-2 text-center">
                            <p className="text-sm text-muted-foreground mb-3">No contacts found.</p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowQuickAddContact(true)}
                              className="gap-1"
                            >
                              <Plus className="h-4 w-4" />
                              Add New Contact
                            </Button>
                          </div>
                        )}
                        {showQuickAddContact && (
                          <div className="p-3 border-b">
                            <div className="flex gap-2">
                              <Input
                                placeholder="Full name (e.g., John Doe)"
                                value={quickContactName}
                                onChange={(e) => setQuickContactName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleQuickAddContact()}
                                autoFocus
                              />
                              <Button size="sm" onClick={handleQuickAddContact}>
                                Add
                              </Button>
                            </div>
                          </div>
                        )}
                        <CommandGroup className="max-h-[250px] overflow-y-auto">
                          {/* Quick add option at top */}
                          {!showQuickAddContact && filteredContacts.length > 0 && (
                            <CommandItem
                              value="__add_new__"
                              onSelect={() => setShowQuickAddContact(true)}
                              className="cursor-pointer border-b mb-1 text-primary"
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              <span>Add New Contact</span>
                            </CommandItem>
                          )}
                          {filteredContacts.slice(0, 50).map((contact) => {
                            const displayName = contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
                            return (
                              <CommandItem
                                key={contact.id}
                                value={`${displayName}-${contact.id}`}
                                onSelect={() => handleContactSelect(contact)}
                                className="cursor-pointer"
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedContact?.id === contact.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span>{displayName}</span>
                                  {contact.llcName && (
                                    <span className="text-xs text-muted-foreground">{contact.llcName}</span>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </>
                    )}
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={formData.stageId} onValueChange={(val) => setFormData({ ...formData, stageId: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select stage" />
                </SelectTrigger>
                <SelectContent>
                  {pipeline?.stages?.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color || '#e5e7eb' }} />
                        {stage.label || stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Value & Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Deal Value ($)</Label>
              <Input
                value={formData.valueFormatted}
                onChange={(e) => handleCurrencyInput('value', e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Expected Close Date</Label>
              <Input
                type="date"
                value={formData.expectedCloseDate}
                onChange={(e) => setFormData({ ...formData, expectedCloseDate: e.target.value })}
              />
            </div>
          </div>

          {/* Property Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Property Address</Label>
              {contactProperties.length > 0 && !isAddingNewProperty ? (
                <>
                  <Select
                    value={formData.propertyAddress}
                    onValueChange={(val) => {
                      if (val === '__new__') {
                        setIsAddingNewProperty(true);
                        setNewPropertyAddress('');
                      } else {
                        setFormData({ ...formData, propertyAddress: val });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      {contactProperties.map((prop) => (
                        <SelectItem key={prop.id} value={prop.address}>
                          {prop.address}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">
                        <div className="flex items-center gap-2 text-blue-600">
                          <Plus className="h-4 w-4" />
                          Add new property
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={isAddingNewProperty ? newPropertyAddress : formData.propertyAddress}
                    onChange={(e) => {
                      if (isAddingNewProperty) {
                        setNewPropertyAddress(e.target.value);
                        setFormData({ ...formData, propertyAddress: e.target.value });
                      } else {
                        setFormData({ ...formData, propertyAddress: e.target.value });
                      }
                    }}
                    placeholder="123 Main St, City, State"
                  />
                  {isAddingNewProperty && contactProperties.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsAddingNewProperty(false);
                        setNewPropertyAddress('');
                        // Reset to first property if available
                        if (contactProperties.length > 0) {
                          setFormData({ ...formData, propertyAddress: contactProperties[0].address });
                        }
                      }}
                      className="text-xs"
                    >
                      ← Back to existing properties
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>LLC Name</Label>
              <Input
                value={formData.llcName}
                onChange={(e) => setFormData({ ...formData, llcName: e.target.value })}
                placeholder="Borrowing Entity LLC"
              />
            </div>
          </div>

          {/* Property Type - for loan pipelines */}
          {isLoanPipeline && (
            <div>
              <Label>Property Type</Label>
              <Select value={formData.propertyType} onValueChange={(val) => setFormData({ ...formData, propertyType: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property type" />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Loan-specific fields */}
          {isLoanPipeline && (
            <>
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-3">Loan Details</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Lender</Label>
                    <Select value={formData.lenderId} onValueChange={(val) => setFormData({ ...formData, lenderId: val })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select lender" />
                      </SelectTrigger>
                      <SelectContent>
                        {lenders.map((lender) => (
                          <SelectItem key={lender.id} value={lender.id}>
                            {lender.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Loan Type</Label>
                    <Select value={formData.loanType} onValueChange={(val) => setFormData({ ...formData, loanType: val })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {LOAN_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Loan Amount ($)</Label>
                    <Input
                      value={formData.loanAmountFormatted}
                      onChange={(e) => handleCurrencyInput('loanAmount', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>Property Value ($)</Label>
                    <Input
                      value={formData.propertyValueFormatted}
                      onChange={(e) => handleCurrencyInput('propertyValue', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>LTV (%)</Label>
                    <Input value={calculateLTV()} disabled className="bg-gray-50" />
                  </div>
                  <div>
                    <Label>Interest Rate (%)</Label>
                    <Input
                      type="number"
                      step="0.125"
                      value={formData.interestRate}
                      onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })}
                      placeholder="0.000"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create {isLoanPipeline ? 'Loan' : 'Deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

