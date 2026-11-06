/**
 * Deterministic mock AI provider. Builds genuinely useful answers by calling
 * the REAL insight engine through the REAL tool registry, so the full product
 * experience — streaming tokens, tool cards, approval cards — works with zero
 * API keys. Intent routing is regex + the NL invoice parser; narratives quote
 * actual numbers from tool results.
 */
import { fmtMoney } from '../../../shared/util.js';
import { parseInvoiceText } from '../parser.js';
import type { AgentDeps, AgentRequest } from '../runtime.js';
import type { ToolContext, ToolResult } from '../tools.js';

interface IntentResult {
  kind:
    | 'create_invoice'
    | 'send_invoice'
    | 'overview'
    | 'disputes'
    | 'forecast'
    | 'search'
    | 'explain'
    | 'greeting';
  args?: Record<string, unknown>;
  query?: string | null;
  disputeId?: string;
  transactionId?: string;
}

export function detectIntent(message: string, ctx: ToolContext): IntentResult {
  const lower = message.toLowerCase();

  // Send an existing invoice
  if (/\bsend\b/.test(lower) && /invoice|inv-|inv_|it\b/.test(lower)) {
    const idMatch = message.match(/(INV-\d{4,}|PP-\d{4}-\d{4,}|inv_[A-Za-z0-9]+)/i);
    const invoiceId =
      idMatch?.[1] ?? ctx.store.snapshot.invoices.find((i) => i.status === 'DRAFT')?.id ?? null;
    if (invoiceId) return { kind: 'send_invoice', args: { invoice_id: invoiceId } };
  }

  // Create an invoice from natural language
  if (/\binvoice\b|\bbill\b|\bcharge\b/.test(lower)) {
    try {
      const parsed = parseInvoiceText(message);
      if (parsed.amount > 0 && (parsed.recipientName || parsed.memo)) {
        return {
          kind: 'create_invoice',
          args: {
            recipient: parsed.recipientName ?? 'Customer',
            recipientEmail: parsed.recipientEmail,
            item: parsed.itemName,
            amount: parsed.amount,
            quantity: parsed.quantity,
            dueDays: parsed.dueDays,
            memo: parsed.memo,
          },
        };
      }
    } catch {
      // fall through to other intents
    }
  }

  if (/dispute|chargeback/.test(lower)) {
    const idMatch = message.match(/PP-D-\d+/i);
    return { kind: 'disputes', disputeId: idMatch?.[0]?.toUpperCase() };
  }

  if (/explain|why did|what is txn_|tell me about/.test(lower)) {
    const idMatch = message.match(/txn_\d+/i);
    if (idMatch) return { kind: 'explain', transactionId: idMatch[0] };
    const risky = ctx.store.snapshot.transactions.find((t) => t.risk.score >= 55);
    if (risky) return { kind: 'explain', transactionId: risky.id };
  }

  if (/forecast|predict|projection|next (30|14|60) days?|next month|cash ?flow ahead|outlook/.test(lower)) {
    return { kind: 'forecast', args: { days: 30 } };
  }

  if (/how many|who (paid|is|pays)|find |search|show me|spent|paid me|largest|biggest|top customer|what did|did .+ (pay|buy)|from \w+/.test(lower)) {
    return { kind: 'search', query: extractQuery(message) };
  }

  if (/money|happening|status|health|summary|overview|how('s| is) (it|business)|what should i know|briefing/.test(lower)) {
    return { kind: 'overview' };
  }

  return { kind: 'greeting' };
}

function extractQuery(message: string): string | null {
  const cleaned = message
    .replace(/[^a-z0-9@.\s-]/gi, ' ')
    .replace(/\b(show me|find|search|how many|who|paid|payments?|transactions?|from|did|the|my|me|to|in|last|month|week|days?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 40) return null;
  return cleaned;
}

/* ------------------------------ Token streaming ------------------------------ */

async function streamText(deps: AgentDeps, text: string): Promise<void> {
  const parts = text.split(/(\s+)/);
  let buffer = '';
  for (const part of parts) {
    buffer += part;
    if (buffer.length >= 6 || /\n/.test(part)) {
      deps.emit({ type: 'token', text: buffer });
      buffer = '';
      if (deps.streamDelayMs > 0) await deps.sleep(deps.streamDelayMs);
    }
  }
  if (buffer) deps.emit({ type: 'token', text: buffer });
}

/* -------------------------------- Narratives --------------------------------- */

interface ForecastData {
  expectedTotal: number;
  lowTotal: number;
  highTotal: number;
  slopePerDay: number;
}
interface SummaryData {
  net: number;
  deltaPct: number;
  inflow: number;
  outflow: number;
  mrr: number;
}
interface AnomalyData {
  critical: number;
  total: number;
  alerts: { title: string; severity: string; detail: string }[];
}
interface DisputeData {
  exposure: number;
  disputes: { id: string; amount: number; daysLeft: number; reason: string; evidenceDone: number; evidenceTotal: number }[];
}
interface SearchData {
  total: number;
  net: number;
  rows: { id: string; counterparty: string; signed: number; description: string }[];
}
interface ExplainData {
  transaction: { id: string; counterparty: string; amount: number; description: string };
  bullets: string[];
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]+[.!?]/);
  return m ? m[0] : s;
}

async function narrateOverview(deps: AgentDeps): Promise<void> {
  const summaryR = await deps.callTool('get_cashflow_summary', { days: 30 });
  const anomalyR = await deps.callTool('detect_anomalies', { scope: 'all' });
  const forecastR = await deps.callTool('forecast_cashflow', { days: 14 });

  const s = summaryR.status === 'ok' ? (summaryR.result.data as SummaryData) : null;
  const a = anomalyR.status === 'ok' ? (anomalyR.result.data as AnomalyData) : null;
  const f = forecastR.status === 'ok' ? (forecastR.result.data as ForecastData) : null;

  const lines: string[] = [];
  if (s) {
    lines.push(
      `Here's your money picture for the last 30 days: net ${fmtMoney(s.net)} ` +
        `(${s.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(s.deltaPct).toFixed(1)}% vs the prior 30), from ` +
        `${fmtMoney(s.inflow)} in / ${fmtMoney(s.outflow)} out. Detected recurring revenue is ${fmtMoney(s.mrr)}/mo.`,
    );
  }
  if (a && a.alerts.length > 0) {
    const top = a.alerts.slice(0, 2);
    lines.push(
      `${a.total} insight${a.total === 1 ? '' : 's'} on file, ${a.critical} critical — most urgent: ${top[0].title}. ` +
        (top[1] ? `Also: ${firstSentence(top[1].detail)} ` : ''),
    );
  } else {
    lines.push('No anomalies flagged by the insight engine — quiet seas.');
  }
  if (f) {
    lines.push(
      `Looking ahead 14 days: expected net ${fmtMoney(f.expectedTotal)} (80% band ${fmtMoney(f.lowTotal)}–${fmtMoney(f.highTotal)}), ` +
        `trend ${f.slopePerDay >= 0 ? '+' : ''}${fmtMoney(f.slopePerDay)}/day.`,
    );
  }
  lines.push('Want me to dig into any alert, draft a dispute response, or prepare an invoice?');
  await streamText(deps, lines.join('\n\n'));
}

async function narrateForecast(deps: AgentDeps, result: { status: string; result?: ToolResult } ): Promise<void> {
  if (result.status !== 'ok' || !result.result) {
    await streamText(deps, "I couldn't build a forecast — the engine needs at least 14 days of history.");
    return;
  }
  const f = result.result.data as ForecastData;
  await streamText(
    deps,
    `Next 30 days: expected net ${fmtMoney(f.expectedTotal)}, with an 80% band of ${fmtMoney(f.lowTotal)} to ${fmtMoney(f.highTotal)} ` +
      `(residual-based, so the band reflects how noisy your daily net actually is). The underlying trend is ` +
      `${f.slopePerDay >= 0 ? 'growing' : 'declining'} ${fmtMoney(Math.abs(f.slopePerDay))}/day before weekday seasonality. ` +
      `Tip: your weekday factors are in the tool card — Saturdays run well below your average, Mondays above.`,
  );
}

async function narrateDisputes(deps: AgentDeps, disputeId: string | undefined): Promise<string | undefined> {
  const listR = await deps.callTool('list_disputes', {});
  if (listR.status !== 'ok' || !listR.result) {
    await streamText(deps, 'Could not load disputes right now.');
    return;
  }
  const d = listR.result.data as DisputeData;
  if (d.disputes.length === 0) {
    await streamText(deps, 'No open disputes — nothing needs your attention there.');
    return undefined;
  }
  const lines = [
    `You have ${d.disputes.length} open dispute${d.disputes.length === 1 ? '' : 's'} with ${fmtMoney(d.exposure)} at stake:`,
  ];
  for (const disp of d.disputes) {
    lines.push(
      `• ${disp.id} — ${fmtMoney(disp.amount)}, ${disp.reason.replace(/_/g, ' ').toLowerCase()}, respond within ${disp.daysLeft}d ` +
        `(evidence ${disp.evidenceDone}/${disp.evidenceTotal}).`,
    );
  }
  const target = disputeId ?? d.disputes[0]?.id;
  lines.push(`Want me to draft the response to ${target}? I'll pull the linked transaction and evidence checklist — drafting needs no approval, submitting to PayPal stays 100% in your hands.`);
  await streamText(deps, lines.join('\n'));
  return target;
}

async function narrateSearch(deps: AgentDeps, query: string | null): Promise<void> {
  const args: Record<string, unknown> = { lastDays: 90, limit: 8 };
  if (query) args.query = query;
  const r = await deps.callTool('search_transactions', args);
  if (r.status !== 'ok' || !r.result) {
    await streamText(deps, 'Search failed — try again with simpler terms.');
    return;
  }
  const d = r.result.data as SearchData;
  if (d.total === 0) {
    await streamText(deps, `No transactions matched${query ? ` "${query}"` : ''} in the last 90 days.`);
    return;
  }
  const rows = d.rows.slice(0, 5).map((row) => `• ${row.counterparty} ${row.signed >= 0 ? '+' : '−'}${fmtMoney(Math.abs(row.signed))} — ${row.description}`);
  await streamText(
    deps,
    `${r.result.summary}\n${rows.join('\n')}\n\nFull results are in the card above — click any row in Transactions to see risk and stats.`,
  );
}

async function narrateExplain(deps: AgentDeps, transactionId: string): Promise<void> {
  const r = await deps.callTool('explain_transaction', { transaction_id: transactionId });
  if (r.status !== 'ok' || !r.result) {
    await streamText(deps, `I couldn't find transaction ${transactionId}.`);
    return;
  }
  const d = r.result.data as ExplainData;
  const bullets = d.bullets.slice(0, 4).map((b) => `• ${b}`);
  await streamText(deps, `${r.result.summary}\n${bullets.join('\n')}`);
}

async function narrateCreateInvoice(deps: AgentDeps, args: Record<string, unknown>): Promise<void> {
  await streamText(
    deps,
    `Got it — ${fmtMoney(Number(args.amount))} to ${String(args.recipient)} for "${String(args.item ?? args.memo ?? 'services')}", due in ${String(args.dueDays ?? 30)} days.`,
  );
  const outcome = await deps.callTool('create_invoice', args);
  if (outcome.status === 'deferred') {
    await streamText(
      deps,
      `I've parked this behind an approval — check the card above. Once you approve, I'll create it in PayPal as a DRAFT invoice (nothing is emailed yet; sending is a second, separate approval).`,
    );
  } else if (outcome.status === 'error') {
    await streamText(deps, `That didn't work: ${outcome.message}`);
  } else {
    await streamText(deps, outcome.result.summary);
  }
}

async function narrateSendInvoice(deps: AgentDeps, args: Record<string, unknown>): Promise<void> {
  const outcome = await deps.callTool('send_invoice', args);
  if (outcome.status === 'deferred') {
    await streamText(
      deps,
      `Ready to email that invoice. Approve the card above and PayPal sends it — the recipient gets a payment request immediately.`,
    );
  } else if (outcome.status === 'error') {
    await streamText(deps, `Couldn't send: ${outcome.message}`);
  } else {
    await streamText(deps, outcome.result.summary);
  }
}

async function narrateGreeting(deps: AgentDeps, ctx: ToolContext): Promise<void> {
  const txs = ctx.store.snapshot.transactions.length;
  await streamText(
    deps,
    `Ahoy — I'm First Mate, your PayPilot copilot. I'm watching ${txs} ledger transactions, your invoices, and any disputes.\n\n` +
      `Try: "what's happening with my money", "invoice Acme $420 for consulting, due in 14 days", "any disputes needing attention?", or "forecast next 30 days".`,
  );
}

/* --------------------------------- Entry ------------------------------------- */

export async function mockRespond(req: AgentRequest, deps: AgentDeps, ctx: ToolContext): Promise<void> {
  const intent = detectIntent(req.message, ctx);
  switch (intent.kind) {
    case 'create_invoice':
      await narrateCreateInvoice(deps, intent.args ?? {});
      return;
    case 'send_invoice':
      await narrateSendInvoice(deps, intent.args ?? {});
      return;
    case 'disputes': {
      const target = await narrateDisputes(deps, intent.disputeId);
      if (/\bdraft\b/i.test(req.message) && target) {
        await deps.callTool('draft_dispute_response', { dispute_id: target });
      }
      return;
    }
    case 'forecast':
      await narrateForecast(deps, await deps.callTool('forecast_cashflow', intent.args ?? { days: 30 }));
      return;
    case 'search':
      await narrateSearch(deps, intent.query ?? null);
      return;
    case 'explain':
      await narrateExplain(deps, intent.transactionId ?? '');
      return;
    case 'overview':
      await narrateOverview(deps);
      return;
    case 'greeting':
    default:
      await narrateGreeting(deps, ctx);
      return;
  }
}
