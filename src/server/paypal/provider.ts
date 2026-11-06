/**
 * Unified PayPal provider interface. Both the mock adapter and the real
 * sandbox adapter implement this contract, so services and the agent runtime
 * never care which mode they are talking to. Selected via PAYPAL_ENV.
 */
import type { DemoOrder, Dispute, Invoice, Transaction } from '../../shared/types.js';

export interface InvoiceDraftInput {
  recipientName: string;
  recipientEmail?: string;
  item: string;
  amount: number;
  quantity?: number;
  dueDays?: number;
  memo?: string;
  /** Who initiated: the human composer UI or the agent (after approval). */
  createdBy?: 'human' | 'agent';
}

export interface OrderInput {
  item: string;
  amount: number;
}

export interface PayPalProvider {
  readonly mode: 'mock' | 'sandbox';
  listTransactions(): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction | null>;
  createInvoice(input: InvoiceDraftInput): Promise<Invoice>;
  listInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  sendInvoice(id: string): Promise<Invoice>;
  markInvoicePaid(id: string): Promise<Invoice>;
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute | null>;
  createOrder(input: OrderInput): Promise<DemoOrder>;
  captureOrder(id: string): Promise<DemoOrder>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}
