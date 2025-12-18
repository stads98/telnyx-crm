'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, GripVertical, Loader2, Pencil, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Pipeline, PipelineStage } from '@/types/deals';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface PipelineManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  onPipelinesChange: () => void;
}

const STAGE_COLORS = [
  '#6B7280', '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'
];

// Sortable Stage Item Component
function SortableStageItem({
  stage,
  onDelete
}: {
  stage: PipelineStage;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 bg-white"
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-gray-400" />
        </div>
        <div
          className="w-4 h-4 rounded"
          style={{ backgroundColor: stage.color || '#6B7280' }}
        />
        <span>{stage.label || stage.name}</span>
        {stage.isClosedStage && (
          <Badge variant="outline" className="text-xs text-green-600">Won</Badge>
        )}
        {stage.isLostStage && (
          <Badge variant="outline" className="text-xs text-red-600">Lost</Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-red-600 hover:text-red-700"
        onClick={() => onDelete(stage.id)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function PipelineManagementDialog({
  open,
  onOpenChange,
  pipelines,
  onPipelinesChange,
}: PipelineManagementDialogProps) {
  const [activeTab, setActiveTab] = useState<'pipelines' | 'stages'>('pipelines');
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  // New pipeline form
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newPipelineIsLoan, setNewPipelineIsLoan] = useState(false);
  
  // Edit pipeline form
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  
  // Stages for selected pipeline
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6B7280');

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (selectedPipelineId) {
      const pipeline = pipelines.find(p => p.id === selectedPipelineId);
      setStages(pipeline?.stages || []);
    }
  }, [selectedPipelineId, pipelines]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !selectedPipelineId) return;

    const oldIndex = stages.findIndex(s => s.id === active.id);
    const newIndex = stages.findIndex(s => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistically update UI
    const newStages = arrayMove(stages, oldIndex, newIndex);
    setStages(newStages);

    // Save to server
    try {
      const res = await fetch(`/api/pipelines/${selectedPipelineId}/stages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageIds: newStages.map(s => s.id) }),
      });

      if (res.ok) {
        toast.success('Stage order updated');
        onPipelinesChange();
      } else {
        // Revert on error
        setStages(stages);
        toast.error('Failed to update stage order');
      }
    } catch (error) {
      // Revert on error
      setStages(stages);
      toast.error('Failed to update stage order');
    }
  };

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) {
      toast.error('Please enter a pipeline name');
      return;
    }

    setSaving(true);
    try {
      const defaultStages = newPipelineIsLoan
        ? [
            { key: 'new_lead', label: 'New Lead', color: '#6B7280', defaultProbability: 10 },
            { key: 'qualified', label: 'Qualified', color: '#3B82F6', defaultProbability: 25 },
            { key: 'application', label: 'Application', color: '#F59E0B', defaultProbability: 40 },
            { key: 'processing', label: 'Processing', color: '#8B5CF6', defaultProbability: 60 },
            { key: 'underwriting', label: 'Underwriting', color: '#06B6D4', defaultProbability: 75 },
            { key: 'approved', label: 'Approved', color: '#22C55E', defaultProbability: 90 },
            { key: 'closed', label: 'Closed', color: '#10B981', defaultProbability: 100, isClosedStage: true },
            { key: 'lost', label: 'Lost', color: '#EF4444', defaultProbability: 0, isLostStage: true },
          ]
        : [
            { key: 'lead', label: 'Lead', color: '#6B7280', defaultProbability: 10 },
            { key: 'contacted', label: 'Contacted', color: '#3B82F6', defaultProbability: 25 },
            { key: 'qualified', label: 'Qualified', color: '#F59E0B', defaultProbability: 50 },
            { key: 'proposal', label: 'Proposal', color: '#8B5CF6', defaultProbability: 75 },
            { key: 'closed_won', label: 'Closed Won', color: '#22C55E', defaultProbability: 100, isClosedStage: true },
            { key: 'closed_lost', label: 'Closed Lost', color: '#EF4444', defaultProbability: 0, isLostStage: true },
          ];

      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPipelineName,
          isLoanPipeline: newPipelineIsLoan,
          stages: defaultStages,
        }),
      });

      if (res.ok) {
        toast.success('Pipeline created');
        setNewPipelineName('');
        setNewPipelineIsLoan(false);
        onPipelinesChange();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to create pipeline');
      }
    } catch (error) {
      toast.error('Failed to create pipeline');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (pipelineId: string) => {
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });

      if (res.ok) {
        toast.success('Default pipeline updated');
        onPipelinesChange();
      }
    } catch (error) {
      toast.error('Failed to set default');
    }
  };

  const handleDeletePipeline = async (pipelineId: string) => {
    if (!confirm('Are you sure you want to delete this pipeline? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/pipelines/${pipelineId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Pipeline deleted');
        onPipelinesChange();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to delete pipeline');
      }
    } catch (error) {
      toast.error('Failed to delete pipeline');
    }
  };

  const handleAddStage = async () => {
    if (!selectedPipelineId || !newStageName.trim()) {
      toast.error('Please enter a stage name');
      return;
    }

    setSaving(true);
    try {
      const newStage = {
        key: newStageName.toLowerCase().replace(/\s+/g, '_'),
        label: newStageName,
        color: newStageColor,
        orderIndex: stages.length,
        defaultProbability: 50,
      };

      const res = await fetch(`/api/pipelines/${selectedPipelineId}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStage),
      });

      if (res.ok) {
        toast.success('Stage added');
        setNewStageName('');
        setNewStageColor('#6B7280');
        onPipelinesChange();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to add stage');
      }
    } catch (error) {
      toast.error('Failed to add stage');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    if (!selectedPipelineId) return;
    if (!confirm('Delete this stage? Deals in this stage will need to be moved.')) return;

    try {
      const res = await fetch(`/api/pipelines/${selectedPipelineId}/stages/${stageId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Stage deleted');
        onPipelinesChange();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to delete stage');
      }
    } catch (error) {
      toast.error('Failed to delete stage');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Pipelines</DialogTitle>
          <DialogDescription>Create, edit, and manage your deal pipelines and stages.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipelines' | 'stages')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
            <TabsTrigger value="stages">Stages</TabsTrigger>
          </TabsList>

          <TabsContent value="pipelines" className="space-y-4 mt-4">
            {/* Create New Pipeline */}
            <div className="border rounded-lg p-4 bg-gray-50">
              <h4 className="font-medium mb-3">Create New Pipeline</h4>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label>Pipeline Name</Label>
                  <Input
                    value={newPipelineName}
                    onChange={(e) => setNewPipelineName(e.target.value)}
                    placeholder="e.g., Sales Pipeline"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={newPipelineIsLoan}
                    onCheckedChange={setNewPipelineIsLoan}
                  />
                  <Label className="text-sm">Loan Pipeline</Label>
                </div>
                <Button onClick={handleCreatePipeline} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  Create
                </Button>
              </div>
            </div>

            {/* Existing Pipelines */}
            <div className="space-y-2">
              <h4 className="font-medium">Existing Pipelines</h4>
              {pipelines.map((pipeline) => (
                <div
                  key={pipeline.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    {pipeline.isDefault && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />}
                    <span className="font-medium">{pipeline.name}</span>
                    {pipeline.isLoanPipeline && (
                      <Badge variant="outline" className="text-xs">Loan</Badge>
                    )}
                    <span className="text-sm text-gray-500">
                      {pipeline.stages?.length || 0} stages
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!pipeline.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefault(pipeline.id)}
                      >
                        Set Default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedPipelineId(pipeline.id);
                        setActiveTab('stages');
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDeletePipeline(pipeline.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="stages" className="space-y-4 mt-4">
            {/* Pipeline Selector */}
            <div>
              <Label>Select Pipeline to Edit Stages</Label>
              <select
                className="w-full mt-1 p-2 border rounded-md"
                value={selectedPipelineId || ''}
                onChange={(e) => setSelectedPipelineId(e.target.value || null)}
              >
                <option value="">Select a pipeline...</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedPipelineId && (
              <>
                {/* Add New Stage */}
                <div className="border rounded-lg p-4 bg-gray-50">
                  <h4 className="font-medium mb-3">Add New Stage</h4>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label>Stage Name</Label>
                      <Input
                        value={newStageName}
                        onChange={(e) => setNewStageName(e.target.value)}
                        placeholder="e.g., Under Review"
                      />
                    </div>
                    <div>
                      <Label>Color</Label>
                      <div className="flex gap-1 mt-1">
                        {STAGE_COLORS.slice(0, 6).map((color) => (
                          <button
                            key={color}
                            className={`w-6 h-6 rounded ${newStageColor === color ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setNewStageColor(color)}
                          />
                        ))}
                      </div>
                    </div>
                    <Button onClick={handleAddStage} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                      Add
                    </Button>
                  </div>
                </div>

                {/* Existing Stages with Drag and Drop */}
                <div className="space-y-2">
                  <h4 className="font-medium">Pipeline Stages (drag to reorder)</h4>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={stages.map(s => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {stages.map((stage) => (
                          <SortableStageItem
                            key={stage.id}
                            stage={stage}
                            onDelete={handleDeleteStage}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

