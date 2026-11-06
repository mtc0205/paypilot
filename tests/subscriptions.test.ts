import { describe, expect, it } from 'vitest';
import { detectSubscriptions, estimateMrr } from '../src/server/insights/subscriptions.js';
import { makeTx, dateKeys } from './helpers.js';

function monthly(n: number, amount: number, party = { name: 'Figma', email: 'billing@figma.example' }, startDay = 5) {
  const dates = dateKeys(n * 31, '2026-06-25');
  return dates
    .filter((d) => d.endsWith(`-${String(startDay).padStart(2, '0')}`))
    .slice(0, n)
    .map((d) =>
      makeTx({
        amount,
        direction: 'out',
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        method: 'card',
        timestamp: `${d}T09:00:00Z`,
        counterparty: party,
        description: 'SaaS subscription',
      }),
    );
}

describe('detectSubscriptions', () => {
  it('detects a stable monthly cadence with identical amounts', () => {
    const subs = detectSubscriptions(monthly(6, 45));
    expect(subs).toHaveLength(1);
    const s = subs[0];
    expect(s.amount).toBe(45);
    expect(s.cadenceDays).toBeGreaterThanOrEqual(29);
    expect(s.cadenceDays).toBeLessThanOrEqual(32);
    expect(s.occurrences).toBe(6);
    expect(s.direction).toBe('out');
    // next expected = last payment + ~30d
    const last = new Date(s.lastSeen).getTime();
    const next = new Date(s.nextExpected).getTime();
    expect((next - last) / 86_400_000).toBeGreaterThanOrEqual(28);
    expect((next - last) / 86_400_000).toBeLessThanOrEqual(33);
    expect(s.confidence).toBeGreaterThan(0.8);
  });

  it('detects weekly recurring revenue retainers', () => {
    const dates = dateKeys(120, '2026-06-29');
    const weekly = dates
      .filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)
      .map((d) =>
        makeTx({
          amount: 4800,
          direction: 'in',
          type: 'PAYMENT',
          status: 'COMPLETED',
          timestamp: `${d}T10:00:00Z`,
          counterparty: { name: 'Northwind Labs', email: 'ap@northwind.example' },
        }),
      );
    const subs = detectSubscriptions(weekly);
    const whale = subs.find((s) => s.counterparty === 'Northwind Labs');
    expect(whale).toBeDefined();
    expect(whale?.cadenceDays).toBeCloseTo(7, 0);
    expect(whale?.direction).toBe('in');
  });

  it('rejects irregular cadences and drifting amounts', () => {
    const irregularDates = ['2026-01-05', '2026-01-10', '2026-03-20', '2026-04-02', '2026-06-18'];
    const drifting = irregularDates.map((d, i) =>
      makeTx({
        amount: 45 + i * 40, // 45, 85, 125 ... amounts drift apart
        direction: 'out',
        type: 'SUBSCRIPTION',
        status: 'COMPLETED',
        method: 'card',
        timestamp: `${d}T09:00:00Z`,
      }),
    );
    expect(detectSubscriptions(drifting)).toHaveLength(0);
  });

  it('rejects one-off repeats below the occurrence threshold', () => {
    const two = monthly(2, 99);
    expect(detectSubscriptions(two)).toHaveLength(0);
  });

  it('estimateMrr normalizes cadence to 30 days for inbound recurring revenue', () => {
    const weekly = makeTx({
      amount: 700,
      direction: 'in',
      type: 'PAYMENT',
      status: 'COMPLETED',
      timestamp: '2026-06-01T10:00:00Z',
    });
    const mrr = estimateMrr([
      {
        id: 'sub:test:weekly',
        counterparty: 'Weekly Client',
        direction: 'in',
        amount: 700,
        cadenceDays: 7,
        occurrences: 10,
        firstSeen: '2026-01-01T00:00:00Z',
        lastSeen: '2026-06-01T00:00:00Z',
        nextExpected: '2026-06-08T00:00:00Z',
        confidence: 0.95,
        varianceDays: 0,
      },
    ]);
    expect(mrr).toBeCloseTo(3000, 0); // 700 * 30/7
    expect(weekly.amount).toBe(700); // sanity on helper
  });
});
