/**
 * Mock PayPal provider — in-memory/JSON-file adapter implementing the exact
 * same PayPalProvider interface as the sandbox adapter. Default mode
 * (PAYPAL_ENV=mock): the full product works with zero credentials.
 */
import type { DemoOrder, Dispute, Invoice, Transaction } from '../../../shared/types.js';
import { dateKey, round2, uid } from '../../../shared/util.js';
import { categorizeTransaction } from '../../insights/categorize.js';
import { scoreRisk } from '../../insights/risk.js';
import type { Store } from '../../store/store.js';
import type { InvoiceDraftInput, OrderInput, PayPalProvider } from '../provider.js';
import { ProviderError } from '../provider.js';

export class MockPayPalProvider implements PayPalProvider {
  readonly mode = 'mock' as const;
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async listTransactions(): Promise<Transaction[]> {
    return this.store.snapshot.transactions;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    return this.store.snapshot.transactions.find((t) => t.id === id) ?? null;
  }

  async createInvoice(input: InvoiceDraftInput): Promise<Invoice> {
    if (!input.recipientName?.trim()) throw new ProviderError('Invoice needs a recipient name');
    if (!(input.amount > 0)) throw new ProviderError('Invoice amount must be greater than zero');
    const quantity = input.quantity ?? 1;
    const total = round2(input.amount * quantity);
    let created!: Invoice;
    this.store.update((s) => {
      const seq = s.invoices.length + 1;
      const invoice: Invoice = {
        id: `INV-${new Date().getUTCFullYear()}${String(100 + seq)}`,
        number: `PP-${new Date().getUTCFullYear()}-${String(100 + seq).padStart(4, '0')}`,
        status: 'DRAFT',
        recipient: {
          name: input.recipientName.trim(),
          email: input.recipientEmail ?? `billing@${input.recipientName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'customer'}.example.com`,
        },
        items: [{ name: input.item || 'Professional services', quantity, unitAmount: input.amount }],
        total,
        currency: 'USD',
        dueDate: dateKey(new Date(Date.now() + (input.dueDays ?? 30) * 86_400_000)),
        memo: input.memo,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy ?? 'human',
      };
      s.invoices.unshift(invoice);
      created = invoice;
    });
    return created;
  }

  async listInvoices(): Promise<Invoice[]> {
    return this.store.snapshot.invoices;
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    return this.store.snapshot.invoices.find((i) => i.id === id || i.number === id) ?? null;
  }

  async sendInvoice(id: string): Promise<Invoice> {
    let sent!: Invoice;
    this.store.update((s) => {
      const idx = s.invoices.findIndex((i) => i.id === id || i.number === id);
      if (idx < 0) throw new ProviderError(`Invoice ${id} not found`);
      const invoice = s.invoices[idx];
      if (invoice.status === 'SENT') throw new ProviderError(`Invoice ${invoice.number} was already sent on ${invoice.sentAt?.slice(0, 10)}`);
      if (invoice.status === 'PAID' || invoice.status === 'MARKED_AS_PAID') throw new ProviderError(`Invoice ${invoice.number} is already paid`);
      if (invoice.status === 'CANCELLED') throw new ProviderError(`Invoice ${invoice.number} was cancelled and cannot be sent`);
      sent = { ...invoice, status: 'SENT', sentAt: new Date().toISOString() };
      s.invoices[idx] = sent;
    });
    return sent;
  }

  async markInvoicePaid(id: string): Promise<Invoice> {
    let paid!: Invoice;
    this.store.update((s) => {
      const idx = s.invoices.findIndex((i) => i.id === id || i.number === id);
      if (idx < 0) throw new ProviderError(`Invoice ${id} not found`);
      const invoice = s.invoices[idx];
      if (invoice.status === 'DRAFT') throw new ProviderError(`Invoice ${invoice.number} is still a draft — send it first`);
      if (invoice.status === 'PAID') throw new ProviderError(`Invoice ${invoice.number} is already paid`);
      paid = { ...invoice, status: 'PAID', paidAt: new Date().toISOString() };
      s.invoices[idx] = paid;
      // Settlement lands in the ledger, like a real PayPal invoice payment.
      const txBase = {
        id: uid('txn'),
        timestamp: new Date().toISOString(),
        type: 'PAYMENT' as const,
        status: 'COMPLETED' as const,
        amount: paid.total,
        direction: 'in' as const,
        currency: 'USD' as const,
        counterparty: paid.recipient,
        description: `Invoice ${paid.number} paid — ${paid.items[0]?.name ?? 'services'}`,
        method: 'paypal' as const,
        invoiceId: paid.id,
      };
      s.transactions.unshift({ ...txBase, category: categorizeTransaction(txBase), risk: scoreRisk(txBase) });
    });
    return paid;
  }

  async listDisputes(): Promise<Dispute[]> {
    return this.store.snapshot.disputes;
  }

  async getDispute(id: string): Promise<Dispute | null> {
    return this.store.snapshot.disputes.find((d) => d.id === id) ?? null;
  }

  async createOrder(input: OrderInput): Promise<DemoOrder> {
    if (!(input.amount > 0)) throw new ProviderError('Order amount must be greater than zero');
    let order!: DemoOrder;
    this.store.update((s) => {
      order = {
        id: `5O${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
        status: 'CREATED',
        amount: round2(input.amount),
        currency: 'USD',
        item: input.item,
        createdAt: new Date().toISOString(),
      };
      s.orders.unshift(order);
    });
    return order;
  }

  async captureOrder(id: string): Promise<DemoOrder> {
    let captured!: DemoOrder;
    this.store.update((s) => {
      const idx = s.orders.findIndex((o) => o.id === id);
      if (idx < 0) throw new ProviderError(`Order ${id} not found`);
      const order = s.orders[idx];
      if (order.status === 'COMPLETED') throw new ProviderError(`Order ${id} is already captured`);
      if (order.status !== 'APPROVED') throw new ProviderError(`Order ${id} is ${order.status} — the buyer must approve it before capture`);
      captured = { ...order, status: 'COMPLETED', buyer: 'Sandbox Buyer', capturedAt: new Date().toISOString() };
      s.orders[idx] = captured;
      const txBase = {
        id: uid('txn'),
        timestamp: new Date().toISOString(),
        type: 'PAYMENT' as const,
        status: 'COMPLETED' as const,
        amount: captured.amount,
        direction: 'in' as const,
        currency: 'USD' as const,
        counterparty: { name: 'Sandbox Buyer', email: 'buyer-sandbox@paypal-test.com' },
        description: `Demo checkout — ${captured.item}`,
        method: 'paypal' as const,
      };
      s.transactions.unshift({ ...txBase, category: categorizeTransaction(txBase), risk: scoreRisk(txBase) });
    });
    return captured;
  }

  /** Mock buyer approving the order in the PayPal approval flow. */
  approveOrder(id: string): DemoOrder {
    let approved!: DemoOrder;
    this.store.update((s) => {
      const idx = s.orders.findIndex((o) => o.id === id);
      if (idx < 0) throw new ProviderError(`Order ${id} not found`);
      if (s.orders[idx].status !== 'CREATED') throw new ProviderError(`Order ${id} is ${s.orders[idx].status}, expected CREATED`);
      approved = { ...s.orders[idx], status: 'APPROVED', buyer: 'Sandbox Buyer' };
      s.orders[idx] = approved;
    });
    return approved;
  }
}
