'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload, FolderOpen, File, FileText, Image, Download,
  Trash2, Eye, Search, Plus, ExternalLink, RefreshCw, Loader2, CheckCircle2, XCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface LoanDocumentManagerProps {
  dealId: string;
}

interface Document {
  id: string;
  name: string;
  type: string;
  category: string;
  size: number;
  uploadedAt: string;
  url?: string;
}

interface UploadingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

const DOCUMENT_CATEGORIES = [
  { key: 'borrower', label: 'Borrower Documents', icon: FileText },
  { key: 'property', label: 'Property Documents', icon: File },
  { key: 'financial', label: 'Financial Documents', icon: FileText },
  { key: 'legal', label: 'Legal Documents', icon: FileText },
  { key: 'lender', label: 'Lender Documents', icon: File },
  { key: 'other', label: 'Other', icon: File },
];

export default function LoanDocumentManager({ dealId }: LoanDocumentManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDocuments();
  }, [dealId]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/loan-documents?dealId=${dealId}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Add files to uploading state
    const newUploadingFiles: UploadingFile[] = fileArray.map((file, idx) => ({
      id: `upload-${Date.now()}-${idx}`,
      name: file.name,
      size: file.size,
      progress: 0,
      status: 'uploading' as const,
    }));

    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

    // Upload each file
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const uploadId = newUploadingFiles[i].id;

      try {
        // Simulate progress updates
        const progressInterval = setInterval(() => {
          setUploadingFiles(prev => prev.map(f =>
            f.id === uploadId && f.progress < 90
              ? { ...f, progress: f.progress + 10 }
              : f
          ));
        }, 200);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('dealId', dealId);
        formData.append('category', 'other');

        const res = await fetch('/api/loan-documents/upload', {
          method: 'POST',
          body: formData,
        });

        clearInterval(progressInterval);

        if (res.ok) {
          setUploadingFiles(prev => prev.map(f =>
            f.id === uploadId ? { ...f, progress: 100, status: 'success' } : f
          ));
          toast.success(`${file.name} uploaded successfully`);
        } else {
          const error = await res.json();
          setUploadingFiles(prev => prev.map(f =>
            f.id === uploadId ? { ...f, status: 'error', error: error.message || 'Upload failed' } : f
          ));
          toast.error(`Failed to upload ${file.name}`);
        }
      } catch (error) {
        setUploadingFiles(prev => prev.map(f =>
          f.id === uploadId ? { ...f, status: 'error', error: 'Network error' } : f
        ));
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    // Refresh documents list after uploads
    await loadDocuments();

    // Clear completed uploads after 3 seconds
    setTimeout(() => {
      setUploadingFiles(prev => prev.filter(f => f.status === 'uploading'));
    }, 3000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.includes('image')) return Image;
    if (type.includes('pdf')) return FileText;
    return File;
  };

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || doc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const isUploading = uploadingFiles.some(f => f.status === 'uploading');

  return (
    <div
      className="space-y-6"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-primary/10 border-2 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-background rounded-lg p-8 shadow-lg text-center">
            <Upload className="h-12 w-12 mx-auto text-primary mb-4" />
            <h3 className="text-lg font-semibold">Drop files to upload</h3>
            <p className="text-sm text-muted-foreground">Release to start uploading</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Document Manager</h2>
          <p className="text-sm text-muted-foreground">
            Manage all loan-related documents in one place
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={loadDocuments} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
          <Button variant="outline" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Open in Drive
          </Button>
          <Button className="gap-2 relative overflow-hidden" disabled={isUploading}>
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isUploading ? 'Uploading...' : 'Upload Documents'}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => handleUpload(e.target.files)}
              disabled={isUploading}
            />
          </Button>
        </div>
      </div>

      {/* Upload Progress Section */}
      {uploadingFiles.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">
                Uploading {uploadingFiles.filter(f => f.status === 'uploading').length} file(s)...
              </span>
            </div>
            <div className="space-y-3">
              {uploadingFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                        {file.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        {file.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                        {file.status === 'uploading' && <span className="text-xs text-primary">{file.progress}%</span>}
                      </div>
                    </div>
                    <Progress
                      value={file.progress}
                      className={`h-1.5 ${file.status === 'success' ? 'bg-green-100' : file.status === 'error' ? 'bg-red-100' : ''}`}
                    />
                    {file.error && <p className="text-xs text-red-500 mt-1">{file.error}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={selectedCategory === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategory(null)}
          >
            All
          </Button>
          {DOCUMENT_CATEGORIES.map((cat) => (
            <Button
              key={cat.key}
              variant={selectedCategory === cat.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(cat.key)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Document Grid */}
      {!loading && filteredDocuments.length === 0 ? (
        <Card
          className={`p-12 border-2 border-dashed transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-muted'}`}
        >
          <div className="text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No documents yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Drag & drop files here or click the button below to upload
            </p>
            <Button className="gap-2 relative overflow-hidden">
              <Upload className="h-4 w-4" />
              Upload First Document
              <input
                type="file"
                multiple
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpload(e.target.files)}
              />
            </Button>
          </div>
        </Card>
      ) : !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredDocuments.map((doc) => {
            const FileIcon = getFileIcon(doc.type);
            return (
              <Card key={doc.id} className="hover:shadow-md transition-shadow cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded">
                      <FileIcon className="h-6 w-6 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm truncate">{doc.name}</h4>
                      <p className="text-xs text-muted-foreground">{formatFileSize(doc.size)}</p>
                      <Badge variant="outline" className="mt-1 text-xs">{doc.category}</Badge>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

