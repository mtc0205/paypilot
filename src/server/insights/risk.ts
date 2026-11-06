/**
 * Per-transaction fraud/dispute risk score, 0–100. Deterministic heuristic —
 * bounded by construction; every point is explainable via the returned flags.
 */
import type { RiskAssessment, Transaction } from '../../shared/types.js';
import { clamp } from '../../shared/util.js';

export interface RiskContext {
  /** Disputes previously filed by this buyer */
  buyerDisputeCount?: number;
  /** Denied/voided card authorizations by this buyer recently */
  buyerRecentDeniedAuths?: number;
  /** Transactions by this buyer in the last hour */
  sameBuyerLastHourCount?: number;
  /** Robust z-score of the transaction amount vs its peer group */
  amountZ?: number;
}

export function scoreRisk(tx: Pick<Transaction, 'type' | 'status' | 'method' | 'amount' | 'counterparty'>, ctx: RiskContext = {}): RiskAssessment {
  let score = 0;
  const flags: string[] = [];

  const add = (points: number, flag: string) => {
    score += points;
    flags.push(flag);
  };

  if (tx.type === 'CHARGEBACK') add(60, 'chargeback_linked');
  if ((tx.status === 'DENIED' || tx.status === 'VOIDED') && tx.method === 'card') add(30, 'declined_card_auth');
  if (tx.type === 'AUTHORIZATION' && tx.method === 'card' && tx.amount <= 10) add(25, 'micro_card_auth');
  if (tx.amount > 0 && tx.amount < 2) add(10, 'tiny_amount');
  if ((ctx.buyerRecentDeniedAuths ?? 0) >= 3) add(20, 'buyer_failed_auth_burst');
  const disputes = ctx.buyerDisputeCount ?? 0;
  if (disputes >= 1) add(Math.min(30, 20 * disputes), 'buyer_dispute_history');
  if ((ctx.sameBuyerLastHourCount ?? 0) >= 6) add(20, 'buyer_velocity');
  if ((ctx.amountZ ?? 0) >= 5) add(15, 'amount_outlier');
  if (tx.counterparty.email.endsWith('.ru') || tx.counterparty.email.includes('tempmail')) add(10, 'disposable_email');

  return { score: clamp(Math.round(score), 0, 100), flags };
}

export function riskBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 55) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Convenience: numeric score only (used in tests and API summaries). */
export function riskScoreNumber(tx: Pick<Transaction, 'type' | 'status' | 'method' | 'amount' | 'counterparty'>, ctx?: RiskContext): number {
  return scoreRisk(tx, ctx).score;
}
