import { describe, expect, it } from 'vitest';
import { scoreRisk, riskBand } from '../src/server/insights/risk.js';
import { makeTx } from './helpers.js';

const clean = () => makeTx({ amount: 200, direction: 'in', type: 'PAYMENT', status: 'COMPLETED', method: 'paypal' });
const cardTestAuth = () =>
  makeTx({
    amount: 1.5,
    direction: 'in',
    type: 'AUTHORIZATION',
    status: 'VOIDED',
    method: 'card',
    counterparty: { name: 'Card Check A1', email: 'abc123@proton.me' },
  });

describe('scoreRisk', () => {
  it('scores a clean completed PayPal payment at 0 with no flags', () => {
    const r = scoreRisk(clean());
    expect(r.score).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it('scores card-testing micro-auths high with explanatory flags', () => {
    const r = scoreRisk(cardTestAuth(), { buyerRecentDeniedAuths: 5 });
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.flags).toContain('declined_card_auth');
    expect(r.flags).toContain('micro_card_auth');
    expect(r.flags).toContain('tiny_amount');
    expect(r.flags).toContain('buyer_failed_auth_burst');
  });

  it('chargeback-linked transactions are always high risk', () => {
    const r = scoreRisk(makeTx({ amount: 620, direction: 'out', type: 'CHARGEBACK', status: 'COMPLETED', method: 'paypal' }));
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.flags).toContain('chargeback_linked');
  });

  it('buyer dispute history and velocity add bounded points', () => {
    const r = scoreRisk(clean(), { buyerDisputeCount: 5, sameBuyerLastHourCount: 9, amountZ: 7 });
    // 20*5 capped at 30 + velocity 20 + outlier 15 = 65
    expect(r.score).toBe(65);
  });

  it('is bounded to [0, 100] across adversarial inputs', () => {
    for (let i = 0; i < 200; i++) {
      const r = scoreRisk(
        {
          type: i % 3 === 0 ? 'CHARGEBACK' : i % 3 === 1 ? 'AUTHORIZATION' : 'PAYMENT',
          status: i % 2 === 0 ? 'DENIED' : 'COMPLETED',
          method: i % 4 === 0 ? 'card' : 'paypal',
          amount: (i % 7) * 0.5,
          counterparty: { name: 'x', email: i % 5 === 0 ? 'a@tempmail.io' : 'a@ok.example' },
        },
        { buyerDisputeCount: 99, buyerRecentDeniedAuths: 99, sameBuyerLastHourCount: 99, amountZ: 99 },
      );
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('riskBand thresholds match the badge UI bands', () => {
    expect(riskBand(0)).toBe('low');
    expect(riskBand(24)).toBe('low');
    expect(riskBand(25)).toBe('medium');
    expect(riskBand(54)).toBe('medium');
    expect(riskBand(55)).toBe('high');
    expect(riskBand(100)).toBe('high');
  });
});
