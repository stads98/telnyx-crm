'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calculator, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface DSCRCalculatorProps {
  deal: any;
  onDealUpdated: () => void;
}

const LOAN_TERMS = [
  { value: '5/1 ARM', label: '5/1 ARM' },
  { value: '7/1 ARM', label: '7/1 ARM' },
  { value: '30yr Fixed', label: '30yr Fixed' },
];

const PREPAY_OPTIONS = [
  { value: '1yr@1%', label: '1yr @ 1%' },
  { value: '3-2-1', label: '3-2-1 (Standard)' },
  { value: '3-3-3', label: '3-3-3' },
  { value: '5-4-3-2-1', label: '5-4-3-2-1' },
  { value: '5-5-5-5-5', label: '5-5-5-5-5' },
];

export default function DSCRCalculator({ deal, onDealUpdated }: DSCRCalculatorProps) {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    isOccupied: deal.isOccupied || false,
    marketRent: deal.marketRent || '',
    actualRent: deal.actualRent || '',
    annualInsurance: deal.annualInsurance || '',
    annualTaxes: deal.annualTaxes || '',
    loanNumber: deal.loanNumber || '',
    loanTerm: deal.loanTerm || '30yr Fixed',
    isInterestOnly: deal.isInterestOnly || false,
    prepayPenalty: deal.prepayPenalty || '3-2-1',
    points: deal.points || (deal.loanType?.includes('Bridge') ? '3' : '2'),
    interestRate: deal.interestRate || '',
    loanAmount: deal.loanAmount || deal.value || '',
  });

  // Calculate DSCR
  const calculatedDSCR = useMemo(() => {
    const marketRent = parseFloat(formData.marketRent) || 0;
    const actualRent = parseFloat(formData.actualRent) || 0;

    // DSCR rent calculation logic:
    // - If OCCUPIED: use the LOWER of actual rent vs market rent
    // - If VACANT: use market rent only
    let monthlyRent = 0;
    if (formData.isOccupied) {
      // For occupied properties, use the lower of actual vs market rent
      if (actualRent > 0 && marketRent > 0) {
        monthlyRent = Math.min(actualRent, marketRent);
      } else if (actualRent > 0) {
        monthlyRent = actualRent;
      } else {
        monthlyRent = marketRent;
      }
    } else {
      // For vacant properties, use market rent
      monthlyRent = marketRent;
    }

    const monthlyInsurance = (parseFloat(formData.annualInsurance) || 0) / 12;
    const monthlyTaxes = (parseFloat(formData.annualTaxes) || 0) / 12;
    const loanAmount = parseFloat(formData.loanAmount) || 0;
    const interestRate = parseFloat(formData.interestRate) || 0;

    if (!monthlyRent || !loanAmount || !interestRate) return null;
    
    // Calculate monthly payment (P&I or Interest Only)
    let monthlyPayment = 0;
    if (formData.isInterestOnly) {
      monthlyPayment = (loanAmount * (interestRate / 100)) / 12;
    } else {
      // Standard amortization (30 years)
      const monthlyRate = (interestRate / 100) / 12;
      const numPayments = 360; // 30 years
      monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    }
    
    // DSCR = NOI / Debt Service
    // NOI = Rent - Insurance - Taxes (simplified)
    const noi = monthlyRent - monthlyInsurance - monthlyTaxes;
    const dscr = noi / monthlyPayment;
    
    return isNaN(dscr) || !isFinite(dscr) ? null : dscr;
  }, [formData]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOccupied: formData.isOccupied,
          marketRent: formData.marketRent || null,
          actualRent: formData.actualRent || null,
          annualInsurance: formData.annualInsurance || null,
          annualTaxes: formData.annualTaxes || null,
          loanNumber: formData.loanNumber || null,
          loanTerm: formData.loanTerm || null,
          isInterestOnly: formData.isInterestOnly,
          prepayPenalty: formData.prepayPenalty || null,
          points: formData.points || null,
          interestRate: formData.interestRate || null,
          dscr: calculatedDSCR || null,
        }),
      });
      
      if (res.ok) {
        toast.success('DSCR data saved');
        onDealUpdated();
      } else {
        toast.error('Failed to save');
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value: string) => {
    const num = value.replace(/[^0-9.]/g, '');
    if (!num) return '';
    return parseFloat(num).toLocaleString('en-US');
  };

  const getDSCRColor = (dscr: number) => {
    if (dscr >= 1.25) return 'bg-green-500';
    if (dscr >= 1.0) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            DSCR Calculator
          </CardTitle>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Calculated DSCR Display */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <div>
            <div className="text-sm text-muted-foreground">Calculated DSCR</div>
            <div className="text-3xl font-bold">
              {calculatedDSCR ? calculatedDSCR.toFixed(2) : '-'}
            </div>
          </div>
          {calculatedDSCR && (
            <Badge className={getDSCRColor(calculatedDSCR)}>
              {calculatedDSCR >= 1.25 ? 'Strong' : calculatedDSCR >= 1.0 ? 'Acceptable' : 'Below Threshold'}
            </Badge>
          )}
        </div>

        {/* Loan Number */}
        <div className="space-y-2">
          <Label>Loan Number</Label>
          <Input
            value={formData.loanNumber}
            onChange={(e) => setFormData({ ...formData, loanNumber: e.target.value })}
            placeholder="Enter loan number"
          />
        </div>

        {/* Occupancy Toggle */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div>
            <Label>Property Occupancy</Label>
            <p className="text-sm text-muted-foreground">
              {formData.isOccupied
                ? 'Occupied - Using lower of actual vs market rent'
                : 'Vacant - Using market rent'}
            </p>
          </div>
          <Switch
            checked={formData.isOccupied}
            onCheckedChange={(checked) => setFormData({ ...formData, isOccupied: checked })}
          />
        </div>

        {/* Rental Income */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Market Rent (Monthly)
              {!formData.isOccupied && formData.marketRent && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Using</Badge>
              )}
              {formData.isOccupied && formData.marketRent && formData.actualRent &&
                parseFloat(formData.marketRent) <= parseFloat(formData.actualRent) && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Using (lower)</Badge>
              )}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input
                className="pl-7"
                value={formData.marketRent}
                onChange={(e) => setFormData({ ...formData, marketRent: e.target.value.replace(/[^0-9.]/g, '') })}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Actual Rent (Monthly)
              {formData.isOccupied && formData.actualRent && formData.marketRent &&
                parseFloat(formData.actualRent) < parseFloat(formData.marketRent) && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Using (lower)</Badge>
              )}
              {formData.isOccupied && formData.actualRent && !formData.marketRent && (
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">Using</Badge>
              )}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input
                className="pl-7"
                value={formData.actualRent}
                onChange={(e) => setFormData({ ...formData, actualRent: e.target.value.replace(/[^0-9.]/g, '') })}
                placeholder="0"
                disabled={!formData.isOccupied}
              />
            </div>
          </div>
        </div>

        {/* Rent calculation hint */}
        {formData.isOccupied && formData.marketRent && formData.actualRent && (
          <p className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-2 rounded">
            💡 For occupied properties, DSCR uses the lower rent: ${Math.min(parseFloat(formData.marketRent), parseFloat(formData.actualRent)).toLocaleString()}/mo
          </p>
        )}

        {/* Insurance & Taxes */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Annual Insurance</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input
                className="pl-7"
                value={formData.annualInsurance}
                onChange={(e) => setFormData({ ...formData, annualInsurance: e.target.value.replace(/[^0-9.]/g, '') })}
                placeholder="0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Annual Taxes</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              <Input
                className="pl-7"
                value={formData.annualTaxes}
                onChange={(e) => setFormData({ ...formData, annualTaxes: e.target.value.replace(/[^0-9.]/g, '') })}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Loan Terms */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Loan Term</Label>
            <Select
              value={formData.loanTerm}
              onValueChange={(value) => setFormData({ ...formData, loanTerm: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOAN_TERMS.map((term) => (
                  <SelectItem key={term.value} value={term.value}>
                    {term.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Interest Rate (%)</Label>
            <Input
              value={formData.interestRate}
              onChange={(e) => setFormData({ ...formData, interestRate: e.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="7.5"
            />
          </div>
        </div>

        {/* Interest Only Toggle */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div>
            <Label>Interest Only</Label>
            <p className="text-sm text-muted-foreground">
              {formData.isInterestOnly ? 'Interest only payments' : 'Principal & Interest payments'}
            </p>
          </div>
          <Switch
            checked={formData.isInterestOnly}
            onCheckedChange={(checked) => setFormData({ ...formData, isInterestOnly: checked })}
          />
        </div>

        {/* Prepay & Points */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Prepay Penalty</Label>
            <Select
              value={formData.prepayPenalty}
              onValueChange={(value) => setFormData({ ...formData, prepayPenalty: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREPAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Points</Label>
            <Input
              value={formData.points}
              onChange={(e) => setFormData({ ...formData, points: e.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="2"
            />
            <p className="text-xs text-muted-foreground">
              Standard: 2 for DSCR, 3 for Bridge (1 to house)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

