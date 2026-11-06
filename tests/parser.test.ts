import { describe, expect, it } from 'vitest';
import { InvoiceParseError, parseInvoiceText } from '../src/server/agent/parser.js';

describe('parseInvoiceText — natural-language invoice composer', () => {
  it('parses the canonical example: name, amount, memo, due days', () => {
    const d = parseInvoiceText('Invoice Jane Doe $280 for design retainer, due in 14 days');
    expect(d.recipientName).toBe('Jane Doe');
    expect(d.amount).toBe(280);
    expect(d.itemName.toLowerCase()).toContain('design retainer');
    expect(d.dueDays).toBe(14);
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('parses the demo prompt used in the video: Acme $420 consulting', () => {
    const d = parseInvoiceText('Invoice Acme $420 for consulting, due in 14 days');
    expect(d.recipientName).toBe('Acme');
    expect(d.amount).toBe(420);
    expect(d.dueDays).toBe(14);
    expect(d.memo).toBe('consulting');
  });

  it('handles comma thousands and decimals: $1,200.50', () => {
    const d = parseInvoiceText('Send an invoice to Marcus Chen for $1,200.50, due next week');
    expect(d.amount).toBe(1200.5);
    expect(d.recipientName).toBe('Marcus Chen');
    expect(d.dueDays).toBe(7);
  });

  it('extracts email recipients and derives a name', () => {
    const d = parseInvoiceText('Invoice maria.lopez@acme.test $95 for logo refresh, due in 10 days');
    expect(d.recipientEmail).toBe('maria.lopez@acme.test');
    expect(d.recipientName).toBeTruthy();
    expect(d.amount).toBe(95);
  });

  it('understands "bill NAME $X" and bare "for" amounts', () => {
    const d = parseInvoiceText('Bill Tom $500 due tomorrow');
    expect(d.recipientName).toBe('Tom');
    expect(d.amount).toBe(500);
    expect(d.dueDays).toBe(1);
  });

  it('understands worded due dates and net-30 terms', () => {
    expect(parseInvoiceText('Invoice Sam $250 for workshop, due in two weeks').dueDays).toBe(14);
    expect(parseInvoiceText('Invoice Sam $250 for workshop, net-30').dueDays).toBe(30);
    expect(parseInvoiceText('Invoice Sam $250 for workshop, due a month from now').dueDays).toBe(30);
  });

  it('defaults to Net 30 and notes it when no due date is present', () => {
    const d = parseInvoiceText('Invoice Dana $150 for photos');
    expect(d.dueDays).toBe(30);
    expect(d.notes.some((n) => n.includes('Net 30'))).toBe(true);
  });

  it('throws helpful errors for missing/absurd amounts', () => {
    expect(() => parseInvoiceText('Invoice Jane for design work')).toThrow(InvoiceParseError);
    expect(() => parseInvoiceText('Invoice Jane $0 for design')).toThrow(/positive/i);
    expect(() => parseInvoiceText('Invoice Jane $2000000 for yachts')).toThrow(/safety limit/i);
    expect(() => parseInvoiceText('')).toThrow(InvoiceParseError);
  });

  it('supports quantities ("2 hours")', () => {
    const d = parseInvoiceText('Invoice Nova Labs $150 per hour for consulting, 3 hours, due in 7 days');
    expect(d.amount).toBe(150);
    expect(d.quantity).toBe(3);
  });
});
