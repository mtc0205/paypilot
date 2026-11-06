import { describe, expect, it } from 'vitest';
import { detectAnomalies, robustZScores } from '../src/server/insights/anomaly.js';
import { makeTx, dateKeys } from './helpers.js';

const NOW = new Date('2026-06-30T12:00:00Z');

describe('robustZScores (MAD-based)', () => {
  it('flags a single outlier in a constant series via the meanAD fallback', () => {
    const z = robustZScores([10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
    expect(z.slice(0, 9).every((v) => v === 0)).toBe(true);
    // median=10, MAD=0 -> fallback: (100-10)/(1.2533 * meanAD=9) ≈ 7.98
    expect(z[9]).toBeGreaterThan(5);
    expect(z[9]).toBeLessThan(9);
  });

  it('uses MAD when it does not collapse', () => {
    const z = robustZScores([10, 12, 14, 16, 18, 100]);
    // median=15, MAD=3 -> z(100) = 0.6745 * 85 / 3 ≈ 19.1
    expect(z[5]).toBeGreaterThan(15);
    expect(z[5]).toBeLessThan(23);
    // z(10) = 0.6745 * (10-15) / 3 ≈ -1.12
    expect(z[0]).toBeCloseTo(-1.12, 1);
    expect(z[0]).toBeLessThan(0); // below median -> negative
  });

  it('returns [] for empty input and 0 for single value', () => {
    expect(robustZScores([])).toEqual([]);
    expect(robustZScores([42])).toEqual([0]);
  });
});

describe('detectAnomalies', () => {
  it('detects card-testing bursts (micro card auths, voided/denied)', () => {
    const auths = Array.from({ length: 12 }, (_, i) =>
      makeTx({
        amount: 1 + (i % 8),
        direction: 'in',
        type: 'AUTHORIZATION',
        status: i % 4 === 0 ? 'DENIED' : 'VOIDED',
        method: 'card',
        timestamp: `2026-06-26T0${i % 8}:30:00Z`,
        counterparty: { name: `Card Check ${i}`, email: `hex${i}@proton.me` },
        description: 'Card verification',
      }),
    );
    const alerts = detectAnomalies(auths, { now: NOW });
    const cardTesting = alerts.find((a) => a.kind === 'card_testing');
    expect(cardTesting).toBeDefined();
    expect(cardTesting?.severity).toBe('critical');
    expect(cardTesting?.evidence.count).toBe(12);
  });

  it('flags a large amount outlier against a tight baseline', () => {
    const baseline = Array.from({ length: 40 }, (_, i) =>
      makeTx({
        amount: 100 + i,
        direction: 'in',
        type: 'PAYMENT',
        status: 'COMPLETED',
        timestamp: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
      }),
    );
    const whale = makeTx({
      amount: 900,
      direction: 'in',
      type: 'PAYMENT',
      status: 'COMPLETED',
      timestamp: '2026-06-20T10:00:00Z',
      counterparty: { name: 'Rivet Hardware', email: 'ap@rivet.example' },
    });
    const alerts = detectAnomalies([...baseline, whale], { now: NOW });
    const outlier = alerts.find((a) => a.kind === 'amount_outlier');
    expect(outlier).toBeDefined();
    expect(Number(outlier?.evidence.amount)).toBe(900);
    expect(outlier?.transactionIds).toContain(whale.id);
  });

  it('does NOT flag recurring same-amount payments from the same customer', () => {
    const dates = dateKeys(120, '2026-06-29');
    const recurring = dates.filter((_, i) => i % 30 === 0).map((d) =>
      makeTx({
        amount: 4800,
        direction: 'in',
        type: 'PAYMENT',
        status: 'COMPLETED',
        timestamp: `${d}T10:00:00Z`,
        counterparty: { name: 'Northwind Labs', email: 'ap@northwind.example' },
        description: 'Weekly retainer',
      }),
    );
    const alerts = detectAnomalies(recurring, { now: NOW });
    expect(alerts.find((a) => a.kind === 'amount_outlier')).toBeUndefined();
  });

  it('detects refund-rate spikes vs the trailing baseline', () => {
    const txs = [
      // 60 days of sales at $1000/day with 2% refunds
      ...dateKeys(60, '2026-06-29').map((d) =>
        makeTx({ amount: 1000, direction: 'in', type: 'PAYMENT', status: 'COMPLETED', timestamp: `${d}T10:00:00Z` }),
      ),
      ...dateKeys(60, '2026-06-29')
        .filter((_, i) => i % 10 === 0)
        .map((d) => makeTx({ amount: 20, direction: 'out', type: 'REFUND', status: 'COMPLETED', timestamp: `${d}T11:00:00Z` })),
      // last 5 days: heavy refunds
      ...dateKeys(5, '2026-06-29').map((d) =>
        makeTx({ amount: 150, direction: 'out', type: 'REFUND', status: 'COMPLETED', timestamp: `${d}T12:00:00Z` }),
      ),
    ];
    const alerts = detectAnomalies(txs, { now: NOW });
    const spike = alerts.find((a) => a.kind === 'refund_spike');
    expect(spike).toBeDefined();
    expect(Number(spike?.evidence.last7Refunds)).toBeGreaterThanOrEqual(700);
  });
});
