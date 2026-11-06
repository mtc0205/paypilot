/**
 * Deterministic rule-based transaction categorizer (MCC-like keyword classifier).
 * Runs on every transaction — server-side only, zero API cost, auditable.
 */
import type { Transaction } from '../../shared/types.js';

export const CATEGORIES = [
  'Retainers',
  'Invoiced sales',
  'Product sales',
  'Consulting',
  'Branding',
  'Web design',
  'Illustration',
  'Design software',
  'Creative software',
  'Dev tools',
  'Productivity',
  'Communication',
  'Cloud hosting',
  'Payment fees',
  'Refunds',
  'Disputes',
  'Bank payouts',
  'Card testing',
  'Other expenses',
] as const;

interface Rule {
  category: string;
  keywords: string[];
}

const OUTFLOW_RULES: Rule[] = [
  { category: 'Design software', keywords: ['figma'] },
  { category: 'Creative software', keywords: ['adobe', 'photoshop', 'illustrator subscription'] },
  { category: 'Dev tools', keywords: ['github', 'gitlab', 'vscode'] },
  { category: 'Productivity', keywords: ['notion', 'google workspace', 'g suite', 'office 365'] },
  { category: 'Communication', keywords: ['slack', 'zoom', 'discord nitro'] },
  { category: 'Cloud hosting', keywords: ['aws', 'amazon web services', 'digitalocean', 'vercel', 'netlify', 'cloudflare'] },
];

const INFLOW_RULES: Rule[] = [
  { category: 'Retainers', keywords: ['retainer'] },
  { category: 'Consulting', keywords: ['consult', 'advisory', 'audit'] },
  { category: 'Branding', keywords: ['brand', 'logo', 'identity'] },
  { category: 'Web design', keywords: ['web', 'site', 'landing', 'ui', 'ux'] },
  { category: 'Illustration', keywords: ['illustration', 'icon', 'drawing', 'packaging'] },
];

function matches(text: string, rules: Rule[]): string | null {
  const lower = text.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.category;
  }
  return null;
}

export function categorizeTransaction(tx: Pick<Transaction, 'type' | 'direction' | 'counterparty' | 'description' | 'invoiceId'>): string {
  switch (tx.type) {
    case 'FEE':
      return 'Payment fees';
    case 'REFUND':
      return 'Refunds';
    case 'CHARGEBACK':
      return 'Disputes';
    case 'PAYOUT':
      return 'Bank payouts';
    case 'AUTHORIZATION':
      return 'Card testing';
    default:
      break;
  }
  const haystack = `${tx.counterparty.name} ${tx.counterparty.email} ${tx.description}`;
  if (tx.direction === 'out') {
    return matches(haystack, OUTFLOW_RULES) ?? 'Other expenses';
  }
  if (tx.type === 'SUBSCRIPTION') return 'Retainers';
  return matches(haystack, INFLOW_RULES) ?? (tx.invoiceId ? 'Invoiced sales' : 'Product sales');
}
