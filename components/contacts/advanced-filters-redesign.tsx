"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, MapPin, Building2, DollarSign, Tag, Calendar } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useContacts } from "@/lib/context/contacts-context"
import { useLocalFilters } from "@/components/calls/local-filter-wrapper"

interface AdvancedFiltersRedesignProps {
  onClose?: () => void
  useLocalContext?: boolean
}

export default function AdvancedFiltersRedesign({ onClose, useLocalContext = false }: AdvancedFiltersRedesignProps) {
  const { toast } = useToast()

  // Use local context if specified, otherwise use global context
  const globalContext = useContacts()
  let localContext
  try {
    localContext = useLocalFilters()
  } catch {
    // Not inside LocalFilterWrapper, that's fine
    localContext = null
  }

  const context = useLocalContext && localContext ? localContext : globalContext
  const { filterOptions, searchContacts, currentFilters, refreshFilterOptions } = context

  // Pending filters (not applied until user clicks Apply)
  const [pendingFilters, setPendingFilters] = useState<{[key: string]: string[]}>({})

  // Search within filter options
  const [filterSearchQueries, setFilterSearchQueries] = useState<{[key: string]: string}>({
    state: "",
    city: "",
    propertyCounty: "",
    propertyType: "",
    tags: ""
  })

  // Number range inputs
  const [minValue, setMinValue] = useState<string>("")
  const [maxValue, setMaxValue] = useState<string>("")
  const [minEquity, setMinEquity] = useState<string>("")
  const [maxEquity, setMaxEquity] = useState<string>("")

  // Date range inputs for property sold date
  const [soldDatePreset, setSoldDatePreset] = useState<string>("")
  const [soldDateFrom, setSoldDateFrom] = useState<string>("")
  const [soldDateTo, setSoldDateTo] = useState<string>("")

  // Helper function to calculate date ranges for presets
  const applyDatePreset = (preset: string) => {
    const today = new Date()
    let from = ""
    let to = today.toISOString().split('T')[0]

    switch (preset) {
      case "last_week":
        from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        break
      case "last_month":
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        break
      case "last_3_months":
        from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        break
      case "last_6_months":
        from = new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        break
      case "last_year":
        from = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        break
      case "custom":
        // Don't change dates for custom
        return
      default:
        from = ""
        to = ""
    }

    setSoldDateFrom(from)
    setSoldDateTo(to)
  }

  // Initialize from current filters
  useEffect(() => {
    if (currentFilters) {
      const filters: {[key: string]: string[]} = {}
      Object.entries(currentFilters).forEach(([key, value]) => {
        if (typeof value === 'string' && value.includes(',')) {
          filters[key] = value.split(',')
        } else if (typeof value === 'string' && value.length > 0) {
          if (!['minValue', 'maxValue', 'minEquity', 'maxEquity', 'soldDateFrom', 'soldDateTo'].includes(key)) {
            filters[key] = [value]
          }
        }
      })
      setPendingFilters(filters)

      if (currentFilters.minValue) setMinValue(currentFilters.minValue)
      if (currentFilters.maxValue) setMaxValue(currentFilters.maxValue)
      if (currentFilters.minEquity) setMinEquity(currentFilters.minEquity)
      if (currentFilters.maxEquity) setMaxEquity(currentFilters.maxEquity)
      if (currentFilters.soldDateFrom) setSoldDateFrom(currentFilters.soldDateFrom)
      if (currentFilters.soldDateTo) setSoldDateTo(currentFilters.soldDateTo)
    }
  }, [currentFilters])

  // Load filter options on mount
  useEffect(() => {
    refreshFilterOptions()
  }, [])

  const handleFilterChange = (field: string, value: string, checked: boolean) => {
    setPendingFilters(prev => {
      const current = prev[field] || []
      if (checked) {
        return { ...prev, [field]: [...current, value] }
      } else {
        return { ...prev, [field]: current.filter(v => v !== value) }
      }
    })
  }

  const handleApplyFilters = () => {
    // Validate number inputs
    if (minValue !== "" && maxValue !== "" && Number(minValue) > Number(maxValue)) {
      toast({
        title: "Invalid Range",
        description: "Minimum value cannot be greater than maximum value",
        variant: "destructive"
      })
      return
    }
    if (minEquity !== "" && maxEquity !== "" && Number(minEquity) > Number(maxEquity)) {
      toast({
        title: "Invalid Range",
        description: "Minimum equity cannot be greater than maximum equity",
        variant: "destructive"
      })
      return
    }

    // Build filters object
    const filters = Object.entries(pendingFilters).reduce((acc, [key, values]) => {
      if (values.length > 0) {
        acc[key] = values.join(',')
      }
      return acc
    }, {} as any)

    if (minValue !== "") filters.minValue = minValue
    if (maxValue !== "") filters.maxValue = maxValue
    if (minEquity !== "") filters.minEquity = minEquity
    if (maxEquity !== "") filters.maxEquity = maxEquity
    if (soldDateFrom !== "") filters.soldDateFrom = soldDateFrom
    if (soldDateTo !== "") filters.soldDateTo = soldDateTo

    // Apply filters via context (this will trigger API call with pagination)
    searchContacts('', filters)

    toast({
      title: "Filters Applied",
      description: "Contact list updated with selected filters",
    })

    if (onClose) onClose()
  }

  const handleResetFilters = () => {
    setPendingFilters({})
    setMinValue("")
    setMaxValue("")
    setMinEquity("")
    setMaxEquity("")
    setSoldDatePreset("")
    setSoldDateFrom("")
    setSoldDateTo("")
    setFilterSearchQueries({
      state: "",
      city: "",
      propertyCounty: "",
      propertyType: "",
      tags: ""
    })

    // Reset filters in context
    searchContacts('', {})

    toast({
      title: "Filters Reset",
      description: "All filters have been cleared",
    })
  }

  const hasActiveFilters = Object.values(pendingFilters).some(values => values.length > 0) ||
    minValue !== "" || maxValue !== "" || minEquity !== "" || maxEquity !== "" ||
    soldDateFrom !== "" || soldDateTo !== ""

  const activeFilterCount = Object.values(pendingFilters).reduce((count, values) => count + values.length, 0) +
    (minValue !== "" ? 1 : 0) + (maxValue !== "" ? 1 : 0) +
    (minEquity !== "" ? 1 : 0) + (maxEquity !== "" ? 1 : 0) +
    (soldDateFrom !== "" || soldDateTo !== "" ? 1 : 0)

  return (
    <div className="space-y-4">
      {/* Filter Actions */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {activeFilterCount > 0 ? (
            <span className="font-medium text-primary">{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} selected</span>
          ) : (
            <span>No filters applied</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={handleResetFilters}>
              <X className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          )}
          <Button size="sm" onClick={handleApplyFilters} className="bg-primary hover:bg-primary/90">
            Apply Filters
          </Button>
        </div>
      </div>

      {/* Tabs for Filter Sections */}
      <Tabs defaultValue="location" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="location" className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Location
            {(pendingFilters['state']?.length || pendingFilters['city']?.length || pendingFilters['propertyCounty']?.length) ? (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary h-5 px-1.5 text-xs">
                {(pendingFilters['state']?.length || 0) + (pendingFilters['city']?.length || 0) + (pendingFilters['propertyCounty']?.length || 0)}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="property" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Property
            {pendingFilters['propertyType']?.length ? (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary h-5 px-1.5 text-xs">
                {pendingFilters['propertyType'].length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="financial" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Financial
            {(minValue || maxValue || minEquity || maxEquity) ? (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary h-5 px-1.5 text-xs">
                {(minValue ? 1 : 0) + (maxValue ? 1 : 0) + (minEquity ? 1 : 0) + (maxEquity ? 1 : 0)}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="dates" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Dates
            {(soldDateFrom || soldDateTo) ? (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary h-5 px-1.5 text-xs">
                1
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="tags" className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Tags
            {pendingFilters['tags']?.length ? (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary h-5 px-1.5 text-xs">
                {pendingFilters['tags'].length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* Location Tab Content */}
        <TabsContent value="location" className="mt-4">
          <div className="grid grid-cols-3 gap-4 pt-2 pb-4">
            {/* State */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">State</Label>
              <Input
                placeholder="Search..."
                value={filterSearchQueries.state}
                onChange={(e) => setFilterSearchQueries({...filterSearchQueries, state: e.target.value})}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-32 border rounded-md p-2 bg-white">
                <div className="space-y-1.5">
                  {(filterOptions?.states || [])
                    .filter((option: string) => option.toLowerCase().includes(filterSearchQueries.state.toLowerCase()))
                    .slice(0, 100).map((option: string) => (
                      <div key={`state-${option}`} className="flex items-center space-x-2">
                        <Checkbox
                          id={`state-${option}`}
                          checked={pendingFilters['state']?.includes(option) || false}
                          onCheckedChange={(checked) => handleFilterChange('state', option, checked as boolean)}
                        />
                        <Label htmlFor={`state-${option}`} className="text-xs cursor-pointer flex-1 font-normal">
                          {option}
                        </Label>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>

            {/* City */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">City</Label>
              <Input
                placeholder="Search..."
                value={filterSearchQueries.city}
                onChange={(e) => setFilterSearchQueries({...filterSearchQueries, city: e.target.value})}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-32 border rounded-md p-2 bg-white">
                <div className="space-y-1.5">
                  {(filterOptions?.cities || [])
                    .filter((option: string) => option.toLowerCase().includes(filterSearchQueries.city.toLowerCase()))
                    .slice(0, 100).map((option: string) => (
                      <div key={`city-${option}`} className="flex items-center space-x-2">
                        <Checkbox
                          id={`city-${option}`}
                          checked={pendingFilters['city']?.includes(option) || false}
                          onCheckedChange={(checked) => handleFilterChange('city', option, checked as boolean)}
                        />
                        <Label htmlFor={`city-${option}`} className="text-xs cursor-pointer flex-1 font-normal">
                          {option}
                        </Label>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>

            {/* County */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">County</Label>
              <Input
                placeholder="Search..."
                value={filterSearchQueries.propertyCounty}
                onChange={(e) => setFilterSearchQueries({...filterSearchQueries, propertyCounty: e.target.value})}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-32 border rounded-md p-2 bg-white">
                <div className="space-y-1.5">
                  {(filterOptions?.counties || [])
                    .filter((option: string) => option.toLowerCase().includes(filterSearchQueries.propertyCounty.toLowerCase()))
                    .slice(0, 100).map((option: string) => (
                      <div key={`county-${option}`} className="flex items-center space-x-2">
                        <Checkbox
                          id={`county-${option}`}
                          checked={pendingFilters['propertyCounty']?.includes(option) || false}
                          onCheckedChange={(checked) => handleFilterChange('propertyCounty', option, checked as boolean)}
                        />
                        <Label htmlFor={`county-${option}`} className="text-xs cursor-pointer flex-1 font-normal">
                          {option}
                        </Label>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        {/* Property Type Tab Content */}
        <TabsContent value="property" className="mt-4">
          <div className="pt-2 pb-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">Property Type</Label>
              <Input
                placeholder="Search..."
                value={filterSearchQueries.propertyType}
                onChange={(e) => setFilterSearchQueries({...filterSearchQueries, propertyType: e.target.value})}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-32 border rounded-md p-2 bg-white">
                <div className="grid grid-cols-2 gap-2">
                  {(filterOptions?.propertyTypes || [])
                    .filter((option: string) => option.toLowerCase().includes(filterSearchQueries.propertyType.toLowerCase()))
                    .slice(0, 50).map((option: string) => (
                      <div key={`ptype-${option}`} className="flex items-center space-x-2">
                        <Checkbox
                          id={`ptype-${option}`}
                          checked={pendingFilters['propertyType']?.includes(option) || false}
                          onCheckedChange={(checked) => handleFilterChange('propertyType', option, checked as boolean)}
                        />
                        <Label htmlFor={`ptype-${option}`} className="text-xs cursor-pointer flex-1 font-normal">
                          {option}
                        </Label>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        {/* Financial Tab Content */}
        <TabsContent value="financial" className="mt-4">
          <div className="pt-2 pb-4 space-y-4">
            {/* Property Value Range */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">Property Value Range</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Input
                    type="number"
                    placeholder="Min Value"
                    value={minValue}
                    onChange={(e) => setMinValue(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    placeholder="Max Value"
                    value={maxValue}
                    onChange={(e) => setMaxValue(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Equity Range */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">Equity Range</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Input
                    type="number"
                    placeholder="Min Equity"
                    value={minEquity}
                    onChange={(e) => setMinEquity(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    placeholder="Max Equity"
                    value={maxEquity}
                    onChange={(e) => setMaxEquity(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Dates Tab Content */}
        <TabsContent value="dates" className="mt-4">
          <div className="pt-2 pb-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-gray-700">Property Sold Date</Label>
                <Select
                  value={soldDatePreset}
                  onValueChange={(value) => {
                    setSoldDatePreset(value)
                    applyDatePreset(value)
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select date range..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last_week">Last Week</SelectItem>
                    <SelectItem value="last_month">Last Month</SelectItem>
                    <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                    <SelectItem value="last_6_months">Last 6 Months</SelectItem>
                    <SelectItem value="last_year">Last Year</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom date range inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-700">From Date</Label>
                  <Input
                    type="date"
                    value={soldDateFrom}
                    onChange={(e) => {
                      setSoldDateFrom(e.target.value)
                      setSoldDatePreset("custom")
                    }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-700">To Date</Label>
                  <Input
                    type="date"
                    value={soldDateTo}
                    onChange={(e) => {
                      setSoldDateTo(e.target.value)
                      setSoldDatePreset("custom")
                    }}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              {(soldDateFrom || soldDateTo) && (
                <div className="text-xs text-muted-foreground">
                  Filtering properties sold {soldDateFrom && `from ${soldDateFrom}`} {soldDateTo && `to ${soldDateTo}`}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Tags Tab Content */}
        <TabsContent value="tags" className="mt-4">
          <div className="pt-2 pb-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-gray-700">Tags</Label>
              <Input
                placeholder="Search..."
                value={filterSearchQueries.tags}
                onChange={(e) => setFilterSearchQueries({...filterSearchQueries, tags: e.target.value})}
                className="h-8 text-sm"
              />
              <ScrollArea className="h-32 border rounded-md p-2 bg-white">
                <div className="grid grid-cols-2 gap-2">
                  {(filterOptions?.tags?.map((t: any) => t.name) || [])
                    .filter((tagName: string) => tagName.toLowerCase().includes(filterSearchQueries.tags.toLowerCase()))
                    .slice(0, 200).map((tagName: string) => (
                      <div key={`tag-${tagName}`} className="flex items-center space-x-2">
                        <Checkbox
                          id={`tag-${tagName}`}
                          checked={pendingFilters['tags']?.includes(tagName) || false}
                          onCheckedChange={(checked) => handleFilterChange('tags', tagName, checked as boolean)}
                        />
                        <Label htmlFor={`tag-${tagName}`} className="text-xs cursor-pointer flex-1 font-normal">
                          {tagName}
                        </Label>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
