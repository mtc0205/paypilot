/**
 * First Mate tool registry. Every tool has a strict JSON Schema, a `mutates`
 * flag (mutating tools go through human approval), and a typed executor.
 * The same registry serves the mock provider, real LLM providers, and the
 * approval-execution path — one definition, three consumers.
 */
import type { Dispute, Transaction } from '../../shared/types.js';
import { dateKey, daysBetween, fmtMoney, round2, sum } from '../../shared/util.js';
import { buildCashflowSummary, buildForecastSummary, explainTransaction, runInsights } from '../insights/index.js';
import type { PayPalProvider } from '../paypal/provider.js';
import type { Store } from '../store/store.js';
import { draftDisputeResponse } from './drafts.js';

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  defaultValue?: string | number;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  summary: string;
  data: unknown;
}

export interface ToolContext {
  store: Store;
  provider: PayPalProvider;
  now(): Date;
}

export interface ToolDef {
  name: string;
  description: string;
  mutates: boolean;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}

const TX_TYPES = ['PAYMENT', 'REFUND', 'FEE', 'PAYOUT', 'SUBSCRIPTION', 'CHARGEBACK', 'AUTHORIZATION', 'TRANSFER'] as const;
const TX_STATUSES = ['COMPLETED', 'PENDING', 'VOIDED', 'DENIED', 'REVERSED'] as const;

/* --------------------------------- Tools ------------------------------------- */

const searchTransactions: ToolDef = {
  name: 'search_transactions',
  description:
    'Structured search over the merchant ledger. Use for questions like "who paid me most", "show refunds", "what did Northwind pay last month". Matches counterparty name/email, description, or id.',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text match against counterparty, description, or transaction id' },
      direction: { type: 'string', enum: ['in', 'out'], description: 'in = money received, out = money paid' },
      type: { type: 'string', enum: [...TX_TYPES] },
      status: { type: 'string', enum: [...TX_STATUSES] },
      minAmount: { type: 'number', minimum: 0 },
      maxAmount: { type: 'number', minimum: 0 },
      lastDays: { type: 'integer', minimum: 1, maximum: 365, description: 'Only look this many days back' },
      limit: { type: 'integer', minimum: 1, maximum: 100, defaultValue: 10 },
    },
    required: [],
  },
  execute(args, ctx) {
    const limit = clampInt(args.limit, 1, 100, 10);
    const rows = filterTransactions(ctx.store.snapshot.transactions, args, ctx.now());
    const shown = rows.slice(0, limit);
    const net = round2(sum(shown.map((t) => (t.direction === 'in' ? t.amount : -t.amount))));
    const largest = shown[0];
    return {
      summary:
        `${rows.length} matching transaction(s), showing ${shown.length} · net ${fmtMoney(net)}` +
        (largest ? ` · largest ${fmtMoney(largest.amount)} ${largest.direction === 'in' ? 'from' : 'to'} ${largest.counterparty.name}` : ''),
      data: {
        total: rows.length,
        shown: shown.length,
        net,
        rows: shown.map(compactTx),
      },
    };
  },
};

const getCashflowSummary: ToolDef = {
  name: 'get_cashflow_summary',
  description: 'Totals, deltas vs the prior period, weekday pattern, MRR and subscription count for the last N days.',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'integer', minimum: 7, maximum: 120, defaultValue: 30 },
    },
    required: [],
  },
  execute(args, ctx) {
    const days = clampInt(args.days, 7, 120, 30);
    const summary = buildCashflowSummary(ctx.store.snapshot.transactions, days, ctx.now());
    const best = summary.weekdayAverages.reduce((a, b) => (b.avgNet > a.avgNet ? b : a));
    return {
      summary:
        `Net ${fmtMoney(summary.net)} over ${days}d (${summary.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(summary.deltaPct).toFixed(1)}% vs prior ` +
        `${days}d) · in ${fmtMoney(summary.inflow)} / out ${fmtMoney(summary.outflow)} · MRR ${fmtMoney(summary.mrr)} · ` +
        `best day ${best.weekday}`,
      data: {
        ...summary,
        subscriptions: summary.subscriptions.map((s) => ({
          counterparty: s.counterparty,
          direction: s.direction,
          amount: s.amount,
          cadenceDays: s.cadenceDays,
          confidence: s.confidence,
        })),
      },
    };
  },
};

const forecastCashflowTool: ToolDef = {
  name: 'forecast_cashflow',
  description: 'Forecast net cash flow for the next N days: linear trend + weekday seasonality with an 80% residual band.',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'integer', minimum: 7, maximum: 60, defaultValue: 30 },
    },
    required: [],
  },
  execute(args, ctx) {
    const days = clampInt(args.days, 7, 60, 30);
    const f = buildForecastSummary(ctx.store.snapshot.transactions, days, ctx.now());
    const trendWord = f.slopePerDay >= 0 ? 'growing' : 'declining';
    return {
      summary:
        `Next ${days}d expected net ${fmtMoney(f.expectedTotal)} (80% band ${fmtMoney(f.lowTotal)} – ${fmtMoney(f.highTotal)}) · ` +
        `trend ${trendWord} ${fmtMoney(Math.abs(f.slopePerDay))}/day`,
      data: {
        horizonDays: f.horizonDays,
        expectedTotal: f.expectedTotal,
        lowTotal: f.lowTotal,
        highTotal: f.highTotal,
        slopePerDay: f.slopePerDay,
        weekdayFactors: f.weekdayFactors,
        points: f.points.map((p) => ({ date: p.date, expected: p.expected, low: p.low, high: p.high })),
      },
    };
  },
};

const detectAnomalies: ToolDef = {
  name: 'detect_anomalies',
  description: 'Current alerts from the deterministic insight engine: amount outliers, velocity bursts, card-testing, refund spikes, concentration, dispute deadlines.',
  mutates: false,
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['all', 'anomalies_only'], defaultValue: 'all' },
    },
    required: [],
  },
  execute(args, ctx) {
    const scope = args.scope === 'anomalies_only' ? 'anomalies_only' : 'all';
    let alerts = runInsights({ transactions: ctx.store.snapshot.transactions, disputes: ctx.store.snapshot.disputes, now: ctx.now() });
    if (scope === 'anomalies_only') {
      alerts = alerts.filter((a) => a.kind !== 'dispute_deadline' && a.kind !== 'customer_concentration');
    }
    const top = alerts.slice(0, 6);
    const critical = top.filter((a) => a.severity === 'critical').length;
    return {
      summary: `${alerts.length} insight(s)${scope === 'anomalies_only' ? ' (anomaly scope)' : ''}, ${critical} critical · top: ${top[0]?.title ?? 'nothing urgent'}`,
      data: { total: alerts.length, critical, alerts: top },
    };
  },
};

const listDisputes: ToolDef = {
  name: 'list_disputes',
  description: 'Open PayPal disputes with response deadlines, amounts, reasons, and evidence-checklist progress.',
  mutates: false,
  parameters: { type: 'object', properties: {}, required: [] },
  execute(_args, ctx) {
    const disputes = ctx.store.snapshot.disputes
      .filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW')
      .map((d) => ({
        id: d.id,
        reason: d.reason,
        amount: d.amount,
        daysLeft: daysBetween(ctx.now(), new Date(d.respondBy)),
        buyer: d.buyer.name,
        evidenceDone: d.evidence.filter((e) => e.done).length,
        evidenceTotal: d.evidence.length,
      }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const exposure = round2(sum(disputes.map((d) => d.amount)));
    return {
      summary:
        disputes.length === 0
          ? 'No open disputes — clean slate.'
          : `${disputes.length} open dispute(s), ${fmtMoney(exposure)} at stake · nearest deadline ${disputes[0].daysLeft}d (${disputes[0].id})`,
      data: { disputes, exposure },
    };
  },
};

const draftDisputeResponseTool: ToolDef = {
  name: 'draft_dispute_response',
  description: 'Draft (does NOT submit) a dispute response from the evidence checklist and linked transaction. Drafting is local and reversible, so it needs no approval.',
  mutates: false,
  parameters: {
    type: 'object',
    properties: { dispute_id: { type: 'string', description: 'PayPal dispute id, e.g. PP-D-9100' } },
    required: ['dispute_id'],
  },
  execute(args, ctx) {
    const id = String(args.dispute_id ?? '');
    const dispute = ctx.store.snapshot.disputes.find((d) => d.id === id);
    if (!dispute) throw new Error(`Dispute ${id} not found`);
    const tx = ctx.store.snapshot.transactions.find((t) => t.id === dispute.transactionId) ?? null;
    const draft = draftDisputeResponse(dispute, tx, ctx.store.snapshot.merchant.name);
    const daysLeft = daysBetween(ctx.now(), new Date(dispute.respondBy));
    ctx.store.update((s) => {
      const idx = s.disputes.findIndex((d) => d.id === id);
      if (idx >= 0) s.disputes[idx] = { ...s.disputes[idx], aiDraft: draft, aiDraftedAt: ctx.now().toISOString() };
    });
    return {
      summary: `Drafted a response to ${id} (${fmtMoney(dispute.amount)}, ${daysLeft}d left) — review it on the Disputes page before submitting.`,
      data: { disputeId: id, daysLeft, draftPreview: draft.slice(0, 400) + (draft.length > 400 ? '…' : '') },
    };
  },
};

const createInvoice: ToolDef = {
  name: 'create_invoice',
  description: 'Create a PayPal invoice (starts as DRAFT). Mutating: requires human approval before executing.',
  mutates: true,
  parameters: {
    type: 'object',
    properties: {
      recipient: { type: 'string', description: 'Recipient name, e.g. "Acme Corp"' },
      recipientEmail: { type: 'string', description: 'Optional recipient email' },
      item: { type: 'string', description: 'Line item description', defaultValue: 'Professional services' },
      amount: { type: 'number', minimum: 0.01, maximum: 1000000, description: 'Unit amount in USD' },
      quantity: { type: 'integer', minimum: 1, maximum: 999, defaultValue: 1 },
      dueDays: { type: 'integer', minimum: 0, maximum: 365, defaultValue: 30 },
      memo: { type: 'string' },
    },
    required: ['recipient', 'amount'],
  },
  async execute(args, ctx) {
    const invoice = await ctx.provider.createInvoice({
      recipientName: String(args.recipient ?? ''),
      recipientEmail: args.recipientEmail ? String(args.recipientEmail) : undefined,
      item: args.item ? String(args.item) : 'Professional services',
      amount: Number(args.amount),
      quantity: args.quantity ? Number(args.quantity) : 1,
      dueDays: args.dueDays !== undefined ? Number(args.dueDays) : 30,
      memo: args.memo ? String(args.memo) : undefined,
      createdBy: 'agent',
    });
    return {
      summary: `Invoice ${invoice.number} created (DRAFT) — ${fmtMoney(invoice.total)} to ${invoice.recipient.name}, due ${invoice.dueDate}.`,
      data: { invoiceId: invoice.id, number: invoice.number, total: invoice.total, dueDate: invoice.dueDate, recipient: invoice.recipient.name },
    };
  },
};

const sendInvoice: ToolDef = {
  name: 'send_invoice',
  description: 'Email a DRAFT invoice to its recipient via PayPal. Mutating: requires human approval before executing.',
  mutates: true,
  parameters: {
    type: 'object',
    properties: { invoice_id: { type: 'string', description: 'Invoice id or number' } },
    required: ['invoice_id'],
  },
  async execute(args, ctx) {
    const invoice = await ctx.provider.sendInvoice(String(args.invoice_id ?? ''));
    return {
      summary: `Invoice ${invoice.number} sent to ${invoice.recipient.email}.`,
      data: { invoiceId: invoice.id, number: invoice.number, sentTo: invoice.recipient.email },
    };
  },
};

const explainTransactionTool: ToolDef = {
  name: 'explain_transaction',
  description: 'Plain-language explanation of one transaction: statistical context, counterparty history, risk signals. Deterministic (no LLM).',
  mutates: false,
  parameters: {
    type: 'object',
    properties: { transaction_id: { type: 'string', description: 'Ledger transaction id, e.g. txn_01234' } },
    required: ['transaction_id'],
  },
  execute(args, ctx) {
    const id = String(args.transaction_id ?? '');
    const tx = ctx.store.snapshot.transactions.find((t) => t.id === id);
    if (!tx) throw new Error(`Transaction ${id} not found`);
    const explanation = explainTransaction(tx, ctx.store.snapshot.transactions, ctx.now());
    return { summary: explanation.summary, data: { transaction: compactTx(tx), bullets: explanation.bullets } };
  },
};

export const TOOLS: ToolDef[] = [
  searchTransactions,
  getCashflowSummary,
  forecastCashflowTool,
  detectAnomalies,
  listDisputes,
  draftDisputeResponseTool,
  createInvoice,
  sendInvoice,
  explainTransactionTool,
];

export const MUTATING_TOOLS = new Set(TOOLS.filter((t) => t.mutates).map((t) => t.name));

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/* ------------------------------ Arg validation ------------------------------- */

export function validateArgs(tool: ToolDef, args: Record<string, unknown>): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const required of tool.parameters.required) {
    if (args[required] === undefined || args[required] === null || args[required] === '') {
      errors.push(`missing required parameter "${required}"`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = tool.parameters.properties[key];
    if (!prop) {
      errors.push(`unknown parameter "${key}"`);
      continue;
    }
    if (value === undefined || value === null) continue;
    const typeOk =
      (prop.type === 'string' && typeof value === 'string') ||
      ((prop.type === 'number' || prop.type === 'integer') && typeof value === 'number' && (prop.type !== 'integer' || Number.isInteger(value))) ||
      (prop.type === 'boolean' && typeof value === 'boolean');
    if (!typeOk) {
      errors.push(`parameter "${key}" must be ${prop.type} (got ${typeof value})`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(value as string | number)) {
      errors.push(`parameter "${key}" must be one of ${prop.enum.join(', ')}`);
    }
    if (typeof value === 'number') {
      if (prop.minimum !== undefined && value < prop.minimum) errors.push(`parameter "${key}" must be >= ${prop.minimum}`);
      if (prop.maximum !== undefined && value > prop.maximum) errors.push(`parameter "${key}" must be <= ${prop.maximum}`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/* --------------------------------- Helpers ----------------------------------- */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function filterTransactions(rows: Transaction[], args: Record<string, unknown>, now: Date): Transaction[] {
  const query = args.query ? String(args.query).toLowerCase() : null;
  const direction = args.direction === 'in' || args.direction === 'out' ? args.direction : null;
  const type = args.type ? String(args.type) : null;
  const status = args.status ? String(args.status) : null;
  const minAmount = typeof args.minAmount === 'number' ? args.minAmount : null;
  const maxAmount = typeof args.maxAmount === 'number' ? args.maxAmount : null;
  const lastDays = typeof args.lastDays === 'number' ? args.lastDays : null;
  const cutoff = lastDays ? now.getTime() - lastDays * 86_400_000 : null;
  return rows.filter((t) => {
    if (query) {
      const hay = `${t.counterparty.name} ${t.counterparty.email} ${t.description} ${t.id}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    if (direction && t.direction !== direction) return false;
    if (type && t.type !== type) return false;
    if (status && t.status !== status) return false;
    if (minAmount !== null && t.amount < minAmount) return false;
    if (maxAmount !== null && t.amount > maxAmount) return false;
    if (cutoff && new Date(t.timestamp).getTime() < cutoff) return false;
    return true;
  });
}

export function compactTx(t: Transaction): Record<string, unknown> {
  return {
    id: t.id,
    date: dateKey(new Date(t.timestamp)),
    counterparty: t.counterparty.name,
    email: t.counterparty.email,
    description: t.description,
    type: t.type,
    status: t.status,
    amount: t.amount,
    signed: round2(t.direction === 'in' ? t.amount : -t.amount),
    category: t.category,
    risk: t.risk.score,
  };
}

export function openDisputes(store: Store): Dispute[] {
  return store.snapshot.disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW');
}
