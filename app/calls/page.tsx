"use client"

import { useState } from "react"
import Header from "@/components/header"
import Sidebar from "@/components/sidebar"
import Footer from "@/components/footer"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Phone, ListOrdered } from "lucide-react"
import CallsCenterModern from "@/components/calls/calls-center-modern"
import PowerDialerListsManager from "@/components/calls/power-dialer-lists-manager"
import { DialerErrorBoundary } from "@/components/calls/dialer-error-boundary"

export default function CallsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <Header />

      {/* Body: Sidebar + Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab="calls"
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-auto bg-background">
            <div className="h-full p-6">
              <Tabs defaultValue="manual" className="h-full flex flex-col">
                <TabsList className="mb-4 w-full justify-start">
                  <TabsTrigger value="manual" className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Manual Dialer
                  </TabsTrigger>
                  <TabsTrigger value="power-dialer" className="flex items-center gap-2">
                    <ListOrdered className="h-4 w-4" />
                    Power Dialer
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="flex-1 overflow-auto mt-0">
                  <DialerErrorBoundary>
                    <CallsCenterModern />
                  </DialerErrorBoundary>
                </TabsContent>

                <TabsContent value="power-dialer" className="flex-1 overflow-auto mt-0">
                  <DialerErrorBoundary>
                    <PowerDialerListsManager />
                  </DialerErrorBoundary>
                </TabsContent>
              </Tabs>
            </div>
          </main>

          {/* Footer */}
          <Footer />
        </div>
      </div>
    </div>
  );
}

