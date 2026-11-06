/**
 * PayPal Disputes API (v1/customer/disputes) — real REST calls for sandbox mode.
 */
import type { Dispute, DisputeReason } from '../../../shared/types.js';
import { buildEvidenceChecklist } from '../evidence.js';
import type { PayPalClient } from '../client.js';

interface PayPalDisputeResponse {
  dispute_id: string;
  status: string;
  reason?: string;
  amount?: { currency_code?: string; value?: string };
  dispute_amount?: { currency_code?: string; value?: string };
  create_time?: string;
  respond_by?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer?: { email_address?: string; name?: string } }[];
}

const REASON_MAP: Record<string, DisputeReason> = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'MERCHANDISE_NOT_AS_DESCRIBED',
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'ITEM_NOT_RECEIVED',
  UNAUTHORIZED_TRANSACTION: 'UNAUTHORIZED',
  DUPLICATE_TRANSACTION: 'DUPLICATE',
  REFUNDED_BUT_NOT_CREDITED: 'REFUNDED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIBED_UNKNOWN',
};

function mapStatus(s: string): Dispute['status'] {
  switch (s) {
    case 'UNDER_REVIEW':
    case 'WAITING_FOR_BUYER_RESPONSE':
    case 'REQUIRED_OTHER_PARTY_ACTION':
      return 'UNDER_REVIEW';
    case 'WAITING_FOR_SELLER_RESPONSE':
      return 'OPEN';
    case 'RESOLVED':
      return 'RESOLVED_SELLER';
    default:
      return 'OPEN';
  }
}

export function fromPayPalDispute(res: PayPalDisputeResponse): Dispute {
  const reason = REASON_MAP[res.reason ?? ''] ?? 'MERCHANDISE_NOT_AS_DESCRIBED';
  const disputedTx = res.disputed_transactions?.[0];
  return {
    id: res.dispute_id,
    reason,
    status: mapStatus(res.status),
    amount: Number(res.dispute_amount?.value ?? res.amount?.value ?? '0'),
    currency: 'USD',
    transactionId: disputedTx?.seller_transaction_id ?? '',
    buyer: {
      name: disputedTx?.buyer?.name ?? 'Buyer',
      email: disputedTx?.buyer?.email_address ?? 'buyer@example.com',
    },
    openedAt: res.create_time ?? new Date().toISOString(),
    respondBy: res.respond_by ?? new Date(Date.now() + 10 * 86_400_000).toISOString(),
    evidence: buildEvidenceChecklist(reason),
  };
}

export async function listDisputesRemote(client: PayPalClient): Promise<Dispute[]> {
  const json = await client.request<{ items?: PayPalDisputeResponse[] }>('GET', '/v1/customer/disputes?page_size=50');
  return (json.items ?? []).map(fromPayPalDispute);
}

export async function getDisputeRemote(client: PayPalClient, id: string): Promise<Dispute> {
  const res = await client.request<PayPalDisputeResponse>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
  return fromPayPalDispute(res);
}
