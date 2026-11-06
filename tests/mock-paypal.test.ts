import { describe, expect, it } from 'vitest';
import { generateSeed, mulberry32 } from '../src/server/paypal/seed.js';
import { MockPayPalProvider } from '../src/server/paypal/mock/ledger.js';
import { ProviderError } from '../src/server/paypal/provider.js';
import { Store } from '../src/server/store/store.js';

function seededStore(): Store {
  const store = new Store(null);
  store.reset(generateSeed({ now: new Date('2026-06-15T12:00:00Z') }));
  return store;
}

describe('mock PayPal provider — invoice lifecycle', () => {
  it('createInvoice → DRAFT; sendInvoice → SENT; markInvoicePaid → PAID (ledger updated)', async () => {
    const store = seededStore();
    const provider = new MockPayPalProvider(store);

    const invoice = await provider.createInvoice({
      recipientName: 'Acme Corp',
      item: 'Consulting',
      amount: 420,
      dueDays: 14,
      createdBy: 'agent',
    });
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.total).toBe(420);
    expect(invoice.createdBy).toBe('agent');
    expect(new Date(`${invoice.dueDate}T00:00:00Z`).getTime()).toBeGreaterThan(Date.now());

    const sent = await provider.sendInvoice(invoice.id);
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toBeTruthy();

    const txCountBefore = store.snapshot.transactions.length;
    const paid = await provider.markInvoicePaid(invoice.id);
    expect(paid.status).toBe('PAID');
    // Settlement lands in the ledger like a real PayPal invoice payment
    expect(store.snapshot.transactions.length).toBe(txCountBefore + 1);
    const settled = store.snapshot.transactions[0];
    expect(settled.type).toBe('PAYMENT');
    expect(settled.amount).toBe(420);
    expect(settled.invoiceId).toBe(invoice.id);
  });

  it('rejects invalid state transitions with clear errors', async () => {
    const store = seededStore();
    const provider = new MockPayPalProvider(store);

    await expect(provider.sendInvoice('INV-MISSING')).rejects.toThrow(ProviderError);

    const invoice = await provider.createInvoice({ recipientName: 'Beta LLC', item: 'Audit', amount: 100 });
    // cannot mark a DRAFT paid before sending
    await expect(provider.markInvoicePaid(invoice.id)).rejects.toThrow(/draft/i);

    const sent = await provider.sendInvoice(invoice.id);
    await expect(provider.sendInvoice(sent.id)).rejects.toThrow(/already sent/i);
    const paid = await provider.markInvoicePaid(sent.id);
    await expect(provider.sendInvoice(paid.id)).rejects.toThrow(/already paid/i);
  });

  it('orders: create → buyer approve → capture, mirroring Orders API v2', async () => {
    const store = seededStore();
    const provider = new MockPayPalProvider(store);

    const order = await provider.createOrder({ item: 'Demo mug', amount: 19.99 });
    expect(order.status).toBe('CREATED');

    // capture before buyer approval must fail
    await expect(provider.captureOrder(order.id)).rejects.toThrow(/approve/i);

    const approved = provider.approveOrder(order.id);
    expect(approved.status).toBe('APPROVED');

    const captured = await provider.captureOrder(order.id);
    expect(captured.status).toBe('COMPLETED');
    expect(captured.buyer).toBeTruthy();
    // captured payment lands in the ledger
    const tx = store.snapshot.transactions[0];
    expect(tx.type).toBe('PAYMENT');
    expect(tx.amount).toBe(19.99);
    expect(tx.description).toContain('Demo mug');

    await expect(provider.captureOrder(order.id)).rejects.toThrow(/already captured/i);
  });
});

describe('seed generator', () => {
  const NOW = new Date('2026-06-15T12:00:00Z');

  it('is deterministic for a fixed now + seed', () => {
    const a = generateSeed({ now: NOW, seed: 42 });
    const b = generateSeed({ now: NOW, seed: 42 });
    expect(a).toEqual(b);
    const c = generateSeed({ now: NOW, seed: 43 });
    expect(JSON.stringify(a) !== JSON.stringify(c)).toBe(true);
  });

  it('produces a rich, story-driven ledger', () => {
    const state = generateSeed({ now: NOW });
    expect(state.transactions.length).toBeGreaterThan(2500);
    expect(state.transactions.length).toBeLessThan(6000);

    // card-testing burst: ~40 micro auths, mostly VOIDED
    const auths = state.transactions.filter((t) => t.type === 'AUTHORIZATION' && t.amount <= 10);
    expect(auths.length).toBeGreaterThanOrEqual(40);
    expect(auths.every((t) => t.method === 'card')).toBe(true);
    expect(auths.some((t) => t.status === 'VOIDED')).toBe(true);

    // disputes with future deadlines
    const open = state.disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW');
    expect(open.length).toBe(3);
    for (const d of open) {
      expect(new Date(d.respondBy).getTime()).toBeGreaterThan(NOW.getTime());
      expect(d.evidence.length).toBeGreaterThan(2);
      // dispute links to a real ledger transaction
      expect(state.transactions.some((t) => t.id === d.transactionId)).toBe(true);
    }

    // whales exist and matter
    const northwind = state.transactions.filter((t) => t.counterparty.name === 'Northwind Labs');
    expect(northwind.length).toBeGreaterThan(40);
    const cascade = state.transactions.filter((t) => t.counterparty.name === 'Cascade Media Group');
    expect(cascade.every((t) => t.amount === cascade[0].amount)).toBe(true);

    // every transaction is categorized and risk-scored
    expect(state.transactions.every((t) => t.category.length > 0)).toBe(true);
    expect(state.transactions.every((t) => t.risk.score >= 0 && t.risk.score <= 100)).toBe(true);

    // invoices across the status spectrum
    const statuses = new Set(state.invoices.map((i) => i.status));
    expect(statuses.has('DRAFT')).toBe(true);
    expect(statuses.has('SENT')).toBe(true);
    expect(statuses.has('PAID')).toBe(true);
  });

  it('mulberry32 PRNG is reproducible and in-range', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
