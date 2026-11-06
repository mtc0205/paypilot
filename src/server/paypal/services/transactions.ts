/**
 * PayPal Transactions Search API (v1/reporting) — real REST calls used in
 * sandbox mode. Results are normalized into PayPilot's shared ledger type.
 */
import type { Transaction } from '../../../shared/types.js';
import { categorizeTransaction } from '../../insights/categorize.js';
import { scoreRisk } from '../../insights/risk.js';
import type { PayPalClient } from '../client.js';

/** Shape returned by GET /v1/reporting/transactions (subset we consume). */
export interface PayPalTransactionRow {
  transaction_info: {
    transaction_id: string;
    transaction_status?: string;
    transaction_initiation_date?: string;
    transaction_amount?: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_note?: string;
    transaction_subject?: string;
    transaction_event_code?: string;
  };
  payer_info?: {
    email_address?: string;
    display_name?: string;
  };
}

const EVENT_CODE_MAP: Record<string, Transaction['type']> = {
  T0000: 'PAYMENT',
  T0001: 'PAYMENT',
  T0002: 'PAYMENT',
  T1107: 'REFUND',
  T0300: 'REFUND',
  T0400: 'FEE',
  T0900: 'PAYOUT',
  T5000: 'PAYOUT',
  T11L0: 'CHARGEBACK',
  T1106: 'CHARGEBACK',
  T9800: 'AUTHORIZATION',
};

function mapStatus(s: string | undefined): Transaction['status'] {
  switch (s) {
    case 'S':
      return 'COMPLETED';
    case 'P':
      return 'PENDING';
    case 'V':
      return 'VOIDED';
    case 'D':
      return 'DENIED';
    case 'R':
      return 'REVERSED';
    default:
      return 'COMPLETED';
  }
}

export function toLedgerTransaction(row: PayPalTransactionRow): Transaction {
  const info = row.transaction_info;
  const amount = Math.abs(Number(info.transaction_amount?.value ?? '0'));
  const raw = Number(info.transaction_amount?.value ?? '0');
  const eventCode = info.transaction_event_code ?? '';
  const type = EVENT_CODE_MAP[eventCode] ?? 'PAYMENT';
  const direction: Transaction['direction'] = raw >= 0 ? 'in' : 'out';
  const counterparty = {
    name: row.payer_info?.display_name ?? 'PayPal',
    email: row.payer_info?.email_address ?? 'unknown@paypal.com',
  };
  const description = info.transaction_subject || info.transaction_note || type.toLowerCase();
  const tx = {
    id: info.transaction_id,
    timestamp: info.transaction_initiation_date
      ? new Date(info.transaction_initiation_date).toISOString()
      : new Date().toISOString(),
    type,
    status: mapStatus(info.transaction_status),
    amount,
    direction,
    currency: 'USD' as const,
    counterparty,
    description,
    method: 'paypal' as const,
  };
  const category = categorizeTransaction(tx);
  const risk = scoreRisk(tx);
  return { ...tx, category, risk };
}

export async function searchTransactions(
  client: PayPalClient,
  params: { startDate: string; endDate: string; limit?: number },
): Promise<PayPalTransactionRow[]> {
  const qs = new URLSearchParams({
    start_date: params.startDate,
    end_date: params.endDate,
    fields: 'transaction_info,payer_info',
    page_size: String(Math.min(params.limit ?? 100, 500)),
  });
  const json = await client.request<{ transaction_details?: PayPalTransactionRow[]; total_pages: number }>(
    'GET',
    `/v1/reporting/transactions?${qs.toString()}`,
  );
  return json.transaction_details ?? [];
}

export async function fetchLedger(client: PayPalClient, days = 120): Promise<Transaction[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const rows = await searchTransactions(client, {
    startDate: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endDate: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    limit: 500,
  });
  return rows.map(toLedgerTransaction).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
