/**
 * Evidence checklists for dispute responses, keyed by PayPal dispute reason.
 * Shared by the mock seed and the sandbox adapter so both modes agree.
 */
import type { DisputeReason, EvidenceItem } from '../../shared/types.js';

const CHECKLISTS: Record<DisputeReason, EvidenceItem[]> = {
  UNAUTHORIZED: [
    { label: 'Proof of delivery / service fulfillment', done: false, hint: 'Signed receipt, delivery confirmation, or project handoff email' },
    { label: 'AVS/CVV match evidence', done: false, hint: 'Transaction detail showing address and CVV matched' },
    { label: 'Customer communication history', done: false, hint: 'Emails or messages proving the buyer knew about the charge' },
    { label: 'Prior undisputed transactions from same buyer', done: false, hint: 'Shows a pattern of legitimate use' },
    { label: 'Device / IP fingerprint match', done: false, hint: 'Same device as previous successful payments' },
  ],
  MERCHANDISE_NOT_AS_DESCRIBED: [
    { label: 'Product description / listing as buyer saw it', done: false, hint: 'Original page, proposal, or agreed spec' },
    { label: 'Proof item matched the description', done: false, hint: 'Photos, deliverable files, or project acceptance' },
    { label: 'Buyer acceptance / approval record', done: false, hint: 'Email or signature where buyer approved the work' },
    { label: 'Communication showing buyer expectations', done: false, hint: 'Thread where the scope was agreed' },
    { label: 'Refund policy acknowledgment', done: false, hint: 'Terms accepted at checkout' },
  ],
  DUPLICATE: [
    { label: 'Transaction IDs of every related charge', done: false, hint: 'Shows exactly what was billed and when' },
    { label: 'Proof only one order shipped', done: false, hint: 'Shipping label / fulfillment log' },
    { label: 'Refund policy acknowledgment', done: false, hint: 'Terms accepted at checkout' },
  ],
  ITEM_NOT_RECEIVED: [
    { label: 'Proof of shipment or delivery', done: false, hint: 'Tracking number with carrier confirmation' },
    { label: 'Delivery address matching buyer address', done: false, hint: 'Address on the label vs PayPal record' },
    { label: 'Signature / access log', done: false, hint: 'Signed delivery or download/access log for digital goods' },
    { label: 'Customer correspondence', done: false, hint: 'Any thread where buyer acknowledges receipt' },
  ],
  REFUNDED: [
    { label: 'Refund transaction ID and date', done: false, hint: 'The refund that should close this dispute' },
    { label: 'Proof refund reached original payment method', done: false, hint: 'Bank or card statement' },
  ],
  SUBSCRIBED_UNKNOWN: [
    { label: 'Subscription terms shown at signup', done: false, hint: 'Screenshot of checkout with price and cadence' },
    { label: 'Cancellation request history', done: false, hint: 'Proves whether the buyer ever cancelled' },
    { label: 'Usage / login logs during billing period', done: false, hint: 'Buyer used the service after being billed' },
  ],
};

export function buildEvidenceChecklist(reason: DisputeReason): EvidenceItem[] {
  return (CHECKLISTS[reason] ?? CHECKLISTS.ITEM_NOT_RECEIVED).map((e) => ({ ...e }));
}
