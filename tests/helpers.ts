import type { Transaction } from '../src/shared/types.js';
import { addDays, dateKey } from '../src/shared/util.js';
import { categorizeTransaction } from '../src/server/insights/categorize.js';
import { scoreRisk } from '../src/server/insights/risk.js';

let seq = 0;

export function makeTx(overrides: Partial<Transaction> & Pick<Transaction, 'amount' | 'direction' | 'type' | 'status'>): Transaction {
  const base = {
    id: `txn_t${String(++seq).padStart(4, '0')}`,
    timestamp: overrides.timestamp ?? new Date('2026-06-15T12:00:00Z').toISOString(),
    type: overrides.type,
    status: overrides.status,
    amount: overrides.amount,
    direction: overrides.direction,
    currency: 'USD' as const,
    counterparty: overrides.counterparty ?? { name: 'Test Buyer', email: 'buyer@test.example' },
    description: overrides.description ?? 'Test payment',
    method: overrides.method ?? 'paypal',
    category: 'Product sales',
    risk: { score: 0, flags: [] },
  };
  const merged = { ...base, ...overrides, category: overrides.category ?? categorizeTransaction(base) };
  return { ...merged, risk: overrides.risk ?? scoreRisk(merged) };
}

/** N consecutive UTC date keys ending at `endDate` (inclusive), oldest first. */
export function dateKeys(days: number, endDate = '2026-03-31'): string[] {
  const end = new Date(`${endDate}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => dateKey(addDays(end, -(days - 1 - i))));
}
