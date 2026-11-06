/**
 * Dispute-response drafting. With no LLM key, drafts come from these
 * evidence-aware templates built from the real dispute + transaction context.
 * (With an LLM configured, the same context becomes the prompt ground truth.)
 */
import type { Dispute, Transaction } from '../../shared/types.js';
import { fmtMoney } from '../../shared/util.js';

const REASON_STRATEGY: Record<Dispute['reason'], { position: string; evidence: string[] }> = {
  UNAUTHORIZED: {
    position: 'the charge was authorized by the account holder',
    evidence: [
      'the buyer\'s account and device fingerprint match previous undisputed payments',
      'the service was delivered and accessed after the charge date',
      'our correspondence shows the buyer acknowledged and used the deliverables',
    ],
  },
  MERCHANDISE_NOT_AS_DESCRIBED: {
    position: 'the delivered work matches the agreed scope exactly',
    evidence: [
      'the signed proposal defines the scope, deliverables, and revision rounds',
      'the buyer approved each milestone in writing (approval attached)',
      'final files were delivered on the agreed date and opened by the buyer',
    ],
  },
  ITEM_NOT_RECEIVED: {
    position: 'the deliverables were delivered and received',
    evidence: [
      'delivery confirmation with timestamps (transfer link access log attached)',
      'the buyer downloaded/accessed the files on multiple dates after delivery',
      'our thread shows the buyer requesting follow-up tweaks after delivery',
    ],
  },
  DUPLICATE: {
    position: 'this was a single legitimate charge, not a duplicate',
    evidence: [
      'each transaction ID maps to a distinct order with distinct deliverables',
      'the fulfillment log shows one delivery per order',
      'we never issue refunds for disputed charges without a dispute ID',
    ],
  },
  REFUNDED: {
    position: 'the refund already reached the buyer',
    evidence: [
      'refund transaction ID and timestamp (attached)',
      'the refund settled to the original payment method',
    ],
  },
  SUBSCRIBED_UNKNOWN: {
    position: 'the subscription was explicitly authorized and used',
    evidence: [
      'checkout terms showing price and cadence, accepted by the buyer',
      'usage logs show active use after each billing date',
      'no cancellation request was received before this billing period',
    ],
  },
};

export function draftDisputeResponse(dispute: Dispute, transaction: Transaction | null, merchantName: string): string {
  const strategy = REASON_STRATEGY[dispute.reason];
  const evidenceDone = dispute.evidence.filter((e) => e.done);
  const evidenceMissing = dispute.evidence.filter((e) => !e.done);
  const lines: string[] = [];

  lines.push(`To the PayPal Resolutions Team,`);
  lines.push('');
  lines.push(
    `We are responding to dispute ${dispute.id} (${dispute.reason.replace(/_/g, ' ').toLowerCase()}, ${fmtMoney(dispute.amount)}) ` +
      `filed by ${dispute.buyer.name}. We respectfully submit that ${strategy.position}.`,
  );
  lines.push('');
  lines.push('Transaction background:');
  if (transaction) {
    lines.push(
      `- Charge: ${transaction.id} — ${fmtMoney(transaction.amount)} on ${transaction.timestamp.slice(0, 10)} (${transaction.description})`,
    );
    lines.push(`- Payment method: ${transaction.method.toUpperCase()}, status ${transaction.status}.`);
  } else {
    lines.push(`- Referenced transaction ${dispute.transactionId} (details unavailable).`);
  }
  lines.push('');
  lines.push('Evidence supporting our position:');
  strategy.evidence.forEach((e, i) => lines.push(`${i + 1}. ${e[0].toUpperCase()}${e.slice(1)}.`));
  lines.push('');
  lines.push(
    `Checklist status: ${evidenceDone.length}/${dispute.evidence.length} evidence items collected` +
      (evidenceMissing.length ? ` — still needed: ${evidenceMissing.map((e) => e.label.toLowerCase()).join('; ')}.` : '.'),
  );
  lines.push('');
  lines.push(
    `We ask that the dispute be resolved in the merchant's favor. We remain available for additional documentation at ${merchantName}.`,
  );
  lines.push('');
  lines.push(`Respectfully,`);
  lines.push(`${merchantName} (via PayPilot First Mate — template draft, review before submitting)`);

  return lines.join('\n');
}

export function approvalRationale(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'create_invoice': {
      const amount = Number(args.amount ?? 0);
      const recipient = String(args.recipient ?? 'customer');
      const dueDays = Number(args.dueDays ?? 30);
      return `Create a PayPal invoice for ${fmtMoney(amount)} to ${recipient}, due in ${dueDays} days. This writes to your PayPal account (as a DRAFT invoice).`;
    }
    case 'send_invoice':
      return `Email invoice ${String(args.invoice_id ?? '')} to its recipient through PayPal. The buyer will receive a payment request.`;
    default:
      return `Execute ${tool} — this mutates your PayPal account state.`;
  }
}
