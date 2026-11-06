import { describe, expect, it } from 'vitest';
import type { CashflowDay } from '../src/shared/types.js';
import { weekdayOf } from '../src/shared/util.js';
import { buildDailySeries, forecastCashflow, forecastTotals } from '../src/server/insights/forecast.js';
import { makeTx, dateKeys } from './helpers.js';

function seriesFrom(dates: string[], value: (i: number) => { inflow: number; outflow: number }): CashflowDay[] {
  return dates.map((date, i) => {
    const { inflow, outflow } = value(i);
    return { date, inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 };
  });
}

describe('forecastCashflow — known inputs produce known outputs', () => {
  it('recovers an exact linear trend (slope 3/day) with zero-noise data', () => {
    const dates = dateKeys(60);
    const history = seriesFrom(dates, (i) => ({ inflow: 100 + 3 * i, outflow: 40 }));
    const f = forecastCashflow(history, 30);
    expect(Math.abs(f.slopePerDay - 3)).toBeLessThan(0.05);
    // Net at index i is (100 + 3i) - 40 = 60 + 3i. History ends at i=59 (net 237).
    // Next point (i=60) expected 240; horizon end (i=89) expected 327.
    expect(f.points[0].expected).toBeCloseTo(240, 0);
    expect(f.points[29].expected).toBeCloseTo(327, 0);
    // Zero residuals -> the 80% band collapses onto the forecast
    expect(f.bandHalfWidth).toBeLessThan(1);
    expect(f.points[0].low).toBeCloseTo(f.points[0].expected, 0);
    expect(f.points[0].high).toBeCloseTo(f.points[0].expected, 0);
  });

  it('band width tracks injected noise (80th percentile of |residuals|)', () => {
    const dates = dateKeys(60);
    const noise = (i: number) => (i % 3 === 0 ? 100 : -50); // deterministic noise, |.| in {50, 100}
    const history = seriesFrom(dates, (i) => ({ inflow: 200 + noise(i), outflow: 0 }));
    const f = forecastCashflow(history, 10);
    // 80th percentile of |noise| across 60 days: 40/60 are 100 -> q80 = 100
    expect(f.bandHalfWidth).toBeGreaterThan(60);
    expect(f.bandHalfWidth).toBeLessThan(140);
    expect(f.points.every((p) => p.high - p.low >= 2 * f.bandHalfWidth - 1)).toBe(true);
  });

  it('detects weekday seasonality multiplicatively', () => {
    const dates = dateKeys(70); // 10 full weeks
    const history = seriesFrom(dates, (i) => {
      const w = weekdayOf(dates[i]);
      const weekend = w === 0 || w === 6;
      return { inflow: (100 + i) * (weekend ? 0.5 : 1.25), outflow: 0 };
    });
    const f = forecastCashflow(history, 7);
    const normalizedMean =
      f.weekdayFactors.reduce((a, b) => a + b, 0) / 7;
    expect(normalizedMean).toBeCloseTo(1, 1); // factors are normalized to mean 1
    // Weekends run at ~half of weekdays after normalization
    expect(f.weekdayFactors[0]).toBeLessThan(0.75);
    expect(f.weekdayFactors[6]).toBeLessThan(0.75);
    expect(f.weekdayFactors[1]).toBeGreaterThan(1.05);
  });

  it('forecastTotals aggregates the horizon', () => {
    const dates = dateKeys(30);
    const history = seriesFrom(dates, () => ({ inflow: 500, outflow: 200 })); // flat net 300
    const f = forecastCashflow(history, 10);
    const totals = forecastTotals(f);
    expect(totals.expected).toBeCloseTo(3000, -1);
    expect(totals.low).toBeLessThanOrEqual(totals.expected);
    expect(totals.high).toBeGreaterThanOrEqual(totals.expected);
  });

  it('refuses to forecast on <14 days of history', () => {
    const dates = dateKeys(10);
    const history = seriesFrom(dates, () => ({ inflow: 100, outflow: 10 }));
    expect(() => forecastCashflow(history, 30)).toThrow(/at least 14 days/);
  });
});

describe('buildDailySeries', () => {
  it('aggregates inflow/outflow/net per UTC day and excludes unsettled transactions', () => {
    const now = new Date('2026-06-02T10:00:00Z');
    const txs = [
      makeTx({ amount: 100, direction: 'in', type: 'PAYMENT', status: 'COMPLETED', timestamp: '2026-06-01T09:00:00Z' }),
      makeTx({ amount: 40, direction: 'out', type: 'FEE', status: 'COMPLETED', timestamp: '2026-06-01T23:00:00Z' }),
      makeTx({ amount: 250, direction: 'in', type: 'PAYMENT', status: 'COMPLETED', timestamp: '2026-06-02T08:00:00Z' }),
      // VOIDED auth must be excluded entirely
      makeTx({ amount: 5, direction: 'in', type: 'AUTHORIZATION', status: 'VOIDED', method: 'card', timestamp: '2026-06-01T12:00:00Z' }),
    ];
    const series = buildDailySeries(txs, 3, now);
    expect(series).toHaveLength(3);
    const jun1 = series.find((d) => d.date === '2026-06-01');
    const jun2 = series.find((d) => d.date === '2026-06-02');
    expect(jun1).toMatchObject({ inflow: 100, outflow: 40, net: 60 });
    expect(jun2).toMatchObject({ inflow: 250, outflow: 0, net: 250 });
  });
});
