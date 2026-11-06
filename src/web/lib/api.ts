import type {
  AgentEvent,
  AppMeta,
  AuditEntry,
  Approval,
  ChatTurn,
  DemoOrder,
  Dispute,
  InsightAlert,
  Invoice,
  Kpis,
  ParsedInvoiceDraft,
  Subscription,
  Transaction,
} from '@shared/types';
import type { CashflowDay, CustomerShare, ForecastPoint } from '@shared/types';

export interface OverviewResponse {
  merchant: { name: string; business: string };
  kpis: Kpis;
  series: CashflowDay[];
  forecast: {
    points: ForecastPoint[];
    slopePerDay: number;
    bandHalfWidth: number;
    expectedTotal: number;
    lowTotal: number;
    highTotal: number;
  };
  alerts: InsightAlert[];
  subscriptions: Subscription[];
  customers: CustomerShare[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const getOverview = () => api<OverviewResponse>('/api/overview');
export const getMeta = () => api<AppMeta>('/api/meta');
export const getTransactions = () => api<{ rows: Transaction[]; total: number; net: number }>('/api/transactions');
export const getTransaction = (id: string) => api<Transaction>(`/api/transactions/${id}`);
export const explainTransaction = (id: string) =>
  api<{ summary: string; bullets: string[] }>(`/api/transactions/${id}/explain`);
export const getDisputes = () => api<Dispute[]>('/api/disputes');
export const draftDispute = (id: string) => api<{ disputeId: string; draft: string }>(`/api/disputes/${id}/draft`, { method: 'POST' });
export const toggleEvidence = (id: string, index: number, done: boolean) =>
  api<{ evidence: { label: string; done: boolean }[] }>(`/api/disputes/${id}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ index, done }),
  });
export const getInvoices = () => api<Invoice[]>('/api/invoices');
export const parseInvoice = (text: string) =>
  api<{ draft: ParsedInvoiceDraft }>('/api/invoice/parse', { method: 'POST', body: JSON.stringify({ text }) });
export const createInvoice = (payload: { recipientName: string; recipientEmail?: string; item: string; amount: number; dueDays: number; memo?: string }) =>
  api<Invoice>('/api/invoices', { method: 'POST', body: JSON.stringify(payload) });
export const sendInvoice = (id: string) => api<Invoice>(`/api/invoices/${id}/send`, { method: 'POST' });
export const markInvoicePaid = (id: string) => api<Invoice>(`/api/invoices/${id}/mark-paid`, { method: 'POST' });
export const getAudit = () => api<{ rows: AuditEntry[]; total: number }>('/api/audit?limit=500');
export const getApprovals = (status?: string) =>
  api<{ rows: Approval[]; total: number }>(`/api/approvals${status ? `?status=${status}` : ''}`);
export const decideApprovalRequest = (id: string, decision: 'approve' | 'reject') =>
  api<{ status: string; summary?: string; error?: string }>(`/api/approvals/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, by: 'merchant' }),
  });
export const createDemoOrder = (item: string, amount: number) =>
  api<DemoOrder>('/api/demo/order', { method: 'POST', body: JSON.stringify({ item, amount }) });
export const approveDemoOrder = (id: string) => api<DemoOrder>(`/api/demo/order/${id}/approve`, { method: 'POST' });
export const captureDemoOrder = (id: string) => api<DemoOrder>(`/api/demo/order/${id}/capture`, { method: 'POST' });

/** Stream one agent chat turn over SSE; returns the raw Response body reader. */
export async function streamChat(message: string, history: ChatTurn[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat stream failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }
}

/** Cross-page refresh signal (e.g. an approval executed, ledger changed). */
export const REFRESH_EVENT = 'paypilot:refresh';
export function announceRefresh(): void {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}
