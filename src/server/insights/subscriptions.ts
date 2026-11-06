/**
 * Recurring-payment (subscription) detection.
 *
 * Groups transactions by counterparty + amount cluster, then accepts a group as a
 * subscription when ≥ `minOccurrences` payments share a stable amount (±tolerance)
 * and arrive on a regular cadence (every interval within ±40% of the median cadence).
 */
import type { Subscription, Transaction, TxDirection } from '../../shared/types.js';
import { clamp, median, normalizeName, round2 } from '../../shared/util.js';

export interface SubscriptionOptions {
  minOccurrences?: number;
  /** Relative amount tolerance within a cluster (0.03 = ±3%) */
  amountTolerance?: number;
  /** Minimum days between payments for something to count as a cadence */
  minCadenceDays?: number;
  /** Maximum cadence length (days) — subscriptions bill at least every ~2 months */
  maxCadenceDays?: number;
}

interface Cluster {
  txs: Transaction[];
  amount: number;
}

function clusterByAmount(txs: Transaction[], tolerance: number): Cluster[] {
  const sorted = [...txs].sort((a, b) => a.amount - b.amount);
  const clusters: Cluster[] = [];
  for (const tx of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(tx.amount - last.amount) <= tolerance * last.amount) {
      last.txs.push(tx);
      last.amount = median(last.txs.map((t) => t.amount));
    } else {
      clusters.push({ txs: [tx], amount: tx.amount });
    }
  }
  return clusters.filter((c) => c.txs.length > 0);
}

function dayDiff(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function addDaysISO(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function detectSubscriptions(transactions: Transaction[], options?: SubscriptionOptions): Subscription[] {
  const minOccurrences = options?.minOccurrences ?? 4;
  const amountTolerance = options?.amountTolerance ?? 0.03;
  const minCadenceDays = options?.minCadenceDays ?? 6;
  const maxCadenceDays = options?.maxCadenceDays ?? 60;

  const groups = new Map<string, { direction: TxDirection; counterparty: string; txs: Transaction[] }>();
  for (const tx of transactions) {
    if (tx.status === 'VOIDED' || tx.status === 'DENIED' || tx.status === 'REVERSED') continue;
    if (tx.type === 'FEE' || tx.type === 'PAYOUT' || tx.type === 'AUTHORIZATION') continue;
    const key = `${tx.direction}|${normalizeName(tx.counterparty.name)}`;
    const g = groups.get(key) ?? { direction: tx.direction, counterparty: tx.counterparty.name, txs: [] };
    g.txs.push(tx);
    groups.set(key, g);
  }

  const results: Subscription[] = [];
  for (const group of groups.values()) {
    const clusters = clusterByAmount(group.txs, amountTolerance);
    for (const cluster of clusters) {
      const txs = [...cluster.txs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (txs.length < minOccurrences) continue;
      const intervals: number[] = [];
      for (let i = 1; i < txs.length; i++) intervals.push(dayDiff(txs[i - 1].timestamp, txs[i].timestamp));
      const cadence = median(intervals);
      if (cadence < minCadenceDays || cadence > maxCadenceDays) continue;
      const regular = intervals.every((iv) => iv >= cadence * 0.8 && iv <= cadence * 1.35);
      if (!regular) continue;

      const spread = Math.max(...intervals) - Math.min(...intervals);
      const amountStable =
        Math.max(...txs.map((t) => t.amount)) - Math.min(...txs.map((t) => t.amount)) <= 0.01 + 0.01 * cluster.amount;
      const confidence = clamp(
        0.55 + 0.08 * Math.min(txs.length - minOccurrences, 4) + (spread <= 2 ? 0.15 : 0.05) + (amountStable ? 0.1 : 0),
        0,
        0.99,
      );
      const last = txs[txs.length - 1];
      results.push({
        id: `sub:${group.direction}:${normalizeName(group.counterparty).replace(/\s+/g, '-')}:${Math.round(cluster.amount)}`,
        counterparty: group.counterparty,
        direction: group.direction,
        amount: round2(cluster.amount),
        cadenceDays: Math.round(cadence * 10) / 10,
        occurrences: txs.length,
        firstSeen: txs[0].timestamp,
        lastSeen: last.timestamp,
        nextExpected: addDaysISO(last.timestamp, cadence),
        confidence: Math.round(confidence * 100) / 100,
        varianceDays: Math.round(spread * 10) / 10,
      });
    }
  }
  return results.sort((a, b) => b.amount - a.amount);
}

/** Monthly-recurring-revenue estimate from inbound subscriptions (normalizes cadence to 30 days). */
export function estimateMrr(subscriptions: Subscription[]): number {
  return round2(
    subscriptions
      .filter((s) => s.direction === 'in')
      .reduce((acc, s) => acc + s.amount * (30 / Math.max(s.cadenceDays, 1)), 0),
  );
}
