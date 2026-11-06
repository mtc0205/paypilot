/**
 * Robust anomaly detection.
 *
 * Uses MAD-based (median absolute deviation) z-scores instead of mean/std so a
 * single whale transaction cannot inflate the baseline and mask smaller fraud.
 * All functions are pure and unit-tested.
 */
import type { InsightAlert, Transaction } from '../../shared/types.js';
import { dateKey, mean, median, round2, sum } from '../../shared/util.js';

const MAD_TO_SIGMA = 0.6745; // 1 sigma of normal distribution ≈ 0.6745 * MAD
const MEANAD_TO_SIGMA = 1.2533;

/**
 * Robust z-scores (modified z-scores) for a sample.
 * - MAD-based when MAD > 0
 * - Mean-absolute-deviation fallback when MAD collapses to 0
 * - ±99 sentinel when the sample is (nearly) constant
 */
export function robustZScores(xs: number[]): number[] {
  if (xs.length === 0) return [];
  const med = median(xs);
  const devs = xs.map((x) => Math.abs(x - med));
  const mad = median(devs);
  if (mad > 1e-9) return xs.map((x) => (MAD_TO_SIGMA * (x - med)) / mad);
  const meanAd = mean(devs);
  if (meanAd > 1e-9) return xs.map((x) => (x - med) / (MEANAD_TO_SIGMA * meanAd));
  return xs.map((x) => (x === med ? 0 : x > med ? 99 : -99));
}

export interface AnomalyOptions {
  /** Window (days back from `now`) in which anomalies are reported. Default 30. */
  recentDays?: number;
  /** Baseline length in days. Default 120. */
  baselineDays?: number;
  amountZThreshold?: number;
  velocityZThreshold?: number;
  now?: Date;
}

interface TxWithZ {
  tx: Transaction;
  z: number;
}

function amountOutliers(txs: Transaction[], opts: Required<AnomalyOptions>): InsightAlert[] {
  const alerts: InsightAlert[] = [];
  // Recurring (counterparty, amount) pairs are subscriptions/retainers, not anomalies.
  const recurrenceCount = new Map<string, number>();
  for (const t of txs) {
    if (t.status !== 'COMPLETED') continue;
    const key = `${t.counterparty.email}|${t.amount.toFixed(2)}`;
    recurrenceCount.set(key, (recurrenceCount.get(key) ?? 0) + 1);
  }
  for (const direction of ['in', 'out'] as const) {
    const eligible = txs.filter(
      (t) =>
        t.direction === direction &&
        t.status !== 'VOIDED' &&
        t.status !== 'DENIED' &&
        t.status !== 'REVERSED' &&
        t.type !== 'AUTHORIZATION' &&
        // Payouts are scheduled aggregates — "large" is their job description.
        t.type !== 'PAYOUT' &&
        (recurrenceCount.get(`${t.counterparty.email}|${t.amount.toFixed(2)}`) ?? 0) < 3,
    );
    const zs = robustZScores(eligible.map((t) => t.amount));
    const withZ: TxWithZ[] = eligible.map((tx, i) => ({ tx, z: zs[i] ?? 0 }));
    const cutoff = opts.now.getTime() - opts.recentDays * 86_400_000;
    const minValue = direction === 'in' ? 500 : 200;
    for (const { tx, z } of withZ) {
      if (z >= opts.amountZThreshold && tx.amount >= minValue && new Date(tx.timestamp).getTime() >= cutoff) {
        const magnitude = z >= 8 ? 'critical' : 'warning';
        alerts.push({
          id: `amount_outlier:${tx.id}`,
          kind: 'amount_outlier',
          severity: magnitude,
          title: `Unusually large ${direction === 'in' ? 'payment' : 'outflow'}: $${tx.amount.toFixed(2)}`,
          detail:
            `${tx.counterparty.name} · ${tx.description}. This amount scores a robust z of ${z.toFixed(1)} ` +
            `against your ${direction === 'in' ? 'sales' : 'spend'} baseline (median-based), which makes it a statistical outlier.`,
          evidence: {
            transactionId: tx.id,
            amount: tx.amount,
            z: round2(z),
            direction,
            counterparty: tx.counterparty.name,
          },
          detectedAt: opts.now.toISOString(),
          transactionIds: [tx.id],
        });
      }
    }
  }
  return alerts;
}

/** Counts of settled transactions per wall-clock hour, last `windowDays`. Failed card auths are card-testing's job. */
function hourlyCounts(txs: Transaction[], windowDays: number, now: Date): Map<string, { count: number; txs: Transaction[] }> {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const buckets = new Map<string, { count: number; txs: Transaction[] }>();
  for (const tx of txs) {
    if (tx.type === 'AUTHORIZATION' && (tx.status === 'VOIDED' || tx.status === 'DENIED')) continue;
    const ts = new Date(tx.timestamp).getTime();
    if (ts < cutoff) continue;
    const hour = dateKey(new Date(ts)) + 'T' + String(new Date(ts).getUTCHours()).padStart(2, '0');
    const b = buckets.get(hour) ?? { count: 0, txs: [] };
    b.count += 1;
    b.txs.push(tx);
    buckets.set(hour, b);
  }
  return buckets;
}

function velocityBursts(txs: Transaction[], opts: Required<AnomalyOptions>): InsightAlert[] {
  const recent = hourlyCounts(txs, 7, opts.now);
  const baseline = [...hourlyCounts(txs, opts.baselineDays, opts.now).values()].map((b) => b.count);
  if (baseline.length < 24) return [];
  const zs = robustZScores(baseline);
  const zByCount = new Map<number, number>();
  baseline.forEach((c, i) => zByCount.set(c, zs[i] ?? 0));

  const alerts: InsightAlert[] = [];
  const sorted = [...recent.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [hour, bucket] of sorted.slice(0, 3)) {
    const z = zByCount.get(bucket.count) ?? robustZScores([...baseline, bucket.count]).slice(-1)[0] ?? 0;
    if (bucket.count >= 6 && z >= opts.velocityZThreshold) {
      const parties = [...new Set(bucket.txs.map((t) => t.counterparty.name))].slice(0, 3);
      alerts.push({
        id: `velocity_burst:${hour}`,
        kind: 'velocity_burst',
        severity: 'critical',
        title: `Transaction velocity spike — ${bucket.count} transactions in one hour`,
        detail:
          `Hour ${hour.replace('T', ' ')}:00 UTC logged ${bucket.count} transactions (robust z ${z.toFixed(1)} vs your hourly baseline). ` +
          `Bursts like this often indicate card-testing or a runaway integration. Sample counterparties: ${parties.join(', ')}.`,
        evidence: { hour, count: bucket.count, z: round2(z), sampleParties: parties.join(', ') },
        detectedAt: opts.now.toISOString(),
        transactionIds: bucket.txs.slice(0, 8).map((t) => t.id),
      });
    }
  }
  return alerts;
}

function cardTesting(txs: Transaction[], now: Date): InsightAlert[] {
  const cutoff = now.getTime() - 7 * 86_400_000;
  const hits = txs.filter(
    (t) =>
      t.type === 'AUTHORIZATION' &&
      t.method === 'card' &&
      t.amount <= 10 &&
      (t.status === 'VOIDED' || t.status === 'DENIED') &&
      new Date(t.timestamp).getTime() >= cutoff,
  );
  if (hits.length < 10) return [];
  const total = sum(hits.map((t) => t.amount));
  const days = [...new Set(hits.map((t) => dateKey(new Date(t.timestamp))))].sort();
  return [
    {
      id: `card_testing:${days[0] ?? 'recent'}`,
      kind: 'card_testing',
      severity: 'critical',
      title: `Card-testing attack pattern — ${hits.length} micro authorizations`,
      detail:
        `${hits.length} card authorizations of $1–$10 were ${hits[0]?.status === 'VOIDED' ? 'voided' : 'declined'} over ` +
        `${days.length} day(s) (${days[0]} → ${days[days.length - 1]}), totaling $${total.toFixed(2)}. ` +
        `This is the classic fingerprint of stolen-card validation before a larger charge. Consider enabling PayPal's ` +
        `fraud filters and reviewing recent large captures from new buyers.`,
      evidence: { count: hits.length, totalAmount: round2(total), distinctDays: days.length, firstDay: days[0] ?? '' },
      detectedAt: now.toISOString(),
      transactionIds: hits.slice(0, 10).map((t) => t.id),
    },
  ];
}

function refundSpike(txs: Transaction[], now: Date): InsightAlert[] {
  const window = (fromDaysAgo: number, toDaysAgo: number) => {
    const lo = now.getTime() - fromDaysAgo * 86_400_000;
    const hi = now.getTime() - toDaysAgo * 86_400_000;
    const inRange = txs.filter((t) => {
      const ts = new Date(t.timestamp).getTime();
      return ts >= lo && ts < hi && t.status === 'COMPLETED';
    });
    const refunds = sum(inRange.filter((t) => t.type === 'REFUND').map((t) => t.amount));
    const inflow = sum(inRange.filter((t) => t.direction === 'in' && t.type === 'PAYMENT').map((t) => t.amount));
    return { refunds, inflow, ratio: inflow > 0 ? refunds / inflow : 0 };
  };
  const last7 = window(7, 0);
  const prior90 = window(97, 7);
  if (last7.refunds < 300 || prior90.ratio <= 0.0001) return [];
  const multiple = last7.ratio / prior90.ratio;
  if (multiple < 2.5) return [];
  return [
    {
      id: `refund_spike:${dateKey(now)}`,
      kind: 'refund_spike',
      severity: multiple >= 4 ? 'critical' : 'warning',
      title: `Refund rate spiked ${multiple.toFixed(1)}x above your 90-day norm`,
      detail:
        `The last 7 days saw $${last7.refunds.toFixed(2)} refunded (${(last7.ratio * 100).toFixed(1)}% of sales) versus a ` +
        `90-day norm of ${(prior90.ratio * 100).toFixed(1)}%. If this continues it will start eating into your forecast net; ` +
        `check whether the refunds cluster around one product or buyer.`,
      evidence: {
        last7Refunds: round2(last7.refunds),
        last7Ratio: round2(last7.ratio * 100),
        baselineRatio: round2(prior90.ratio * 100),
        multiple: round2(multiple),
      },
      detectedAt: now.toISOString(),
    },
  ];
}

/** Detect anomalies in a transaction ledger. Pure; sorted alerts by severity are the caller's job. */
export function detectAnomalies(transactions: Transaction[], options?: AnomalyOptions): InsightAlert[] {
  const opts: Required<AnomalyOptions> = {
    recentDays: options?.recentDays ?? 30,
    baselineDays: options?.baselineDays ?? 120,
    amountZThreshold: options?.amountZThreshold ?? 10,
    velocityZThreshold: options?.velocityZThreshold ?? 5,
    now: options?.now ?? new Date(),
  };
  const cutoff = opts.now.getTime() - opts.baselineDays * 86_400_000;
  const baseline = transactions.filter((t) => new Date(t.timestamp).getTime() >= cutoff);
  return [
    ...cardTesting(baseline, opts.now),
    ...amountOutliers(baseline, opts),
    ...velocityBursts(baseline, opts),
    ...refundSpike(baseline, opts.now),
  ];
}
