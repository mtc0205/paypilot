/**
 * Natural-language invoice composer parser.
 * "Invoice Jane Doe $280 for design retainer, due in 14 days"
 *   -> { recipientName: 'Jane Doe', amount: 280, memo: 'design retainer', dueDays: 14 }
 *
 * Deliberately deterministic and dependency-free — no LLM required.
 */
import type { ParsedInvoiceDraft } from '../../shared/types.js';

export class InvoiceParseError extends Error {
  readonly notes: string[];
  constructor(message: string, notes: string[] = []) {
    super(message);
    this.name = 'InvoiceParseError';
    this.notes = notes;
  }
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fourteen: 14,
  twenty: 20,
  thirty: 30,
  sixty: 60,
  ninety: 90,
};

function parseDueDays(text: string): { days: number | null; explicit: boolean } {
  const lower = text.toLowerCase();
  const explicitDays = lower.match(/due in (\d+)\s*days?/);
  if (explicitDays) return { days: Number(explicitDays[1]), explicit: true };
  if (/\b(due )?(today|right now)\b/.test(lower)) return { days: 0, explicit: true };
  if (/due tomorrow|next day/.test(lower)) return { days: 1, explicit: true };
  if (/\bnext week\b/.test(lower) && /due|net/.test(lower)) return { days: 7, explicit: true };
  if (/\b(two|2|a) weeks?\b|fortnight/.test(lower) && /due|net/.test(lower)) return { days: 14, explicit: true };
  if (/\b(three|3) weeks?\b/.test(lower) && /due|net/.test(lower)) return { days: 21, explicit: true };
  if (/a month|next month|monthly terms|net[- ]?30/.test(lower)) return { days: 30, explicit: true };
  const net = lower.match(/net[- ]?(\d+)/);
  if (net) return { days: Number(net[1]), explicit: true };
  const endOfMonth = lower.match(/end of (the )?month/);
  if (endOfMonth) {
    const now = new Date();
    const eom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { days: Math.max(0, Math.round((eom.getTime() - now.getTime()) / 86_400_000)), explicit: true };
  }
  const inDays = lower.match(/in (\d+)\s*days?/);
  if (inDays) return { days: Number(inDays[1]), explicit: true };
  const inWords = lower.match(/in (a|an|one|two|three|fourteen|twenty|thirty) days?/);
  if (inWords && WORD_NUMBERS[inWords[1]] !== undefined) return { days: WORD_NUMBERS[inWords[1]], explicit: true };
  return { days: null, explicit: false };
}

function parseAmount(text: string): number | null {
  // Prefer explicit currency: $1,234.56 / $420 / 250 dollars
  const dollar = text.match(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/);
  if (dollar) return Number(dollar[1].replace(/,/g, ''));
  const worded = text.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/i);
  if (worded) return Number(worded[1].replace(/,/g, ''));
  // Bare number after "for" ("bill Tom for 500")
  const forNumber = text.match(/\bfor\s+\$?(\d+(?:\.\d{1,2})?)\b/);
  if (forNumber) return Number(forNumber[1]);
  return null;
}

function parseEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : undefined;
}

function titleCaseName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function parseRecipient(text: string, email: string | undefined): { name?: string; notes: string[] } {
  const notes: string[] = [];
  // Drop everything from the first money/for-clause so names like "Invoice Jane Doe $280" parse cleanly
  const head = text.split(/\$|\bdue\b|\bfor\b/)[0] ?? text;
  let nameSrc = head.replace(/^\s*(please\s+)?(send\s+((an?|the)\s+)?invoice\s+(to\s+)?|invoice\s+(to\s+)?|bill\s+|create (an? )?invoice (for|to) )/i, '').trim();
  if (email) nameSrc = nameSrc.replace(email, '').trim();
  // "invoice to NAME" form
  const toForm = text.match(/(?:invoice|bill)\s+(?:to\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/);
  if (toForm) nameSrc = toForm[1];
  nameSrc = nameSrc.replace(/[,;:]+$/, '').trim();
  if (nameSrc && /[A-Za-z]/.test(nameSrc) && nameSrc.split(/\s+/).length <= 4 && nameSrc.length <= 48) {
    const name = titleCaseName(nameSrc);
    if (name.length >= 2) return { name, notes };
    notes.push(`Ignoring implausible recipient "${nameSrc}"`);
  }
  if (email && !nameSrc) {
    const local = email.split('@')[0].replace(/[._\d]+/g, ' ').trim();
    if (local) return { name: titleCaseName(local), notes: [...notes, 'Recipient name derived from email address'] };
  }
  notes.push('No recipient name detected — you may want to add one');
  return { name: undefined, notes };
}

function parseMemoAndItem(text: string): { memo?: string; item: string } {
  const forClause = text.match(/\bfor\s+([^,]+?)(?:\s*,\s*(?:due|net|payable)\b|$)/i);
  let memo: string | undefined;
  if (forClause) {
    memo = forClause[1].replace(/\$\s?[\d,.]+/g, '').replace(/\s{2,}/g, ' ').trim();
    // strip a leading amount that preceded the description ("for $420 consulting")
    memo = memo.replace(/^(?:usd|dollars?)\s*/i, '').trim();
    if (memo.length > 72 || memo.length === 0) memo = memo.slice(0, 72).trim() || undefined;
  }
  const item = memo ? titleCaseish(memo) : 'Professional services';
  return { memo, item };
}

function titleCaseish(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 3 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const QUANTITY = /(?:^|\s)(?:x\s*)?(\d+)\s*(?:x|hours?|hrs?|units?|seats?|licenses?)\b/i;

export function parseInvoiceText(text: string): ParsedInvoiceDraft {
  const trimmed = text.trim();
  if (!trimmed) throw new InvoiceParseError('Nothing to parse — describe the invoice in plain language', ['Empty input']);
  const notes: string[] = [];

  const amount = parseAmount(trimmed);
  if (amount === null || !Number.isFinite(amount)) {
    throw new InvoiceParseError('Could not find an amount. Try phrasing like "Invoice Jane Doe $280 for design work"', ['amount missing']);
  }
  if (amount <= 0) throw new InvoiceParseError(`Amount must be positive, got ${amount}`, ['invalid amount']);
  if (amount > 1_000_000) throw new InvoiceParseError(`Amount ${amount} exceeds the $1,000,000 safety limit`, ['amount too large']);

  const email = parseEmail(trimmed);
  const recipient = parseRecipient(trimmed, email);
  notes.push(...recipient.notes);
  const { memo, item } = parseMemoAndItem(trimmed);
  const due = parseDueDays(trimmed);
  if (!due.explicit) notes.push('No due date phrase found — defaulting to Net 30');

  const qtyMatch = trimmed.match(QUANTITY);
  const quantity = qtyMatch ? Math.max(1, Math.min(999, Number(qtyMatch[1]))) : 1;

  let confidence = 0.55;
  if (recipient.name) confidence += 0.2;
  if (email) confidence += 0.1;
  if (memo) confidence += 0.1;
  if (due.explicit) confidence += 0.05;

  return {
    recipientName: recipient.name,
    recipientEmail: email,
    amount: Math.round(amount * 100) / 100,
    itemName: item,
    quantity,
    dueDays: due.days ?? 30,
    memo,
    confidence: Math.round(Math.min(confidence, 0.99) * 100) / 100,
    notes,
  };
}
