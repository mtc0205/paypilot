import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/shared/types.js';
import { makeDeps, executeApprovedTool } from '../src/server/agent/runtime.js';
import { mockRespond } from '../src/server/agent/providers/mock.js';
import { decideApproval } from '../src/server/agent/approvals.js';
import { MockPayPalProvider } from '../src/server/paypal/mock/ledger.js';
import { generateSeed } from '../src/server/paypal/seed.js';
import { Store } from '../src/server/store/store.js';
import type { ToolContext } from '../src/server/agent/tools.js';

const NOW = new Date('2026-06-15T12:00:00Z');

function fixture() {
  const store = new Store(null);
  store.reset(generateSeed({ now: NOW }));
  const provider = new MockPayPalProvider(store);
  const ctx: ToolContext = { store, provider, now: () => NOW };
  return { store, provider, ctx };
}

async function run(message: string, ctx: ToolContext): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const deps = makeDeps(ctx, (e) => events.push(e), 0);
  await mockRespond({ message, history: [] }, deps, ctx);
  return events;
}

const textOf = (events: AgentEvent[]): string =>
  events
    .filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token')
    .map((e) => e.text)
    .join('');

describe('mock AI provider — deterministic, insight-driven answers', () => {
  it('"what is happening with my money" calls summary + anomalies + forecast and quotes real numbers', async () => {
    const { ctx } = fixture();
    const events = await run("What's happening with my money?", ctx);
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool);
    expect(calls).toContain('get_cashflow_summary');
    expect(calls).toContain('detect_anomalies');
    expect(calls).toContain('forecast_cashflow');

    const text = textOf(events);
    expect(text).toMatch(/net/i);
    expect(text).toMatch(/\$/); // quotes actual dollar figures from tool results
    // anomaly narrative references the card-testing incident
    expect(text.toLowerCase()).toMatch(/card-testing|insight|forecast/);
    // tool results carry real data
    const summary = events.find((e) => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }> | undefined;
    expect(summary).toBeDefined();
    expect(Number((summary?.result as { net: number }).net)).toBeGreaterThan(0);
  });

  it('the demo invoice prompt produces an approval-gated create_invoice call', async () => {
    const { store, ctx } = fixture();
    const events = await run('Invoice Acme $420 for consulting, due in 14 days', ctx);

    const call = events.find((e) => e.type === 'tool_call') as Extract<AgentEvent, { type: 'tool_call' }> | undefined;
    expect(call?.tool).toBe('create_invoice');
    expect(call?.args).toMatchObject({ recipient: 'Acme', amount: 420, dueDays: 14 });

    const approvalEvt = events.find((e) => e.type === 'approval_request') as Extract<AgentEvent, { type: 'approval_request' }> | undefined;
    expect(approvalEvt).toBeDefined();
    expect(approvalEvt?.rationale).toContain('$420');

    // Nothing executed yet: approval is pending, no invoice was created
    const pending = store.snapshot.approvals.find((a) => a.id === approvalEvt?.approvalId);
    expect(pending?.status).toBe('pending');
    expect(store.snapshot.invoices.some((i) => i.recipient.name === 'Acme' && i.total === 420)).toBe(false);

    // Audit trail already records the request
    expect(store.snapshot.audit.some((a) => a.action === 'create_invoice' && a.result === 'pending')).toBe(true);

    // APPROVE -> executes against the (mock) PayPal provider
    const outcome = await decideApproval(store, pending!.id, 'approve', 'merchant', (tool, args) =>
      executeApprovedTool(tool, args, ctx),
    );
    expect(outcome.status).toBe('approved');
    const invoice = store.snapshot.invoices.find((i) => i.recipient.name === 'Acme');
    expect(invoice).toBeDefined();
    expect(invoice?.status).toBe('DRAFT');
    expect(invoice?.createdBy).toBe('agent');
    expect(store.snapshot.audit.some((a) => a.action === 'create_invoice' && a.result === 'ok' && a.approver === 'merchant')).toBe(true);
  });

  it('REJECTING an approval executes nothing', async () => {
    const { store, ctx } = fixture();
    const events = await run('Invoice Beta LLC $900 for a site audit, due in 10 days', ctx);
    const approvalEvt = events.find((e) => e.type === 'approval_request') as Extract<AgentEvent, { type: 'approval_request' }>;
    const outcome = await decideApproval(store, approvalEvt.approvalId, 'reject', 'merchant', (tool, args) =>
      executeApprovedTool(tool, args, ctx),
    );
    expect(outcome.status).toBe('rejected');
    expect(store.snapshot.invoices.some((i) => i.recipient.name === 'Beta LLC')).toBe(false);
    expect(store.snapshot.audit.some((a) => a.action === 'approval_rejected' && a.approver === 'merchant')).toBe(true);
  });

  it('dispute questions list deadlines and draft responses without approval', async () => {
    const { store, ctx } = fixture();
    const events = await run('Any disputes needing attention? Draft a response for the first one', ctx);
    const calls = events.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool);
    expect(calls).toContain('list_disputes');
    expect(calls).toContain('draft_dispute_response');

    const text = textOf(events);
    expect(text).toMatch(/dispute/i);
    expect(text).toMatch(/PP-D-/);
    // drafting is NOT approval-gated
    expect(events.find((e) => e.type === 'approval_request')).toBeUndefined();
    // draft persisted on the dispute
    expect(store.snapshot.disputes.some((d) => d.aiDraft && d.aiDraft.length > 100)).toBe(true);
  });

  it('forecast and search intents route to the right tools', async () => {
    const { ctx } = fixture();
    const fEvents = await run('Forecast next 30 days', ctx);
    expect(fEvents.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool)).toContain('forecast_cashflow');
    expect(textOf(fEvents)).toMatch(/80% band/i);

    const sEvents = await run('What did Northwind Labs pay me?', ctx);
    expect(sEvents.filter((e) => e.type === 'tool_call').map((e) => (e as { tool: string }).tool)).toContain('search_transactions');
    expect(textOf(sEvents).toLowerCase()).toContain('northwind');
  });
});
