'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft, FileText, FolderOpen, Mail, MessageSquare,
  CheckSquare, Users, Send, Bot, Building2, DollarSign,
  Percent, Calendar, User, MapPin, Phone, ExternalLink, Loader2
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import ContactName from '@/components/contacts/contact-name';
import LoanDocumentManager from './loan-document-manager';
import LoanChecklist from './loan-checklist';
import LoanContacts from './loan-contacts';
import LoanTasks from './loan-tasks';
import LoanAIAssistant from './loan-ai-assistant';
import LoanCommunications from './loan-communications';
import DSCRCalculator from './dscr-calculator';
import LoanFees from './loan-fees';

interface LoanCopilotDashboardProps {
  deal: any;
  onDealUpdated: () => void;
}

export default function LoanCopilotDashboard({ deal, onDealUpdated }: LoanCopilotDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [showSendToAnalyst, setShowSendToAnalyst] = useState(false);
  const [analystEmail, setAnalystEmail] = useState('');
  const [analystMessage, setAnalystMessage] = useState('');
  const [sendingToAnalyst, setSendingToAnalyst] = useState(false);

  const handleSendToAnalyst = async () => {
    if (!analystEmail.trim()) {
      toast.error('Please enter an analyst email');
      return;
    }

    setSendingToAnalyst(true);
    try {
      // Create a task for follow-up and send notification
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'TASK',
          title: `Follow up with analyst: ${analystEmail}`,
          description: `Loan package sent to analyst.\n\nLoan Details:\n- Property: ${deal.propertyAddress || 'N/A'}\n- Loan Amount: ${deal.loanAmount || deal.value || 'N/A'}\n- Borrower: ${deal.borrowerName || 'N/A'}\n\nMessage: ${analystMessage || 'No additional message'}`,
          contactId: deal.contactId,
          dealId: deal.id,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Due tomorrow
        }),
      });

      if (response.ok) {
        toast.success(`Loan package prepared for ${analystEmail}. Follow-up task created.`);
        setShowSendToAnalyst(false);
        setAnalystEmail('');
        setAnalystMessage('');
      } else {
        throw new Error('Failed to create follow-up task');
      }
    } catch (error) {
      console.error('Error sending to analyst:', error);
      toast.error('Failed to send to analyst');
    } finally {
      setSendingToAnalyst(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <Link href="/deals">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{deal.title}</h1>
                <Badge variant="outline" className="text-blue-600 border-blue-600">
                  Loan Copilot
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {deal.contactId ? (
                    <ContactName
                      contactId={deal.contactId}
                      contact={{ id: deal.contactId, fullName: deal.contactName } as any}
                      clickMode="popup"
                      className="text-sm"
                    />
                  ) : (
                    <span className="text-muted-foreground">{deal.contactName || 'No Contact'}</span>
                  )}
                </span>
                {deal.propertyAddress && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {deal.propertyAddress}
                  </span>
                )}
                {deal.llcName && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {deal.llcName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setShowSendToAnalyst(true)}>
              <Send className="h-4 w-4" />
              Send to Analyst
            </Button>
            <Link href="/deals">
              <Button variant="outline" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                View in Deals
              </Button>
            </Link>
          </div>
        </div>

        {/* Loan Summary Cards */}
        <div className="grid grid-cols-6 gap-4">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Loan Amount</div>
            <div className="text-lg font-bold text-green-600">
              {deal.loanAmount ? formatCurrency(deal.loanAmount) : formatCurrency(deal.value)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Property Value</div>
            <div className="text-lg font-bold">
              {deal.propertyValue ? formatCurrency(deal.propertyValue) : '-'}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">LTV</div>
            <div className="text-lg font-bold">{deal.ltv ? `${deal.ltv}%` : '-'}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Lender</div>
            <div className="text-lg font-bold truncate">{deal.lenderName || '-'}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Loan Type</div>
            <div className="text-lg font-bold">{deal.loanType || '-'}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Stage</div>
            <Badge 
              className="mt-1"
              style={{ backgroundColor: deal.stageColor || '#e5e7eb' }}
            >
              {deal.stageName || deal.stage}
            </Badge>
          </Card>
        </div>
      </div>

      {/* Tabs Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="border-b bg-white px-6">
            <TabsList className="h-12">
              <TabsTrigger value="overview" className="gap-2">
                <FileText className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-2">
                <FolderOpen className="h-4 w-4" />
                Documents
              </TabsTrigger>
              <TabsTrigger value="checklist" className="gap-2">
                <CheckSquare className="h-4 w-4" />
                Checklist
              </TabsTrigger>
              <TabsTrigger value="contacts" className="gap-2">
                <Users className="h-4 w-4" />
                Contacts
              </TabsTrigger>
              <TabsTrigger value="tasks" className="gap-2">
                <CheckSquare className="h-4 w-4" />
                Tasks
              </TabsTrigger>
              <TabsTrigger value="communications" className="gap-2">
                <Mail className="h-4 w-4" />
                Communications
              </TabsTrigger>
              <TabsTrigger value="dscr" className="gap-2">
                <DollarSign className="h-4 w-4" />
                DSCR
              </TabsTrigger>
              <TabsTrigger value="fees" className="gap-2">
                <DollarSign className="h-4 w-4" />
                Fees
              </TabsTrigger>
              <TabsTrigger value="ai-assistant" className="gap-2">
                <Bot className="h-4 w-4" />
                AI Assistant
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 overflow-auto p-6">
            <TabsContent value="overview" className="mt-0 h-full">
              <div className="grid grid-cols-3 gap-6">
                {/* Loan Details */}
                <Card className="col-span-2">
                  <CardHeader>
                    <CardTitle>Loan Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Borrower</div>
                        <div className="font-medium">{deal.contactName}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Property Address</div>
                        <div className="font-medium">{deal.propertyAddress || '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">LLC / Entity</div>
                        <div className="font-medium">{deal.llcName || '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Lender</div>
                        <div className="font-medium">{deal.lenderName || '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Loan Type</div>
                        <div className="font-medium">{deal.loanType || '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Interest Rate</div>
                        <div className="font-medium">{deal.interestRate ? `${deal.interestRate}%` : '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">DSCR</div>
                        <div className="font-medium">{deal.dscr ? deal.dscr.toFixed(2) : '-'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Expected Close</div>
                        <div className="font-medium">
                          {deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), 'MMM d, yyyy') : '-'}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card>
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <Phone className="h-4 w-4" />
                      Call Borrower
                    </Button>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Send Text
                    </Button>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <Mail className="h-4 w-4" />
                      Send Email
                    </Button>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <CheckSquare className="h-4 w-4" />
                      Create Task
                    </Button>
                    <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setShowSendToAnalyst(true)}>
                      <Send className="h-4 w-4" />
                      Send to Analyst
                    </Button>
                  </CardContent>
                </Card>

                {/* Notes */}
                <Card className="col-span-3">
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{deal.notes || 'No notes yet.'}</p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="documents" className="mt-0 h-full">
              <LoanDocumentManager dealId={deal.id} />
            </TabsContent>

            <TabsContent value="checklist" className="mt-0 h-full">
              <LoanChecklist dealId={deal.id} loanType={deal.loanType} />
            </TabsContent>

            <TabsContent value="contacts" className="mt-0 h-full">
              <LoanContacts dealId={deal.id} />
            </TabsContent>

            <TabsContent value="tasks" className="mt-0 h-full">
              {deal.contactId ? (
                <LoanTasks dealId={deal.id} contactId={deal.contactId} />
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  No contact associated with this loan. Please link a contact first.
                </div>
              )}
            </TabsContent>

            <TabsContent value="communications" className="mt-0 h-full">
              {deal.contactId ? (
                <LoanCommunications dealId={deal.id} contactId={deal.contactId} />
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  No contact associated with this loan. Please link a contact first.
                </div>
              )}
            </TabsContent>

            <TabsContent value="dscr" className="mt-0 h-full">
              <div className="max-w-2xl">
                <DSCRCalculator deal={deal} onDealUpdated={onDealUpdated} />
              </div>
            </TabsContent>

            <TabsContent value="fees" className="mt-0 h-full">
              <div className="max-w-2xl">
                <LoanFees deal={deal} onDealUpdated={onDealUpdated} />
              </div>
            </TabsContent>

            <TabsContent value="ai-assistant" className="mt-0 h-full">
              <LoanAIAssistant dealId={deal.id} deal={deal} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Send to Analyst Dialog */}
      <Dialog open={showSendToAnalyst} onOpenChange={setShowSendToAnalyst}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Send to Analyst
            </DialogTitle>
            <DialogDescription>
              Send this loan package to an analyst for review. A follow-up task will be created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="analyst-email">Analyst Email</Label>
              <Input
                id="analyst-email"
                type="email"
                placeholder="analyst@example.com"
                value={analystEmail}
                onChange={(e) => setAnalystEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analyst-message">Additional Message (Optional)</Label>
              <Textarea
                id="analyst-message"
                placeholder="Add any notes or special instructions for the analyst..."
                value={analystMessage}
                onChange={(e) => setAnalystMessage(e.target.value)}
                rows={4}
              />
            </div>
            <div className="bg-muted p-3 rounded-lg text-sm">
              <p className="font-medium mb-1">Loan Summary:</p>
              <ul className="text-muted-foreground space-y-1">
                <li>• Property: {deal.propertyAddress || 'N/A'}</li>
                <li>• Loan Amount: {deal.loanAmount || deal.value ? formatCurrency(deal.loanAmount || deal.value) : 'N/A'}</li>
                <li>• Borrower: {deal.borrowerName || 'N/A'}</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendToAnalyst(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendToAnalyst} disabled={sendingToAnalyst}>
              {sendingToAnalyst ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send to Analyst
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

