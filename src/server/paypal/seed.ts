/**
 * Deterministic seed generator — 14 months of story-driven ledger data for
 * "Harbor & Pine Studio", a small design/consulting merchant.
 *
 * Story baked into the data (all discoverable by the insight engine):
 *  - steady growth (≈1.9x over the window) + strong weekday seasonality
 *  - holiday bump (Nov 20 – Dec 24, ×1.55) in both past seasons
 *  - 2 whale customers (Northwind Labs weekly, Cascade Media monthly)
 *  - 3 monthly inbound retainers + 6 outbound software subscriptions
 *  - card-testing fraud burst: ~40 micro card authorizations in the last week
 *  - refund spike in the last 7 days
 *  - 3 open disputes with response deadlines 2/5/9 days out
 *  - one $8,900 outlier consulting payment 12 days ago
 *
 * Uses a seeded PRNG (mulberry32) so output is reproducible for a fixed `now`.
 */
import type {
  Counterparty,
  DemoOrder,
  Dispute,
  DisputeReason,
  EvidenceItem,
  Invoice,
  Transaction,
} from '../../shared/types.js';
import { addDays, dateKey, round2, startOfUtcDay } from '../../shared/util.js';
import { categorizeTransaction } from '../insights/categorize.js';
import { scoreRisk } from '../insights/risk.js';
import type { AppState } from '../store/store.js';
import { emptyState } from '../store/store.js';
import { buildEvidenceChecklist } from './evidence.js';

/* --------------------------------- PRNG -------------------------------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  now?: Date;
  /** PRNG seed; default 20261107 */
  seed?: number;
}

/* ------------------------------- Name pools ---------------------------------- */

const FIRST = ['Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Isla', 'Marcus', 'Priya', 'Diego', 'Nina', 'Omar', 'Grace', 'Felix', 'Rosa', 'Jonas', 'Amara', 'Theo', 'Lucia', 'Sam', 'Elena', 'Victor', 'Hana', 'Owen', 'Talia', 'Ruben', 'Freya', 'Kofi', 'Mira', 'Leon'];
const LAST = ['Chen', 'Novak', 'Okafor', 'Garcia', 'Kim', 'Lindqvist', 'Patel', 'Moreau', 'Silva', 'Haddad', 'Nguyen', 'Kowalski', 'Fischer', 'Rossi', 'Andersen', 'Tanaka', 'Rivera', 'Bauer', 'Costa', 'Mensah', 'Dubois', 'Ivanov', 'Silva', 'Larsen', 'Yamada'];
const PERSONA_COMPANIES = ['Bright Loop Coffee', 'Sable & Co', 'Tidewater Legal', 'Maple Street Bakery', 'Northgate Fitness', 'Copper Kettle Ceramics', 'Driftwood Events', 'Bluebird Wellness', 'Stonebridge Dental', 'Rivet Hardware', 'Larkspur Weddings', 'Foundry Print Co'];
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'icloud.com', 'fastmail.com', 'yahoo.com', 'hey.com'];
const COMPANY_DOMAINS = ['brightloop.co', 'sableandco.com', 'tidewater.legal', 'maplestreet.bakery', 'northgate.fit', 'copperkettle.shop', 'driftwood.events', 'bluebird.care', 'stonebridge.dental', 'rivethw.com', 'larkspur.weddings', 'foundryprint.com'];

const SALES_DESCRIPTIONS = [
  'Logo & brand refresh',
  'Brand sprint deposit',
  'Web design milestone 2',
  'Landing page design',
  'Packaging design',
  'Illustration pack',
  'UI audit & fixes',
  'Design system session',
  'Newsletter template',
  'Product photography retouch',
  'Menu redesign',
  'Poster series',
];

const CONSULTING_DESCRIPTIONS = ['Consulting session', 'Strategy workshop', 'Design advisory call', 'UX research session'];

/* ------------------------------- Whales & subs ------------------------------- */

const WHALE_WEEKLY = { name: 'Northwind Labs', email: 'ap@northwindlabs.com', amount: 4800, description: 'Weekly product design retainer' };
const WHALE_MONTHLY = { name: 'Cascade Media Group', email: 'accounts@cascademedia.com', amount: 9500, description: 'Monthly content design retainer' };

const INBOUND_RETAINERS: { name: string; email: string; amount: number; dayOfMonth: number; description: string }[] = [
  { name: 'Bright Loop Coffee', email: 'hello@brightloop.co', amount: 650, dayOfMonth: 4, description: 'Design retainer — monthly' },
  { name: 'Tidewater Legal', email: 'billing@tidewater.legal', amount: 1200, dayOfMonth: 12, description: 'Brand retainer — monthly' },
  { name: 'Bluebird Wellness', email: 'ops@bluebird.care', amount: 850, dayOfMonth: 21, description: 'Web retainer — monthly' },
];

const OUTBOUND_SUBSCRIPTIONS: { name: string; email: string; amount: number; dayOfMonth: number; description: string }[] = [
  { name: 'Figma', email: 'billing@figma.com', amount: 45, dayOfMonth: 3, description: 'Figma Professional' },
  { name: 'Adobe', email: 'billing@adobe.com', amount: 59.99, dayOfMonth: 7, description: 'Adobe Creative Cloud' },
  { name: 'GitHub', email: 'billing@github.com', amount: 63.9, dayOfMonth: 11, description: 'GitHub Team' },
  { name: 'Notion', email: 'billing@notion.so', amount: 28, dayOfMonth: 15, description: 'Notion Plus' },
  { name: 'Zoom', email: 'billing@zoom.us', amount: 199.5, dayOfMonth: 19, description: 'Zoom Business' },
  { name: 'Google Workspace', email: 'billing@google.com', amount: 144, dayOfMonth: 23, description: 'Google Workspace Business' },
];

/** Sunday-first weekday sales multipliers (studio sells mostly Mon–Fri). */
const WEEKDAY_FACTOR = [0.35, 1.35, 1.4, 1.35, 1.25, 1.15, 0.5];

const HISTORY_DAYS = 427; // ~14 months
const BASE_SALES_PER_DAY = 4.2;
const GROWTH = 1.9;

/* --------------------------------- Helpers ----------------------------------- */

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function personEmail(name: string, domain: string): string {
  return `${slug(name)}@${domain}`;
}

function atHour(day: Date, hour: number, rand: () => number): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, Math.floor(rand() * 60), Math.floor(rand() * 60)),
  );
}

function isHolidayBump(d: Date): boolean {
  const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return md >= 1120 && md <= 1224;
}

function saleAmount(rand: () => number): number {
  const r = rand();
  if (r < 0.55) return round2(45 + rand() * 215); // $45–260
  if (r < 0.9) return round2(260 + rand() * 590); // $260–850
  return round2(850 + rand() * 1750); // $850–2,600
}

/* --------------------------------- Generator --------------------------------- */

export function generateSeed(options?: SeedOptions): AppState {
  const now = options?.now ?? new Date();
  const rand = mulberry32(options?.seed ?? 20261107);

  const state = emptyState();
  state.seededAt = now.toISOString();
  state.merchant = {
    name: 'Harbor & Pine Studio',
    email: 'billing@harborandpine.test',
    business: 'Design & consulting studio',
  };

  const txs: Transaction[] = [];
  let txSeq = 0;
  const nextTxId = (): string => {
    txSeq += 1;
    return `txn_${String(txSeq).padStart(5, '0')}`;
  };

  const pendingRefunds: { sale: Transaction; refundOn: Date }[] = [];
  /** Operational daily net (excludes bank payouts) — drives stable weekly sweeps. */
  const dayOperationalNet = new Map<string, number>();
  const bumpDay = (d: Date, net: number) => {
    const k = dateKey(d);
    dayOperationalNet.set(k, (dayOperationalNet.get(k) ?? 0) + net);
  };

  const addTx = (tx: Omit<Transaction, 'id' | 'category' | 'risk'> & { id?: string }): Transaction => {
    const base = { ...tx, id: tx.id ?? nextTxId() };
    const category = categorizeTransaction(base);
    const full: Transaction = { ...base, category, risk: { score: 0, flags: [] } };
    txs.push(full);
    if (full.status === 'COMPLETED') bumpDay(new Date(full.timestamp), full.direction === 'in' ? full.amount : -full.amount);
    return full;
  };

  const today = startOfUtcDay(now);
  const start = addDays(today, -(HISTORY_DAYS - 1));
  const growthAt = (idx: number) => 1 + ((GROWTH - 1) * idx) / (HISTORY_DAYS - 1);

  // Stable buyer persona pool (reused so history feels real)
  const personas: Counterparty[] = [];
  for (let i = 0; i < 64; i++) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    personas.push({ name, email: personEmail(name, EMAIL_DOMAINS[Math.floor(rand() * EMAIL_DOMAINS.length)]) });
  }
  const companyParties: Counterparty[] = PERSONA_COMPANIES.map((name, i) => ({
    name,
    email: `ap@${COMPANY_DOMAINS[i]}`,
  }));

  /* 1) Daily sales, whales, retainers, subscriptions, fees, payouts, refunds */

  for (let idx = 0; idx < HISTORY_DAYS; idx++) {
    const day = addDays(start, idx);
    const dow = day.getUTCDay();
    const holiday = isHolidayBump(day) ? 1.55 : 1;
    const expectedSales = BASE_SALES_PER_DAY * growthAt(idx) * WEEKDAY_FACTOR[dow] * holiday;
    let nSales = Math.floor(expectedSales);
    if (rand() < expectedSales - nSales) nSales += 1;

    let dayInflowFromSales = 0;
    for (let s = 0; s < nSales; s++) {
      const isCompany = rand() < 0.22;
      const party = isCompany ? companyParties[Math.floor(rand() * companyParties.length)] : personas[Math.floor(rand() * personas.length)];
      const amount = saleAmount(rand);
      const isConsulting = rand() < 0.18;
      const description = isConsulting
        ? CONSULTING_DESCRIPTIONS[Math.floor(rand() * CONSULTING_DESCRIPTIONS.length)]
        : SALES_DESCRIPTIONS[Math.floor(rand() * SALES_DESCRIPTIONS.length)];
      const status: Transaction['status'] = idx >= HISTORY_DAYS - 2 && rand() < 0.02 ? 'PENDING' : 'COMPLETED';
      const sale = addTx({
        timestamp: atHour(day, 8 + Math.floor(rand() * 14), rand).toISOString(),
        type: 'PAYMENT',
        status,
        amount,
        direction: 'in',
        currency: 'USD',
        counterparty: party,
        description,
        method: rand() < 0.72 ? 'paypal' : 'card',
      });
      dayInflowFromSales += amount;
      if (sale.status === 'COMPLETED' && rand() < 0.025) {
        pendingRefunds.push({ sale, refundOn: addDays(day, 1 + Math.floor(rand() * 5)) });
      }
    }

    // Weekly whale: Northwind Labs every Monday
    if (dow === 1) {
      addTx({
        timestamp: atHour(day, 10, rand).toISOString(),
        type: 'PAYMENT',
        status: 'COMPLETED',
        amount: WHALE_WEEKLY.amount,
        direction: 'in',
        currency: 'USD',
        counterparty: { name: WHALE_WEEKLY.name, email: WHALE_WEEKLY.email },
        description: WHALE_WEEKLY.description,
        method: 'paypal',
      });
      dayInflowFromSales += WHALE_WEEKLY.amount;
    }

    // Monthly whale + retainers + subscriptions on their day of month
    const dom = day.getUTCDate();
    const monthAnchor = (amount: number, party: Counterparty, description: string, direction: 'in' | 'out', type: Transaction['type'], method: Transaction['method']) => {
      addTx({
        timestamp: atHour(day, 9 + Math.floor(rand() * 4), rand).toISOString(),
        type,
        status: 'COMPLETED',
        amount,
        direction,
        currency: 'USD',
        counterparty: party,
        description,
        method,
      });
      if (direction === 'in') dayInflowFromSales += amount;
    };
    if (dom === 5) {
      monthAnchor(WHALE_MONTHLY.amount, { name: WHALE_MONTHLY.name, email: WHALE_MONTHLY.email }, WHALE_MONTHLY.description, 'in', 'PAYMENT', 'paypal');
    }
    for (const r of INBOUND_RETAINERS) if (dom === r.dayOfMonth) monthAnchor(r.amount, { name: r.name, email: r.email }, r.description, 'in', 'PAYMENT', 'paypal');
    for (const sub of OUTBOUND_SUBSCRIPTIONS) if (dom === sub.dayOfMonth) monthAnchor(sub.amount, { name: sub.name, email: sub.email }, sub.description, 'out', 'SUBSCRIPTION', 'card');

    // PayPal fees (aggregated daily)
    if (dayInflowFromSales > 0) {
      const nPayPal = Math.max(1, Math.round(nSales * 0.72) + 1);
      const fee = round2(dayInflowFromSales * 0.0349 + nPayPal * 0.49);
      addTx({
        timestamp: atHour(day, 23, rand).toISOString(),
        type: 'FEE',
        status: 'COMPLETED',
        amount: fee,
        direction: 'out',
        currency: 'USD',
        counterparty: { name: 'PayPal', email: 'fees@paypal.com' },
        description: 'PayPal processing fees — daily',
        method: 'paypal',
      });
    }

    // Weekly bank payout on Wednesdays (75% of trailing operational net — leaves a buffer)
    if (dow === 3) {
      let trailingNet = 0;
      for (let back = 1; back <= 7; back++) trailingNet += dayOperationalNet.get(dateKey(addDays(day, -back))) ?? 0;
      const payout = round2(trailingNet * 0.75);
      if (payout >= 200) {
        addTx({
          timestamp: atHour(day, 17, rand).toISOString(),
          type: 'PAYOUT',
          status: 'COMPLETED',
          amount: payout,
          direction: 'out',
          currency: 'USD',
          counterparty: { name: 'Chase Bank ••4417', email: 'transfers@chase.com' },
          description: 'Scheduled payout to bank',
          method: 'bank',
        });
      }
    }
  }

  // Refunds (clamped to `now`)
  for (const { sale, refundOn } of pendingRefunds) {
    const when = refundOn.getTime() > now.getTime() ? addDays(startOfUtcDay(now), 0) : refundOn;
    addTx({
      timestamp: atHour(when, 11, rand).toISOString(),
      type: 'REFUND',
      status: 'COMPLETED',
      amount: sale.amount,
      direction: 'out',
      currency: 'USD',
      counterparty: sale.counterparty,
      description: `Refund — ${sale.description}`,
      method: sale.method,
    });
  }
  // Refund SPIKE: 8 extra refunds in the last 7 days
  const spikeSales = txs
    .filter((t) => t.direction === 'in' && t.type === 'PAYMENT' && t.status === 'COMPLETED' && t.amount >= 180)
    .slice(-60);
  for (let i = 0; i < 8 && i < spikeSales.length; i++) {
    const sale = spikeSales[Math.floor((i * spikeSales.length) / 8)];
    const when = addDays(today, -(1 + Math.floor(rand() * 6)));
    addTx({
      timestamp: atHour(when, 14, rand).toISOString(),
      type: 'REFUND',
      status: 'COMPLETED',
      amount: sale.amount,
      direction: 'out',
      currency: 'USD',
      counterparty: sale.counterparty,
      description: `Refund — ${sale.description}`,
      method: sale.method,
    });
  }

  /* 2) Card-testing fraud burst: 2 days ago cluster */
  for (const dayOffset of [-6, -5]) {
    const day = addDays(today, dayOffset);
    const clusterHours = dayOffset === -6 ? [2, 3] : [13, 14, 15];
    const nAuths = dayOffset === -6 ? 19 : 21;
    for (let i = 0; i < nAuths; i++) {
      const hour = clusterHours[i % clusterHours.length];
      const hex = Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');
      addTx({
        timestamp: atHour(day, hour, rand).toISOString(),
        type: 'AUTHORIZATION',
        status: rand() < 0.85 ? 'VOIDED' : 'DENIED',
        amount: round2(1 + rand() * 8),
        direction: 'in',
        currency: 'USD',
        counterparty: { name: `Card Check ${hex.slice(0, 4).toUpperCase()}`, email: `${hex}@proton.me` },
        description: 'Card verification',
        method: 'card',
      });
    }
  }

  /* 3) Outlier consulting payments */
  const bigDeal1Party: Counterparty = { name: 'Stonebridge Dental', email: 'ap@stonebridge.dental' };
  addTx({
    timestamp: atHour(addDays(today, -12), 15, rand).toISOString(),
    type: 'PAYMENT',
    status: 'COMPLETED',
    amount: 8900,
    direction: 'in',
    currency: 'USD',
    counterparty: bigDeal1Party,
    description: 'Consulting — multi-clinic rebrand strategy',
    method: 'paypal',
  });
  addTx({
    timestamp: atHour(addDays(today, -90), 11, rand).toISOString(),
    type: 'PAYMENT',
    status: 'COMPLETED',
    amount: 12500,
    direction: 'in',
    currency: 'USD',
    counterparty: { name: 'Rivet Hardware', email: 'ap@rivethw.com' },
    description: 'Consulting — ecommerce replatform engagement',
    method: 'paypal',
  });

  /* 4) Disputes: 3 open with deadlines, 1 old resolved with chargeback */

  const disputeCandidates = txs
    .filter((t) => t.direction === 'in' && t.type === 'PAYMENT' && t.status === 'COMPLETED' && t.amount >= 280 && t.amount <= 2000)
    .slice(-90);
  const pickDisputeTx = (offsetFromEnd: number): Transaction =>
    disputeCandidates[Math.max(0, disputeCandidates.length - offsetFromEnd)] ?? disputeCandidates[0];

  const disputeSpecs: { tx: Transaction; reason: DisputeReason; daysLeft: number; status: Dispute['status']; doneCount: number }[] = [
    { tx: pickDisputeTx(30), reason: 'MERCHANDISE_NOT_AS_DESCRIBED', daysLeft: 2, status: 'OPEN', doneCount: 2 },
    { tx: pickDisputeTx(58), reason: 'UNAUTHORIZED', daysLeft: 5, status: 'OPEN', doneCount: 0 },
    { tx: pickDisputeTx(12), reason: 'ITEM_NOT_RECEIVED', daysLeft: 9, status: 'UNDER_REVIEW', doneCount: 3 },
  ];
  const disputes: Dispute[] = disputeSpecs.map((spec, i) => {
    const evidence: EvidenceItem[] = buildEvidenceChecklist(spec.reason).map((e, ei) => ({ ...e, done: ei < spec.doneCount }));
    return {
      id: `PP-D-${String(9100 + i)}`,
      reason: spec.reason,
      status: spec.status,
      amount: spec.tx.amount,
      currency: 'USD',
      transactionId: spec.tx.id,
      buyer: spec.tx.counterparty,
      openedAt: addDays(today, -(14 - spec.daysLeft)).toISOString(),
      respondBy: addDays(today, spec.daysLeft).toISOString(),
      evidence,
    };
  });

  // Old resolved dispute + its chargeback outflow
  const oldTx = pickDisputeTx(80);
  disputes.push({
    id: 'PP-D-8807',
    reason: 'DUPLICATE',
    status: 'RESOLVED_BUYER',
    amount: oldTx.amount,
    currency: 'USD',
    transactionId: oldTx.id,
    buyer: oldTx.counterparty,
    openedAt: addDays(today, -96).toISOString(),
    respondBy: addDays(today, -88).toISOString(),
    evidence: buildEvidenceChecklist('DUPLICATE').map((e) => ({ ...e, done: true })),
  });
  const chargebackTx = addTx({
    timestamp: addDays(today, -90).toISOString(),
    type: 'CHARGEBACK',
    status: 'COMPLETED',
    amount: oldTx.amount,
    direction: 'out',
    currency: 'USD',
    counterparty: oldTx.counterparty,
    description: 'Chargeback — duplicate transaction dispute lost',
    method: 'paypal',
  });
  // link
  const cbIdx = txs.findIndex((t) => t.id === chargebackTx.id);
  if (cbIdx >= 0) {
    txs[cbIdx] = { ...txs[cbIdx], disputeId: 'PP-D-8807' };
    const oldIdx = txs.findIndex((t) => t.id === oldTx.id);
    if (oldIdx >= 0) txs[oldIdx] = { ...txs[oldIdx], disputeId: 'PP-D-8807' };
  }
  for (const d of disputes) {
    const idx = txs.findIndex((t) => t.id === d.transactionId);
    if (idx >= 0) txs[idx] = { ...txs[idx], disputeId: d.id };
  }

  /* 5) Invoices with mixed statuses */
  const invoiceSpecs: {
    recipient: Counterparty;
    item: string;
    amount: number;
    dueDaysFromNow: number;
    status: Invoice['status'];
    createdBy: Invoice['createdBy'];
    daysAgo: number;
  }[] = [
    { recipient: { name: 'Acme Corp', email: 'ap@acme.test' }, item: 'Consulting', amount: 420, dueDaysFromNow: 14, status: 'DRAFT', createdBy: 'human', daysAgo: 1 },
    { recipient: { name: 'Larkspur Weddings', email: 'ap@larkspur.weddings' }, item: 'Invitation suite design', amount: 1850, dueDaysFromNow: 10, status: 'DRAFT', createdBy: 'agent', daysAgo: 2 },
    { recipient: { name: 'Maple Street Bakery', email: 'ap@maplestreet.bakery' }, item: 'Menu redesign', amount: 640, dueDaysFromNow: 7, status: 'DRAFT', createdBy: 'human', daysAgo: 3 },
    { recipient: { name: 'Northgate Fitness', email: 'ap@northgate.fit' }, item: 'Campaign landing pages', amount: 2400, dueDaysFromNow: -3, status: 'SENT', createdBy: 'human', daysAgo: 33 },
    { recipient: { name: 'Driftwood Events', email: 'ap@driftwood.events' }, item: 'Brand sprint', amount: 3800, dueDaysFromNow: 12, status: 'SENT', createdBy: 'agent', daysAgo: 16 },
    { recipient: { name: 'Copper Kettle Ceramics', email: 'ap@copperkettle.shop' }, item: 'Packaging design', amount: 1150, dueDaysFromNow: 5, status: 'PAID', createdBy: 'human', daysAgo: 35 },
    { recipient: { name: 'Foundry Print Co', email: 'ap@foundryprint.com' }, item: 'Poster series', amount: 780, dueDaysFromNow: 2, status: 'PAID', createdBy: 'agent', daysAgo: 44 },
    { recipient: { name: 'Sable & Co', email: 'ap@sableandco.com' }, item: 'Design audit', amount: 500, dueDaysFromNow: -10, status: 'CANCELLED', createdBy: 'human', daysAgo: 40 },
  ];
  const invoices: Invoice[] = invoiceSpecs.map((spec, i) => {
    const createdAt = addDays(today, -spec.daysAgo).toISOString();
    const dueDate = dateKey(addDays(today, spec.daysAgo > 0 ? spec.daysAgo : -Math.abs(spec.daysAgo)));
    return {
      id: `INV-${2026}${String(41 + i)}`,
      number: `PP-2026-${String(41 + i).padStart(4, '0')}`,
      status: spec.status,
      recipient: spec.recipient,
      items: [{ name: spec.item, quantity: 1, unitAmount: spec.amount }],
      total: spec.amount,
      currency: 'USD',
      dueDate,
      memo: `Thanks for working with ${state.merchant.name}.`,
      createdAt,
      sentAt: spec.status === 'SENT' || spec.status === 'PAID' ? addDays(today, -spec.daysAgo + 1).toISOString() : undefined,
      paidAt: spec.status === 'PAID' ? addDays(today, -spec.daysAgo + 8).toISOString() : undefined,
      createdBy: spec.createdBy,
    };
  });
  // Link two PAID invoices to sale transactions
  for (const inv of invoices.filter((i) => i.status === 'PAID')) {
    const match = txs.find(
      (t) => t.direction === 'in' && t.type === 'PAYMENT' && t.amount === inv.total && t.counterparty.name === inv.recipient.name,
    );
    if (match) {
      const idx = txs.findIndex((t) => t.id === match.id);
      txs[idx] = { ...txs[idx], invoiceId: inv.id };
    }
  }

  /* 6) Demo order history */
  const orders: DemoOrder[] = [
    {
      id: '5O41donor-demo-0001',
      status: 'COMPLETED',
      amount: 19.99,
      currency: 'USD',
      item: 'PayPilot sticker pack',
      buyer: 'Sandbox Buyer',
      createdAt: addDays(today, -20).toISOString(),
      capturedAt: addDays(today, -20).toISOString(),
    },
  ];

  /* 7) Risk scoring with full context */
  const buyerDisputes = new Map<string, number>();
  for (const d of disputes) buyerDisputes.set(d.buyer.email, (buyerDisputes.get(d.buyer.email) ?? 0) + 1);
  const buyerDeniedAuths = new Map<string, number>();
  for (const t of txs) {
    if ((t.status === 'VOIDED' || t.status === 'DENIED') && t.type === 'AUTHORIZATION') {
      buyerDeniedAuths.set(t.counterparty.email, (buyerDeniedAuths.get(t.counterparty.email) ?? 0) + 1);
    }
  }
  const hourKey = (iso: string) => iso.slice(0, 13);
  const buyerHour = new Map<string, number>();
  for (const t of txs) {
    const k = `${t.counterparty.email}|${hourKey(t.timestamp)}`;
    buyerHour.set(k, (buyerHour.get(k) ?? 0) + 1);
  }
  const scored = txs.map((t) => ({
    ...t,
    risk: scoreRisk(t, {
      buyerDisputeCount: buyerDisputes.get(t.counterparty.email) ?? 0,
      buyerRecentDeniedAuths: buyerDeniedAuths.get(t.counterparty.email) ?? 0,
      sameBuyerLastHourCount: buyerHour.get(`${t.counterparty.email}|${hourKey(t.timestamp)}`) ?? 0,
    }),
  }));

  state.transactions = scored.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  state.invoices = invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  state.disputes = disputes;
  state.orders = orders;
  state.approvals = [];
  state.audit = [
    {
      id: 'aud_seed_0001',
      ts: now.toISOString(),
      actor: 'system',
      action: 'seed_demo_data',
      args: { transactions: state.transactions.length, invoices: state.invoices.length, disputes: state.disputes.length },
      result: 'ok',
      detail: `Seeded ${state.transactions.length} transactions covering ${HISTORY_DAYS} days of Harbor & Pine Studio history.`,
      approved: true,
    },
  ];
  return state;
}
