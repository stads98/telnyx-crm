'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import Footer from '@/components/footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Loader2, Search, FileText, DollarSign, Settings } from 'lucide-react';
import { toast } from 'sonner';
import FunderManagementDialog from '@/components/loan-copilot/funder-management-dialog';
import { Pipeline, Lender } from '@/types/deals';

interface Deal {
  id: string;
  title: string;
  value: number;
  contactId: string;
  contactName?: string;
  stage: string;
  stageId?: string;
  stageLabel?: string;
  stageColor?: string;
  propertyAddress?: string;
  loanAmount?: number;
  loanType?: string;
  lenderName?: string;
  createdAt?: string;
}

export default function LoanCoPilotPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFunderManagement, setShowFunderManagement] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [lenders, setLenders] = useState<Lender[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load loan pipeline (the default one)
      const pipelineRes = await fetch('/api/pipelines');
      if (pipelineRes.ok) {
        const pipelineData = await pipelineRes.json();
        const loanPipeline = pipelineData.pipelines?.find((p: Pipeline) => p.isLoanPipeline && p.isDefault) 
          || pipelineData.pipelines?.find((p: Pipeline) => p.isLoanPipeline);
        if (loanPipeline) {
          setPipeline(loanPipeline);
          // Load deals for this pipeline
          const dealsRes = await fetch(`/api/deals?pipelineId=${loanPipeline.id}`);
          if (dealsRes.ok) {
            const dealsData = await dealsRes.json();
            setDeals(dealsData.deals || []);
          }
        }
      }

      // Load lenders
      const lendersRes = await fetch('/api/lenders');
      if (lendersRes.ok) {
        const lendersData = await lendersRes.json();
        setLenders(lendersData.lenders || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const filteredDeals = useMemo(() => {
    if (!searchQuery) return deals;
    const search = searchQuery.toLowerCase();
    return deals.filter(deal =>
      deal.title?.toLowerCase().includes(search) ||
      deal.contactName?.toLowerCase().includes(search) ||
      deal.propertyAddress?.toLowerCase().includes(search)
    );
  }, [deals, searchQuery]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab="loan-copilot"
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden bg-background">
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="border-b bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight">Loan Co-Pilot</h1>
                    <p className="text-muted-foreground">Process DSCR loans and manage documents</p>
                  </div>
                  <Button className="bg-primary hover:bg-primary/90">
                    <Send className="mr-2 h-4 w-4" /> Send to Analyst
                  </Button>
                </div>
              </div>

              {/* Main Content - 2 Column Layout */}
              <div className="flex-1 overflow-hidden flex">
                {/* Left Sidebar - Loan List */}
                <div className="w-80 border-r bg-slate-50 flex flex-col">
                  <div className="p-4 border-b space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">Loans</h3>
                      <Badge variant="outline">{filteredDeals.length}</Badge>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search loans..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 text-xs pl-8"
                      />
                    </div>
                    <Button size="sm" className="w-full" variant="outline" onClick={() => setShowFunderManagement(true)}>
                      <Settings className="mr-2 h-4 w-4" /> Manage Funders
                    </Button>
                  </div>

                  <ScrollArea className="flex-1">
                    <div className="p-4 space-y-2">
                      {loading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredDeals.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          <p>No loans found.</p>
                          <p className="mt-2">Create loans in the <strong>Deals</strong> section with the "Loan Processing" pipeline.</p>
                        </div>
                      ) : (
                        filteredDeals.map(deal => (
                          <Card
                            key={deal.id}
                            className="p-3 cursor-pointer hover:bg-accent transition-colors"
                            onClick={() => router.push(`/loan-copilot/${deal.id}`)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{deal.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {deal.contactName}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {deal.propertyAddress}
                                </div>
                              </div>
                              <div className="text-right ml-2">
                                <div className="text-sm font-semibold text-green-600">
                                  {formatCurrency(deal.loanAmount || deal.value)}
                                </div>
                                <Badge
                                  variant="outline"
                                  className="text-xs mt-1"
                                  style={{ borderColor: deal.stageColor || '#e5e7eb' }}
                                >
                                  {deal.stageLabel || deal.stage}
                                </Badge>
                              </div>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Main Content Area - Placeholder */}
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Select a loan from the list to view details</p>
                    <p className="text-sm mt-2">Loans are created in the Deals section with "Loan Processing" pipeline</p>
                  </div>
                </div>
              </div>
            </div>
          </main>
          <Footer />
        </div>
      </div>

      {/* Funder Management Dialog */}
      <FunderManagementDialog
        open={showFunderManagement}
        onOpenChange={setShowFunderManagement}
      />
    </div>
  );
}

