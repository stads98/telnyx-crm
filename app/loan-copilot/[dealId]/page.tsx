'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import Header from '@/components/header';
import Footer from '@/components/footer';
import LoanCopilotDashboard from '@/components/loan-copilot/loan-copilot-dashboard';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function LoanCopilotPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.dealId as string;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deal, setDeal] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (dealId) {
      loadDeal();
    }
  }, [dealId]);

  const loadDeal = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}`);
      if (res.ok) {
        const data = await res.json();
        setDeal(data.deal);
      } else {
        toast.error('Deal not found');
        router.push('/deals');
      }
    } catch (error) {
      console.error('Error loading deal:', error);
      toast.error('Failed to load deal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <Header />

      {/* Body: Sidebar + Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab="deals"
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden bg-background">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : deal ? (
              <LoanCopilotDashboard deal={deal} onDealUpdated={loadDeal} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Deal not found
              </div>
            )}
          </main>

          {/* Footer */}
          <Footer />
        </div>
      </div>
    </div>
  );
}

