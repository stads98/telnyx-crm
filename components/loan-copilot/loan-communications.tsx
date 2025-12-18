'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Phone, MessageSquare, Mail, ExternalLink, RefreshCw, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useMakeCall } from '@/hooks/use-make-call';
import { useSmsUI } from '@/lib/context/sms-ui-context';
import { useEmailUI } from '@/lib/context/email-ui-context';
import { CallButtonWithCellHover } from '@/components/ui/call-button-with-cell-hover';

interface LoanCommunicationsProps {
  dealId: string;
  contactId: string;
}

interface Communication {
  id: string;
  type: 'call' | 'sms' | 'email';
  direction: 'inbound' | 'outbound';
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  timestamp: string;
  duration?: number;
}

interface ContactInfo {
  id: string;
  firstName?: string;
  lastName?: string;
  phone1?: string;
  email1?: string;
}

export default function LoanCommunications({ dealId, contactId }: LoanCommunicationsProps) {
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const { makeCall } = useMakeCall();
  const { openSms } = useSmsUI();
  const { openEmail } = useEmailUI();

  useEffect(() => {
    if (contactId) {
      loadCommunications();
      loadContact();
    }
  }, [contactId]);

  const loadContact = async () => {
    if (!contactId) return;
    try {
      const res = await fetch(`/api/contacts/${contactId}`);
      if (res.ok) {
        const data = await res.json();
        setContact({
          id: data.id,
          firstName: data.firstName,
          lastName: data.lastName,
          phone1: data.phone1,
          email1: data.email1,
        });
      }
    } catch (error) {
      console.error('Error loading contact:', error);
    }
  };

  const loadCommunications = async () => {
    if (!contactId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/activities?contactId=${contactId}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setCommunications(data.activities?.map((a: any) => ({
          id: a.id,
          type: a.type === 'call' ? 'call' : a.type === 'sms' ? 'sms' : 'email',
          direction: a.direction || 'outbound',
          subject: a.subject,
          body: a.body || a.description,
          from: a.from,
          to: a.to,
          timestamp: a.createdAt || a.timestamp,
          duration: a.duration,
        })) || []);
      }
    } catch (error) {
      console.error('Error loading communications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCall = async () => {
    if (!contact?.phone1) {
      toast.error('No phone number available for this contact');
      return;
    }
    const contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    await makeCall({
      phoneNumber: contact.phone1,
      contactId: contact.id,
      contactName,
    });
  };

  const handleSms = () => {
    if (!contact?.phone1) {
      toast.error('No phone number available for this contact');
      return;
    }
    openSms({
      phoneNumber: contact.phone1,
      contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName },
    });
  };

  const handleEmail = () => {
    if (!contact?.email1) {
      toast.error('No email address available for this contact');
      return;
    }
    openEmail({
      email: contact.email1,
      contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName },
    });
  };

  const filteredCommunications = communications.filter(c => {
    if (activeTab === 'all') return true;
    return c.type === activeTab;
  });

  const getIcon = (type: string) => {
    switch (type) {
      case 'call': return Phone;
      case 'sms': return MessageSquare;
      case 'email': return Mail;
      default: return MessageSquare;
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Communications</h2>
          <p className="text-sm text-muted-foreground">
            View all calls, texts, and emails for this loan
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadCommunications} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Open Gmail
          </Button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-2">
        {contact?.phone1 ? (
          <CallButtonWithCellHover
            phoneNumber={contact.phone1}
            contactId={contact.id}
            contactName={`${contact.firstName || ''} ${contact.lastName || ''}`.trim()}
            onWebRTCCall={handleCall}
            variant="outline"
            size="default"
            className="gap-2 h-9 px-3"
            iconClassName="h-4 w-4"
          />
        ) : (
          <Button variant="outline" className="gap-2" disabled>
            <Phone className="h-4 w-4" />
            Call
          </Button>
        )}
        <Button variant="outline" className="gap-2" onClick={handleSms} disabled={!contact?.phone1}>
          <MessageSquare className="h-4 w-4" />
          Text
        </Button>
        <Button variant="outline" className="gap-2" onClick={handleEmail} disabled={!contact?.email1}>
          <Mail className="h-4 w-4" />
          Email
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({communications.length})</TabsTrigger>
          <TabsTrigger value="call">Calls ({communications.filter(c => c.type === 'call').length})</TabsTrigger>
          <TabsTrigger value="sms">Texts ({communications.filter(c => c.type === 'sms').length})</TabsTrigger>
          <TabsTrigger value="email">Emails ({communications.filter(c => c.type === 'email').length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Communications List */}
      {filteredCommunications.length === 0 ? (
        <Card className="p-12">
          <div className="text-center">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">No communications yet</h3>
            <p className="text-sm text-muted-foreground">
              Start a conversation with the borrower
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredCommunications.map((comm) => {
            const Icon = getIcon(comm.type);
            return (
              <Card key={comm.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded ${comm.type === 'call' ? 'bg-blue-100' : comm.type === 'sms' ? 'bg-green-100' : 'bg-purple-100'}`}>
                      <Icon className={`h-4 w-4 ${comm.type === 'call' ? 'text-blue-600' : comm.type === 'sms' ? 'text-green-600' : 'text-purple-600'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {comm.direction === 'inbound' ? (
                          <ArrowDownLeft className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />
                        )}
                        <span className="font-medium text-sm capitalize">{comm.type}</span>
                        {comm.duration && <span className="text-xs text-muted-foreground">({formatDuration(comm.duration)})</span>}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(new Date(comm.timestamp), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      {comm.subject && <p className="text-sm font-medium mt-1">{comm.subject}</p>}
                      {comm.body && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{comm.body}</p>}
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

