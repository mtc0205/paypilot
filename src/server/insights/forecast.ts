/**
 * Cash-flow forecasting.
 *
 * Inflow and outflow are modeled SEPARATELY (both are positive series, so
 * multiplicative weekday seasonality behaves), each as ridge-stabilised linear
 * trend × weekday factor. Net forecast = inflow_hat − outflow_hat, with an 80%
 * empirical band from net residuals. Pure math, fully unit-tested.
 */
import type { CashflowDay, ForecastPoint, Transaction } from '../../shared/types.js';
import { addDays, dateKey, daysBetween, mean, quantile, round2, startOfUtcDay, weekdayOf } from '../../shared/util.js';

export interface CashflowForecast {
  points: ForecastPoint[];
  slopePerDay: number;
  /** Weekday factors of the INFLOW series, normalized to mean 1 (0=Sunday). */
  weekdayFactors: number[];
  bandHalfWidth: number;
  confidenceLevel: number;
}

interface SeasonalFit {
  slope: number;
  intercept: number;
  factors: number[];
  fitted(idx: number, dateStr: string): number;
}

function fitSeasonal(values: number[], dates: string[]): SeasonalFit {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const ols = (vals: number[]): { slope: number; intercept: number } => {
    const xm = mean(xs);
    const ym = mean(vals);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - xm) ** 2;
      sxy += (xs[i] - xm) * (vals[i] - ym);
    }
    const lambda = 1e-6 * Math.max(1, sxx); // ridge term — negligible bias, avoids degenerate slope
    const slope = sxy / (sxx + lambda);
    return { slope, intercept: ym - slope * xm };
  };

  // Pass 1: rough trend -> weekday factors from value/trend on active days.
  const p1 = ols(values);
  const trend1 = (i: number): number => Math.max(p1.intercept + p1.slope * i, 1);
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  for (let i = 0; i < n; i++) {
    if (values[i] <= 0) continue;
    const w = weekdayOf(dates[i]);
    sums[w] += values[i] / trend1(i);
    counts[w] += 1;
  }
  const active = counts.filter((c) => c > 0).length || 1;
  const rawMean = sums.reduce((acc, s, w) => acc + (counts[w] > 0 ? s / counts[w] : 0), 0) / active;
  const factors = sums.map((s, w) => {
    if (counts[w] === 0) return 1;
    const f = s / counts[w] / (rawMean || 1);
    return Number.isFinite(f) && f > 0.2 && f < 5 ? f : 1;
  });

  // Pass 2: re-fit the trend on the deseasonalized positive series.
  const deseason = values.map((v, i) => (v > 0 ? v / factors[weekdayOf(dates[i])] : v));
  const p2 = ols(deseason);
  const fitted = (idx: number, dateStr: string): number => Math.max((p2.intercept + p2.slope * idx) * factors[weekdayOf(dateStr)], 0);

  return { slope: p2.slope, intercept: p2.intercept, factors, fitted };
}

/**
 * Build a daily UTC cash-flow series over the last `days` days ending today (inclusive).
 * VOIDED/DENIED/REVERSED transactions are excluded (they never settled).
 */
export function buildDailySeries(transactions: Transaction[], days: number, now: Date): CashflowDay[] {
  const end = startOfUtcDay(now);
  const start = addDays(end, -(days - 1));
  const byDate = new Map<string, CashflowDay>();
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    byDate.set(dateKey(d), { date: dateKey(d), inflow: 0, outflow: 0, net: 0 });
  }
  for (const tx of transactions) {
    if (tx.status === 'VOIDED' || tx.status === 'DENIED' || tx.status === 'REVERSED') continue;
    const key = dateKey(new Date(tx.timestamp));
    const day = byDate.get(key);
    if (!day) continue;
    if (tx.direction === 'in') {
      day.inflow += tx.amount;
      day.net += tx.amount;
    } else {
      day.outflow += tx.amount;
      day.net -= tx.amount;
    }
  }
  return [...byDate.values()].map((d) => ({
    ...d,
    inflow: round2(d.inflow),
    outflow: round2(d.outflow),
    net: round2(d.net),
  }));
}

/** Forecast the next `horizon` days of NET cash flow (needs ≥ 14 days of history). */
export function forecastCashflow(history: CashflowDay[], horizon = 30): CashflowForecast {
  const n = history.length;
  if (n < 14) {
    throw new Error(`forecastCashflow needs at least 14 days of history, got ${n}`);
  }
  const dates = history.map((d) => d.date);
  const fitIn = fitSeasonal(history.map((d) => d.inflow), dates);
  const fitOut = fitSeasonal(history.map((d) => d.outflow), dates);

  const netResiduals = history.map((d, i) => d.net - (fitIn.fitted(i, d.date) - fitOut.fitted(i, d.date)));
  const bandHalfWidth = quantile(netResiduals.map((r) => Math.abs(r)), 0.8);

  const lastDate = new Date(`${history[n - 1].date}T00:00:00Z`);
  const points: ForecastPoint[] = [];
  for (let j = 1; j <= horizon; j++) {
    const d = addDays(lastDate, j);
    const idx = n - 1 + j;
    const dk = dateKey(d);
    const expected = round2(fitIn.fitted(idx, dk) - fitOut.fitted(idx, dk));
    points.push({ date: dk, expected, low: round2(expected - bandHalfWidth), high: round2(expected + bandHalfWidth) });
  }
  return {
    points,
    slopePerDay: round2(fitIn.slope - fitOut.slope),
    weekdayFactors: fitIn.factors.map((f) => Math.round(f * 1000) / 1000),
    bandHalfWidth: round2(bandHalfWidth),
    confidenceLevel: 0.8,
  };
}

/** Total forecast over the horizon with aggregated band. Useful for KPI cards and agent summaries. */
export function forecastTotals(forecast: CashflowForecast): { expected: number; low: number; high: number } {
  const expected = round2(forecast.points.reduce((a, p) => a + p.expected, 0));
  const low = round2(forecast.points.reduce((a, p) => a + p.low, 0));
  const high = round2(forecast.points.reduce((a, p) => a + p.high, 0));
  return { expected, low, high };
}

/** Days from `now` until the last day of the forecast horizon (for labeling). */
export function horizonEndsIn(forecast: CashflowForecast, now: Date): number {
  const last = forecast.points[forecast.points.length - 1];
  if (!last) return 0;
  return daysBetween(now, new Date(`${last.date}T00:00:00Z`));
}
