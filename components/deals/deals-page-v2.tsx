'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, LayoutGrid, List, Loader2, FileText, Star, Settings, MoreVertical, Trophy, XCircle, Archive, Calendar, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import { toast } from 'sonner';
import { Deal, Pipeline, PipelineStage, Lender } from '@/types/deals';
import DealsKanbanView from './deals-kanban-view';
import DealsTableView from './deals-table-view';
import NewDealDialogV2 from './new-deal-dialog-v2';
import PipelineManagementDialog from './pipeline-management-dialog';
import { useGlobalCache } from '@/lib/stores/useGlobalCache';

interface DealsPageV2Props {
  initialPipelineId?: string;
}

export default function DealsPageV2({ initialPipelineId }: DealsPageV2Props) {
  // Global cache for instant loading
  const globalCache = useGlobalCache();
  const initialLoadDone = useRef(false);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(initialPipelineId || '');
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [loading, setLoading] = useState(true);
  const [showNewDealDialog, setShowNewDealDialog] = useState(false);
  const [showPipelineManagement, setShowPipelineManagement] = useState(false);

  // Status filters
  const [showWon, setShowWon] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month' | 'quarter' | 'year'>('all');

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const isLoanPipeline = selectedPipeline?.isLoanPipeline || false;

  // Define loadPipelines with caching
  const loadPipelines = async () => {
    try {
      // Check cache first for instant load
      const cachedPipelines = globalCache.getCached<Pipeline[]>('pipelines');
      if (cachedPipelines && cachedPipelines.length > 0) {
        setPipelines(cachedPipelines);
        if (!selectedPipelineId) {
          const defaultPipeline = cachedPipelines.find((p: Pipeline) => p.isDefault) || cachedPipelines[0];
          setSelectedPipelineId(defaultPipeline.id);
        }
        // Background refresh if stale
        if (!globalCache.isCacheFresh('pipelines')) {
          fetchFreshPipelines();
        }
        return;
      }

      await fetchFreshPipelines();
    } catch (error) {
      console.error('Error loading pipelines:', error);
      toast.error('Failed to load pipelines');
    }
  };

  const fetchFreshPipelines = async () => {
    const res = await fetch('/api/pipelines?includeStages=true');
    if (res.ok) {
      const data = await res.json();
      const pipelinesList = data.pipelines || [];
      setPipelines(pipelinesList);
      globalCache.setPipelines(pipelinesList);
      if (!selectedPipelineId && pipelinesList.length > 0) {
        const defaultPipeline = pipelinesList.find((p: Pipeline) => p.isDefault) || pipelinesList[0];
        setSelectedPipelineId(defaultPipeline.id);
      }
    }
  };

  // Define loadLenders
  const loadLenders = async () => {
    try {
      const res = await fetch('/api/lenders');
      if (res.ok) {
        const data = await res.json();
        setLenders(data.lenders || []);
      }
    } catch (error) {
      console.error('Error loading lenders:', error);
    }
  };

  // Define loadDeals with useCallback and caching
  const loadDeals = useCallback(async () => {
    if (!selectedPipelineId) return;

    try {
      // Check cache first for instant load (only for default view without filters)
      const cachedDeals = globalCache.getCached<Deal[]>('deals');
      if (cachedDeals && !showWon && !showLost && !showArchived && !initialLoadDone.current) {
        setDeals(cachedDeals);
        setLoading(false);
        initialLoadDone.current = true;
        // Background refresh - inline the fetch logic
        const params = new URLSearchParams({ pipelineId: selectedPipelineId });
        fetch(`/api/deals?${params.toString()}`).then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const dealsList = data.deals || [];
            setDeals(dealsList);
            globalCache.setDeals(dealsList);
          }
        });
        return;
      }

      setLoading(true);
      const params = new URLSearchParams({ pipelineId: selectedPipelineId });
      if (showWon) params.append('showWon', 'true');
      if (showLost) params.append('showLost', 'true');
      if (showArchived) params.append('showArchived', 'true');

      const res = await fetch(`/api/deals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const dealsList = data.deals || [];
        setDeals(dealsList);
        // Only cache default view
        if (!showWon && !showLost && !showArchived) {
          globalCache.setDeals(dealsList);
        }
      }
    } catch (error) {
      console.error('Error loading deals:', error);
      toast.error('Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId, showWon, showLost, showArchived, globalCache]);

  // Load pipelines on mount
  useEffect(() => {
    loadPipelines();
    loadLenders();
  }, []);

  // Load deals when pipeline or filters change
  useEffect(() => {
    if (selectedPipelineId) {
      loadDeals();
    }
  }, [selectedPipelineId, showWon, showLost, showArchived, loadDeals]);

  const handleDealCreated = () => {
    setShowNewDealDialog(false);
    loadDeals();
    toast.success('Deal created successfully');
  };

  const handleDealUpdated = () => {
    loadDeals();
  };

  const handleStageChange = async (dealId: string, newStageId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...deal,
          stage_id: newStageId,
          name: deal.title,
          contact_id: deal.contactId,
        })
      });

      if (res.ok) {
        toast.success('Deal stage updated');
        loadDeals();
      } else {
        toast.error('Failed to update deal stage');
      }
    } catch (error) {
      toast.error('Failed to update deal stage');
    }
  };

  const handleSetAsDefault = async (pipelineId: string) => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true })
      });

      if (res.ok) {
        toast.success('Default pipeline updated');
        loadPipelines();
      } else {
        toast.error('Failed to set default pipeline');
      }
    } catch (error) {
      toast.error('Failed to set default pipeline');
    }
  };

  // Calculate pipeline stats
  const stats = {
    totalDeals: deals.length,
    totalValue: deals.reduce((sum, d) => sum + (d.value || 0), 0),
    avgProbability: deals.length > 0 
      ? Math.round(deals.reduce((sum, d) => sum + (d.probability || 0), 0) / deals.length)
      : 0,
    weightedValue: deals.reduce((sum, d) => sum + ((d.value || 0) * (d.probability || 0) / 100), 0),
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Deals</h1>
            {/* Pipeline Selector */}
            <div className="flex items-center gap-1">
              <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      <div className="flex items-center gap-2">
                        {pipeline.isDefault && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                        {pipeline.isLoanPipeline && <FileText className="h-4 w-4 text-blue-500" />}
                        {pipeline.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => handleSetAsDefault(selectedPipelineId)}
                    disabled={selectedPipeline?.isDefault}
                  >
                    <Star className="h-4 w-4 mr-2" />
                    {selectedPipeline?.isDefault ? 'Default Pipeline' : 'Set as Default'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowPipelineManagement(true)}>
                    <Settings className="h-4 w-4 mr-2" />
                    Manage Pipelines
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'kanban' | 'table')}>
              <TabsList>
                <TabsTrigger value="kanban" className="gap-1">
                  <LayoutGrid className="h-4 w-4" />
                  Kanban
                </TabsTrigger>
                <TabsTrigger value="table" className="gap-1">
                  <List className="h-4 w-4" />
                  Table
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button variant="outline" size="icon" onClick={loadDeals} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>

            <Button onClick={() => setShowNewDealDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New {isLoanPipeline ? 'Loan' : 'Deal'}
            </Button>
          </div>
        </div>

        {/* Stats Bar + Filters */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Total Deals:</span>{' '}
              <span className="font-semibold">{stats.totalDeals}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Value:</span>{' '}
              <span className="font-semibold text-green-600">{formatCurrency(stats.totalValue)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Weighted Value:</span>{' '}
              <span className="font-semibold text-blue-600">{formatCurrency(stats.weightedValue)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Probability:</span>{' '}
              <span className="font-semibold">{stats.avgProbability}%</span>
            </div>
          </div>

          {/* Status Filters */}
          <div className="flex items-center gap-2">
            <Toggle
              pressed={showWon}
              onPressedChange={setShowWon}
              size="sm"
              className="gap-1 data-[state=on]:bg-green-100 data-[state=on]:text-green-700"
            >
              <Trophy className="h-3.5 w-3.5" />
              Won
            </Toggle>
            <Toggle
              pressed={showLost}
              onPressedChange={setShowLost}
              size="sm"
              className="gap-1 data-[state=on]:bg-red-100 data-[state=on]:text-red-700"
            >
              <XCircle className="h-3.5 w-3.5" />
              Lost
            </Toggle>
            <Toggle
              pressed={showArchived}
              onPressedChange={setShowArchived}
              size="sm"
              className="gap-1 data-[state=on]:bg-gray-100 data-[state=on]:text-gray-700"
            >
              <Archive className="h-3.5 w-3.5" />
              Archived
            </Toggle>
            <div className="h-4 w-px bg-border mx-1" />
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as typeof dateRange)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <Calendar className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="quarter">This Quarter</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : viewMode === 'kanban' ? (
          <DealsKanbanView
            deals={deals}
            stages={selectedPipeline?.stages || []}
            isLoanPipeline={isLoanPipeline}
            onStageChange={handleStageChange}
            onDealUpdated={handleDealUpdated}
            onRefresh={loadDeals}
          />
        ) : (
          <DealsTableView
            deals={deals}
            stages={selectedPipeline?.stages || []}
            isLoanPipeline={isLoanPipeline}
            onDealUpdated={handleDealUpdated}
            onRefresh={loadDeals}
          />
        )}
      </div>

      {/* New Deal Dialog */}
      <NewDealDialogV2
        open={showNewDealDialog}
        onOpenChange={setShowNewDealDialog}
        pipeline={selectedPipeline}
        lenders={lenders}
        isLoanPipeline={isLoanPipeline}
        onSuccess={handleDealCreated}
      />

      {/* Pipeline Management Dialog */}
      <PipelineManagementDialog
        open={showPipelineManagement}
        onOpenChange={setShowPipelineManagement}
        pipelines={pipelines}
        onPipelinesChange={loadPipelines}
      />
    </div>
  );
}

