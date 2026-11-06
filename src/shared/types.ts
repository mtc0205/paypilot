/**
 * PayPilot shared domain types — used by BOTH the Fastify server and the React web app.
 * Keep this file dependency-free so it compiles under NodeNext (server) and bundler (web).
 */

export type TxDirection = 'in' | 'out';

export type TransactionType =
  | 'PAYMENT'
  | 'REFUND'
  | 'FEE'
  | 'PAYOUT'
  | 'SUBSCRIPTION'
  | 'CHARGEBACK'
  | 'AUTHORIZATION'
  | 'TRANSFER';

export type TransactionStatus = 'COMPLETED' | 'PENDING' | 'VOIDED' | 'DENIED' | 'REVERSED';

export type PaymentMethod = 'paypal' | 'card' | 'bank';

export interface Counterparty {
  name: string;
  email: string;
}

export interface RiskAssessment {
  /** 0 (safe) .. 100 (very risky) */
  score: number;
  flags: string[];
}

export interface Transaction {
  id: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  type: TransactionType;
  status: TransactionStatus;
  /** Always a positive magnitude; `direction` carries the sign. */
  amount: number;
  direction: TxDirection;
  currency: 'USD';
  counterparty: Counterparty;
  description: string;
  method: PaymentMethod;
  category: string;
  risk: RiskAssessment;
  invoiceId?: string;
  disputeId?: string;
}

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'CANCELLED'
  | 'REFUNDED';

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitAmount: number;
}

export interface Invoice {
  id: string;
  /** Human-friendly invoice number, e.g. PP-2026-0042 */
  number: string;
  status: InvoiceStatus;
  recipient: Counterparty;
  items: InvoiceItem[];
  total: number;
  currency: 'USD';
  /** ISO date (YYYY-MM-DD) the invoice is due */
  dueDate: string;
  memo?: string;
  createdAt: string;
  sentAt?: string;
  paidAt?: string;
  createdBy: 'human' | 'agent';
}

export type DisputeStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'WAITING_FOR_BUYER'
  | 'RESOLVED_SELLER'
  | 'RESOLVED_BUYER'
  | 'CANCELLED';

export type DisputeReason =
  | 'UNAUTHORIZED'
  | 'MERCHANDISE_NOT_AS_DESCRIBED'
  | 'ITEM_NOT_RECEIVED'
  | 'DUPLICATE'
  | 'REFUNDED'
  | 'SUBSCRIBED_UNKNOWN';

export interface EvidenceItem {
  label: string;
  done: boolean;
  hint: string;
}

export interface Dispute {
  id: string;
  reason: DisputeReason;
  status: DisputeStatus;
  amount: number;
  currency: 'USD';
  transactionId: string;
  buyer: Counterparty;
  openedAt: string;
  /** ISO timestamp — merchant must respond before this or lose by default */
  respondBy: string;
  evidence: EvidenceItem[];
  aiDraft?: string;
  aiDraftedAt?: string;
}

export type OrderStatus = 'CREATED' | 'APPROVED' | 'COMPLETED';

export interface DemoOrder {
  id: string;
  status: OrderStatus;
  amount: number;
  currency: 'USD';
  item: string;
  buyer?: string;
  createdAt: string;
  capturedAt?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  createdAt: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decidedBy?: string;
  result?: unknown;
  error?: string;
}

export type AuditActor = 'agent' | 'human' | 'system';

export interface AuditEntry {
  id: string;
  ts: string;
  actor: AuditActor;
  action: string;
  args: Record<string, unknown>;
  result: 'ok' | 'error' | 'pending';
  detail?: string;
  approved: boolean;
  approver?: string;
  relatedId?: string;
}

/* ---------------------------------- Insights --------------------------------- */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertKind =
  | 'amount_outlier'
  | 'velocity_burst'
  | 'card_testing'
  | 'refund_spike'
  | 'customer_concentration'
  | 'dispute_deadline'
  | 'subscription_missed';

export interface InsightAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | boolean>;
  detectedAt: string;
  transactionIds?: string[];
}

export interface CashflowDay {
  /** UTC date key YYYY-MM-DD */
  date: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface ForecastPoint {
  date: string;
  expected: number;
  low: number;
  high: number;
}

export interface Subscription {
  id: string;
  counterparty: string;
  direction: TxDirection;
  amount: number;
  cadenceDays: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  nextExpected: string;
  /** 0..1 */
  confidence: number;
  varianceDays: number;
}

export interface CustomerShare {
  name: string;
  revenue90d: number;
  share: number;
  txCount: number;
}

/* ------------------------------- Agent / chat -------------------------------- */

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; tool: string; ok: boolean; result: unknown; summary?: string }
  | { type: 'approval_request'; approvalId: string; tool: string; args: Record<string, unknown>; rationale: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/* --------------------------------- API DTOs ---------------------------------- */

export interface Kpis {
  netToday: number;
  net30d: number;
  net30dDeltaPct: number;
  mrr: number;
  disputeRate: number;
  openDisputes: number;
  activeSubscriptions: number;
  pendingInvoices: number;
  criticalAlerts: number;
}

export interface ParsedInvoiceDraft {
  recipientName?: string;
  recipientEmail?: string;
  amount: number;
  itemName: string;
  quantity: number;
  dueDays: number;
  memo?: string;
  confidence: number;
  notes: string[];
}

export interface AppMeta {
  version: string;
  paypalEnv: 'mock' | 'sandbox';
  aiProvider: string;
  aiModel: string | null;
  merchantName: string;
  seededAt: string | null;
  counts: { transactions: number; invoices: number; disputes: number; orders: number; audit: number };
}
