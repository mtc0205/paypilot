/**
 * Sandbox provider — the REAL PayPal integration. Implements the same
 * PayPalProvider interface as the mock adapter; selected via PAYPAL_ENV=sandbox.
 * Writes are mirrored into the local store so the audit log and UI stay coherent.
 */
import type { DemoOrder, Dispute, Invoice, Transaction } from '../../shared/types.js';
import { dateKey, round2, uid } from '../../shared/util.js';
import type { Store } from '../store/store.js';
import { PayPalClient } from './client.js';
import type { InvoiceDraftInput, OrderInput, PayPalProvider } from './provider.js';
import { ProviderError } from './provider.js';
import { listDisputesRemote } from './services/disputes.js';
import { createInvoiceRemote, fromPayPalInvoice, listInvoicesRemote, sendInvoiceRemote, toInvoicePayload } from './services/invoices.js';
import { captureOrderRemote, createOrderRemote } from './services/orders.js';
import { fetchLedger } from './services/transactions.js';

export interface SandboxProviderConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  merchantEmail: string;
}

export class SandboxProvider implements PayPalProvider {
  readonly mode = 'sandbox' as const;
  private readonly client: PayPalClient;
  private readonly config: SandboxProviderConfig;
  private readonly store: Store;
  private ledgerCache: { at: number; rows: Transaction[] } | null = null;

  constructor(config: SandboxProviderConfig, store: Store) {
    this.config = config;
    this.client = new PayPalClient({
      baseUrl: config.baseUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    this.store = store;
  }

  async listTransactions(): Promise<Transaction[]> {
    if (this.ledgerCache && Date.now() - this.ledgerCache.at < 60_000) return this.ledgerCache.rows;
    const rows = await fetchLedger(this.client, 120);
    this.ledgerCache = { at: Date.now(), rows };
    return rows;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    const rows = await this.listTransactions();
    return rows.find((t) => t.id === id) ?? null;
  }

  async createInvoice(input: InvoiceDraftInput): Promise<Invoice> {
    const payload = toInvoicePayload(input, this.config.merchantEmail);
    const res = await createInvoiceRemote(this.client, payload);
    const invoice = { ...fromPayPalInvoice(res), createdBy: input.createdBy ?? ('human' as const) };
    this.store.update((s) => {
      s.invoices.unshift(invoice);
    });
    return invoice;
  }

  async listInvoices(): Promise<Invoice[]> {
    const remote = await listInvoicesRemote(this.client);
    const invoices = remote.map((r) => fromPayPalInvoice(r));
    return invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const local = this.store.snapshot.invoices.find((i) => i.id === id);
    if (local) return local;
    const rows = await this.listInvoices();
    return rows.find((i) => i.id === id) ?? null;
  }

  async sendInvoice(id: string): Promise<Invoice> {
    const invoice = await this.getInvoice(id);
    if (!invoice) throw new ProviderError(`Invoice ${id} not found`);
    if (invoice.status !== 'DRAFT') throw new ProviderError(`Invoice ${id} is ${invoice.status}; only DRAFT invoices can be sent`);
    await sendInvoiceRemote(this.client, id);
    const sent: Invoice = { ...invoice, status: 'SENT', sentAt: new Date().toISOString() };
    this.store.update((s) => {
      const idx = s.invoices.findIndex((i) => i.id === id);
      if (idx >= 0) s.invoices[idx] = sent;
      else s.invoices.unshift(sent);
    });
    return sent;
  }

  async markInvoicePaid(id: string): Promise<Invoice> {
    const invoice = await this.getInvoice(id);
    if (!invoice) throw new ProviderError(`Invoice ${id} not found`);
    if (invoice.status !== 'SENT') throw new ProviderError(`Invoice ${id} is ${invoice.status}; only SENT invoices can be marked paid`);
    const paid: Invoice = { ...invoice, status: 'PAID', paidAt: new Date().toISOString() };
    this.store.update((s) => {
      const idx = s.invoices.findIndex((i) => i.id === id);
      if (idx >= 0) s.invoices[idx] = paid;
    });
    return paid;
  }

  async listDisputes(): Promise<Dispute[]> {
    return listDisputesRemote(this.client);
  }

  async getDispute(id: string): Promise<Dispute | null> {
    const rows = await this.listDisputes();
    return rows.find((d) => d.id === id) ?? null;
  }

  async createOrder(input: OrderInput): Promise<DemoOrder> {
    const order = await createOrderRemote(this.client, input);
    this.store.update((s) => {
      s.orders.unshift(order);
    });
    return order;
  }

  async captureOrder(id: string): Promise<DemoOrder> {
    const captured = await captureOrderRemote(this.client, id);
    // Mirror the captured payment into the local ledger so grids and KPIs react.
    const tx: Transaction = {
      id: uid('txn'),
      timestamp: new Date().toISOString(),
      type: 'PAYMENT',
      status: 'COMPLETED',
      amount: round2(captured.amount),
      direction: 'in',
      currency: 'USD',
      counterparty: { name: captured.buyer ?? 'Sandbox Buyer', email: 'buyer-sandbox@paypal.com' },
      description: `Demo checkout — ${captured.item}`,
      method: 'paypal',
      category: 'Product sales',
      risk: { score: 0, flags: [] },
    };
    this.store.update((s) => {
      const idx = s.orders.findIndex((o) => o.id === id);
      if (idx >= 0) s.orders[idx] = captured;
      else s.orders.unshift(captured);
      s.transactions.unshift(tx);
    });
    this.ledgerCache = null;
    return captured;
  }
}

export const _dateKey = dateKey;
