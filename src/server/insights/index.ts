/**
 * Insight engine facade — combines anomaly detection, subscriptions, customer
 * concentration and dispute deadlines into the alert feed, and produces the
 * deterministic "explain this transaction" narrative used across the product.
 */
import type {
  CashflowDay,
  CustomerShare,
  Dispute,
  ForecastPoint,
  InsightAlert,
  Subscription,
  Transaction,
} from '../../shared/types.js';
import { dateKey, daysBetween, fmtMoney, mean, round2, sum } from '../../shared/util.js';
import { detectAnomalies, robustZScores } from './anomaly.js';
import { buildDailySeries, forecastCashflow, forecastTotals } from './forecast.js';
import { detectSubscriptions, estimateMrr } from './subscriptions.js';

export { detectAnomalies, robustZScores } from './anomaly.js';
export { buildDailySeries, forecastCashflow, forecastTotals } from './forecast.js';
export { detectSubscriptions, estimateMrr } from './subscriptions.js';
export { categorizeTransaction, CATEGORIES } from './categorize.js';
export { scoreRisk, riskBand } from './risk.js';

export interface InsightInput {
  transactions: Transaction[];
  disputes: Dispute[];
  now: Date;
}

function customerConcentration(transactions: Transaction[], now: Date): CustomerShare[] {
  const cutoff = now.getTime() - 90 * 86_400_000;
  const byCustomer = new Map<string, { name: string; revenue: number; count: number }>();
  let total = 0;
  for (const tx of transactions) {
    if (tx.direction !== 'in' || tx.type !== 'PAYMENT' || tx.status !== 'COMPLETED') continue;
    if (new Date(tx.timestamp).getTime() < cutoff) continue;
    const key = tx.counterparty.name.toLowerCase();
    const entry = byCustomer.get(key) ?? { name: tx.counterparty.name, revenue: 0, count: 0 };
    entry.revenue += tx.amount;
    entry.count += 1;
    byCustomer.set(key, entry);
    total += tx.amount;
  }
  return [...byCustomer.values()]
    .map((c) => ({ name: c.name, revenue90d: round2(c.revenue), share: total > 0 ? round2((c.revenue / total) * 100) : 0, txCount: c.count }))
    .sort((a, b) => b.revenue90d - a.revenue90d);
}

function concentrationAlerts(shares: CustomerShare[], now: Date): InsightAlert[] {
  const top = shares[0];
  if (!top || top.revenue90d < 5000 || top.share < 8) return [];
  return [
    {
      id: `customer_concentration:${top.name.toLowerCase().replace(/\s+/g, '-')}`,
      kind: 'customer_concentration',
      severity: top.share >= 12 ? 'warning' : 'info',
      title: `Revenue concentration: ${top.name} is ${top.share.toFixed(0)}% of your last 90 days`,
      detail:
        `${top.name} paid ${fmtMoney(top.revenue90d)} across ${top.txCount} payments in 90 days — ${top.share.toFixed(0)}% of ` +
        `total inflow. Losing this customer would remove roughly ${fmtMoney(top.revenue90d / 3)} of monthly revenue. ` +
        `Consider diversifying or negotiating a longer-term agreement.`,
      evidence: { customer: top.name, revenue90d: top.revenue90d, sharePct: top.share, txCount: top.txCount },
      detectedAt: now.toISOString(),
    },
  ];
}

function disputeDeadlineAlerts(disputes: Dispute[], now: Date): InsightAlert[] {
  const alerts: InsightAlert[] = [];
  for (const d of disputes) {
    if (d.status === 'RESOLVED_SELLER' || d.status === 'RESOLVED_BUYER' || d.status === 'CANCELLED') continue;
    const daysLeft = daysBetween(now, new Date(d.respondBy));
    if (daysLeft > 14) continue;
    alerts.push({
      id: `dispute_deadline:${d.id}`,
      kind: 'dispute_deadline',
      severity: daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'critical' : 'info',
      title: `Dispute ${d.id}: respond within ${daysLeft <= 0 ? 'HOURS' : `${daysLeft} day(s)`}`,
      detail:
        `${d.buyer.name} disputed ${fmtMoney(d.amount)} (${d.reason.replace(/_/g, ' ').toLowerCase()}). ` +
        `PayPal closes the response window ${daysLeft <= 0 ? 'today' : `in ${daysLeft} day(s)`} — ` +
        `no response means losing by default. Evidence collected: ${d.evidence.filter((e) => e.done).length}/${d.evidence.length}.`,
      evidence: {
        disputeId: d.id,
        amount: d.amount,
        daysLeft,
        reason: d.reason,
        evidenceDone: d.evidence.filter((e) => e.done).length,
      },
      detectedAt: now.toISOString(),
    });
  }
  return alerts;
}

function missedSubscriptionAlerts(subscriptions: Subscription[], now: Date): InsightAlert[] {
  const alerts: InsightAlert[] = [];
  for (const sub of subscriptions) {
    const expected = new Date(sub.nextExpected).getTime();
    const lateBy = (now.getTime() - expected) / 86_400_000;
    if (lateBy < 5 || sub.direction !== 'in') continue;
    alerts.push({
      id: `subscription_missed:${sub.id}`,
      kind: 'subscription_missed',
      severity: lateBy > sub.cadenceDays ? 'warning' : 'info',
      title: `Expected payment from ${sub.counterparty} is ${Math.floor(lateBy)} days late`,
      detail:
        `${sub.counterparty} reliably pays ${fmtMoney(sub.amount)} every ${Math.round(sub.cadenceDays)} days ` +
        `(${sub.occurrences} payments tracked). The next one was expected ${dateKey(new Date(sub.nextExpected))}. ` +
        `Worth a friendly nudge — or check whether they cancelled.`,
      evidence: { counterparty: sub.counterparty, amount: sub.amount, cadenceDays: sub.cadenceDays, daysLate: Math.floor(lateBy) },
      detectedAt: now.toISOString(),
    });
  }
  return alerts;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/** Full alert feed for the dashboard / agent. */
export function runInsights(input: InsightInput): InsightAlert[] {
  const { transactions, disputes, now } = input;
  const anomalies = detectAnomalies(transactions, { now });
  const shares = customerConcentration(transactions, now);
  const subs = detectSubscriptions(transactions);
  const alerts = [
    ...anomalies,
    ...concentrationAlerts(shares, now),
    ...disputeDeadlineAlerts(disputes, now),
    ...missedSubscriptionAlerts(subs, now),
  ];
  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export { customerConcentration };

/* ----------------------------- Cash-flow summary ----------------------------- */

export interface CashflowSummary {
  days: number;
  net: number;
  inflow: number;
  outflow: number;
  deltaPct: number;
  avgDaily: number;
  bestDay: { date: string; net: number };
  worstDay: { date: string; net: number };
  weekdayAverages: { weekday: string; avgNet: number }[];
  mrr: number;
  subscriptions: Subscription[];
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildCashflowSummary(transactions: Transaction[], days: number, now: Date): CashflowSummary {
  const series: CashflowDay[] = buildDailySeries(transactions, days * 2, now);
  const current = series.slice(-days);
  const prior = series.slice(-days * 2, -days);
  const net = round2(sum(current.map((d) => d.net)));
  const inflow = round2(sum(current.map((d) => d.inflow)));
  const outflow = round2(sum(current.map((d) => d.outflow)));
  const priorNet = round2(sum(prior.map((d) => d.net)));
  const deltaPct = priorNet !== 0 ? round2(((net - priorNet) / Math.abs(priorNet)) * 100) : 0;
  const best = [...current].sort((a, b) => b.net - a.net)[0] ?? { date: '', net: 0 };
  const worst = [...current].sort((a, b) => a.net - b.net)[0] ?? { date: '', net: 0 };
  const subs = detectSubscriptions(transactions);
  const weekdayBuckets: number[][] = Array.from({ length: 7 }, () => []);
  for (const d of current) weekdayBuckets[new Date(`${d.date}T00:00:00Z`).getUTCDay()].push(d.net);
  return {
    days,
    net,
    inflow,
    outflow,
    deltaPct,
    avgDaily: round2(net / Math.max(current.length, 1)),
    bestDay: { date: best.date, net: best.net },
    worstDay: { date: worst.date, net: worst.net },
    weekdayAverages: weekdayBuckets.map((nets, i) => ({ weekday: WEEKDAY_NAMES[i], avgNet: round2(mean(nets)) })),
    mrr: estimateMrr(subs),
    subscriptions: subs,
  };
}

/* ------------------------------- Explain-transaction ------------------------- */

export interface TransactionExplanation {
  summary: string;
  bullets: string[];
}

export function explainTransaction(tx: Transaction, all: Transaction[], now: Date): TransactionExplanation {
  const peers = all.filter(
    (t) => t.direction === tx.direction && t.type === tx.type && t.status === 'COMPLETED' && t.id !== tx.id,
  );
  const zs = robustZScores([...peers.map((p) => p.amount), tx.amount]);
  const z = zs[zs.length - 1] ?? 0;
  const peerMedian = peers.length ? [...peers.map((p) => p.amount)].sort((a, b) => a - b)[Math.floor(peers.length / 2)] : tx.amount;
  const sameBuyer = all.filter((t) => t.counterparty.email === tx.counterparty.email && t.id !== tx.id).length;
  const hour = new Date(tx.timestamp).getUTCHours();
  const bullets: string[] = [
    `${tx.type} of ${fmtMoney(tx.amount)} ${tx.direction === 'in' ? 'from' : 'to'} ${tx.counterparty.name} (${tx.counterparty.email}), ${tx.method.toUpperCase()} · category "${tx.category}".`,
    `Amount vs. similar transactions: robust z = ${z.toFixed(1)} (typical ${tx.direction === 'in' ? 'sale' : 'payment'} ≈ ${fmtMoney(peerMedian)}). ${Math.abs(z) < 2 ? 'This is within your normal range.' : z > 0 ? 'Larger than usual for this type.' : 'Smaller than usual for this type.'}`,
    `History with this counterparty: ${sameBuyer} other transaction(s) on record.`,
    `Time of day: ${String(hour).padStart(2, '0')}:00 UTC — ${hour >= 8 && hour <= 21 ? 'within your normal business window' : 'outside your normal business window (worth a second look)'}.`,
  ];
  if (tx.risk.flags.length) {
    bullets.push(`Risk ${tx.risk.score}/100 — signals: ${tx.risk.flags.join(', ')}.`);
  } else {
    bullets.push('Risk 0/100 — no fraud or dispute signals on this transaction.');
  }
  if (tx.disputeId) bullets.push(`Linked to dispute ${tx.disputeId}.`);
  if (tx.invoiceId) bullets.push(`Settled against invoice ${tx.invoiceId}.`);

  const daysAgo = daysBetween(new Date(tx.timestamp), now);
  const summary =
    `${tx.type} of ${fmtMoney(tx.amount)} ${tx.direction === 'in' ? 'received from' : 'paid to'} ${tx.counterparty.name} ` +
    `${daysAgo === 0 ? 'today' : `${daysAgo} day(s) ago`}. ${tx.status === 'COMPLETED' ? 'Settled.' : `Status: ${tx.status}.`} ` +
    (Math.abs(z) >= 4.5 ? 'The amount is a statistical outlier vs your history.' : 'Nothing statistically unusual about it.');
  return { summary, bullets };
}

/* ------------------------------ Forecast summary ----------------------------- */

export interface ForecastSummary {
  horizonDays: number;
  expectedTotal: number;
  lowTotal: number;
  highTotal: number;
  slopePerDay: number;
  bandHalfWidth: number;
  weekdayFactors: number[];
  points: ForecastPoint[];
}

export function buildForecastSummary(transactions: Transaction[], horizonDays: number, now: Date): ForecastSummary {
  const history = buildDailySeries(transactions, 120, now);
  const forecast = forecastCashflow(history, horizonDays);
  const totals = forecastTotals(forecast);
  return {
    horizonDays,
    expectedTotal: totals.expected,
    lowTotal: totals.low,
    highTotal: totals.high,
    slopePerDay: forecast.slopePerDay,
    bandHalfWidth: forecast.bandHalfWidth,
    weekdayFactors: forecast.weekdayFactors,
    points: forecast.points,
  };
}
