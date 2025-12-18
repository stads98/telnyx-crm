'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Wand2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Eye,
  Download,
  Trash2,
  FileText,
  FileSpreadsheet,
  File,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

interface LoanChecklistProps {
  dealId: string;
  loanType?: string;
}

interface LoanDocument {
  id: string;
  originalName: string;
  storedName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  fileExtension: string | null;
  uploadedAt: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  category: 'BORROWER' | 'PROPERTY' | 'TITLE' | 'INSURANCE' | 'OTHER';
  completed: boolean;
  required: boolean;
  notes?: string;
  documents: LoanDocument[];
}

const CATEGORY_LABELS: Record<string, string> = {
  BORROWER: 'Borrower Docs',
  PROPERTY: 'Property Docs',
  TITLE: 'Title Docs',
  INSURANCE: 'Insurance Docs',
  OTHER: 'Other',
};

const CATEGORY_ORDER = ['BORROWER', 'PROPERTY', 'TITLE', 'INSURANCE', 'OTHER'];

// File icon based on extension
function getFileIcon(ext: string | null) {
  const extension = ext?.toLowerCase() || '';
  if (['pdf'].includes(extension)) {
    return <FileText className="h-4 w-4 text-red-500" />;
  }
  if (['xlsx', 'xls', 'csv'].includes(extension)) {
    return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  }
  if (['doc', 'docx'].includes(extension)) {
    return <FileText className="h-4 w-4 text-blue-600" />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
    return <File className="h-4 w-4 text-purple-500" />;
  }
  return <File className="h-4 w-4 text-gray-500" />;
}

// Format file size
function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LoanChecklist({ dealId, loanType }: LoanChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<string>('OTHER');
  const [newItemRequired, setNewItemRequired] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    loadChecklist();
  }, [dealId]);

  const loadChecklist = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/loan-documents?dealId=${dealId}`);
      const data = await res.json();

      if (data.checklistItems && data.checklistItems.length > 0) {
        setChecklist(data.checklistItems);
      } else {
        // Initialize default checklist
        const initRes = await fetch('/api/loan-documents/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId }),
        });
        const initData = await initRes.json();
        if (initData.checklistItems) {
          setChecklist(initData.checklistItems);
        }
      }
    } catch (error) {
      console.error('Error loading checklist:', error);
      toast.error('Failed to load checklist');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (itemId: string, completed: boolean) => {
    try {
      const res = await fetch(`/api/loan-documents/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });

      if (res.ok) {
        setChecklist(prev => prev.map(item =>
          item.id === itemId ? { ...item, completed } : item
        ));
      }
    } catch (error) {
      toast.error('Failed to update item');
    }
  };

  const handleFileUpload = async (itemId: string, files: FileList) => {
    setUploadingItemId(itemId);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('dealId', dealId);
        formData.append('checklistItemId', itemId);

        const res = await fetch('/api/loan-documents/upload', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          // Add new document to the checklist item
          setChecklist(prev => prev.map(item => {
            if (item.id === itemId) {
              return {
                ...item,
                completed: true,
                documents: [...item.documents, data.document],
              };
            }
            return item;
          }));
          toast.success(`Uploaded ${file.name}`);
        } else {
          throw new Error('Upload failed');
        }
      } catch (error) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    setUploadingItemId(null);
    // Expand the item to show uploaded documents
    setExpandedItems(prev => new Set(prev).add(itemId));
  };

  const handleDeleteDocument = async (docId: string, itemId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      const res = await fetch(`/api/loan-documents/document/${docId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setChecklist(prev => prev.map(item => {
          if (item.id === itemId) {
            const newDocs = item.documents.filter(d => d.id !== docId);
            return {
              ...item,
              documents: newDocs,
              completed: newDocs.length > 0,
            };
          }
          return item;
        }));
        toast.success('Document deleted');
      }
    } catch (error) {
      toast.error('Failed to delete document');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this checklist item and all its documents?')) return;

    try {
      const res = await fetch(`/api/loan-documents/${itemId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setChecklist(prev => prev.filter(item => item.id !== itemId));
        toast.success('Item deleted');
      }
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const handleAddItem = async () => {
    if (!newItemLabel.trim()) {
      toast.error('Please enter an item label');
      return;
    }

    setAddingItem(true);
    try {
      const res = await fetch('/api/loan-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId,
          label: newItemLabel,
          category: newItemCategory,
          required: newItemRequired,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setChecklist(prev => [...prev, data.checklistItem]);
        setAddDialogOpen(false);
        setNewItemLabel('');
        setNewItemCategory('OTHER');
        setNewItemRequired(false);
        toast.success('Item added');
      }
    } catch (error) {
      toast.error('Failed to add item');
    } finally {
      setAddingItem(false);
    }
  };

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const generateChecklist = async () => {
    toast.info('AI checklist generation coming soon');
  };

  const completedCount = checklist.filter(item => item.completed).length;
  const requiredCount = checklist.filter(item => item.required).length;
  const completedRequiredCount = checklist.filter(item => item.required && item.completed).length;
  const progress = checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0;

  // Group by category in specified order
  const groupedChecklist = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: checklist.filter(item => item.category === cat),
  })).filter(group => group.items.length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Loan Checklist</h2>
          <p className="text-sm text-muted-foreground">
            Track required documents and milestones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={generateChecklist}>
            <Wand2 className="h-4 w-4" />
            Generate with AI
          </Button>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <Button className="gap-2" onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Checklist Item</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Item Name</Label>
                  <Input
                    value={newItemLabel}
                    onChange={(e) => setNewItemLabel(e.target.value)}
                    placeholder="e.g., Bank Statements"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_ORDER.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={newItemRequired}
                    onCheckedChange={(checked) => setNewItemRequired(!!checked)}
                  />
                  <Label>Required document</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddItem} disabled={addingItem}>
                  {addingItem && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Item
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-muted-foreground">
              {completedCount} of {checklist.length} items ({Math.round(progress)}%)
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              {completedRequiredCount}/{requiredCount} required items
            </span>
            {completedRequiredCount < requiredCount && (
              <span className="flex items-center gap-1 text-orange-500">
                <AlertCircle className="h-3 w-3" />
                {requiredCount - completedRequiredCount} required items pending
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Checklist by Category */}
      <div className="space-y-4">
        {groupedChecklist.map(({ category, label, items }) => {
          const categoryCompleted = items.filter(item => item.completed).length;

          return (
            <Card key={category}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{label}</CardTitle>
                  <Badge variant="outline">
                    {categoryCompleted}/{items.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {items.map((item) => {
                    const isExpanded = expandedItems.has(item.id);
                    const hasDocuments = item.documents.length > 0;

                    return (
                      <div key={item.id} className="border rounded-lg">
                        {/* Item header */}
                        <div className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <button
                            onClick={() => hasDocuments && toggleExpand(item.id)}
                            className="p-0.5"
                            disabled={!hasDocuments}
                          >
                            {hasDocuments ? (
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )
                            ) : (
                              <div className="w-4" />
                            )}
                          </button>
                          <Checkbox
                            checked={item.completed}
                            onCheckedChange={(checked) => handleToggle(item.id, !!checked)}
                          />
                          <span className={`flex-1 text-sm ${item.completed ? 'line-through text-muted-foreground' : ''}`}>
                            {item.label}
                          </span>
                          {hasDocuments && (
                            <Badge variant="secondary" className="text-xs">
                              {item.documents.length} file{item.documents.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          {item.required && (
                            <Badge variant="destructive" className="text-xs">Required</Badge>
                          )}
                          {/* Upload button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 relative overflow-hidden"
                            disabled={uploadingItemId === item.id}
                          >
                            {uploadingItemId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            <input
                              ref={(el) => { fileInputRefs.current[item.id] = el; }}
                              type="file"
                              multiple
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.webp,.txt"
                              onChange={(e) => {
                                if (e.target.files?.length) {
                                  handleFileUpload(item.id, e.target.files);
                                  e.target.value = '';
                                }
                              }}
                            />
                          </Button>
                          {/* Delete item button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Expanded documents list */}
                        {isExpanded && hasDocuments && (
                          <div className="border-t bg-gray-50 dark:bg-gray-900 p-3 space-y-2">
                            {item.documents.map((doc) => (
                              <div
                                key={doc.id}
                                className="flex items-center gap-3 p-2 bg-white dark:bg-gray-800 rounded border"
                              >
                                {getFileIcon(doc.fileExtension)}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{doc.originalName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatFileSize(doc.fileSize)} • {new Date(doc.uploadedAt).toLocaleDateString()}
                                  </p>
                                </div>
                                {/* Preview button */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={() => window.open(doc.filePath, '_blank')}
                                  title="Preview"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {/* Download button */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = doc.filePath;
                                    a.download = doc.originalName;
                                    a.click();
                                  }}
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                {/* Delete document button */}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                                  onClick={() => handleDeleteDocument(doc.id, item.id)}
                                  title="Delete"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
