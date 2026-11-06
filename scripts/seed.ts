/**
 * Seed CLI — regenerates data/state.json deterministically.
 * (The server also auto-seeds on first boot in mock mode; this script is for
 * explicit resets: `npm run seed`.)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSeed } from '../src/server/paypal/seed.js';
import { Store, emptyState } from '../src/server/store/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_FILE ?? path.resolve(here, '../data/state.json');

const now = new Date();
const state = generateSeed({ now });
const store = new Store(dataFile);
store.reset({ ...emptyState(), ...state });

const txs = state.transactions;
const inflow = txs.filter((t) => t.direction === 'in' && t.status === 'COMPLETED').reduce((a, t) => a + t.amount, 0);
const outflow = txs.filter((t) => t.direction === 'out' && t.status === 'COMPLETED').reduce((a, t) => a + t.amount, 0);
const fraud = txs.filter((t) => t.type === 'AUTHORIZATION' && (t.status === 'VOIDED' || t.status === 'DENIED')).length;

console.log(`PayPilot seed written to ${dataFile}`);
console.log(`  transactions : ${txs.length}`);
console.log(`  inflow total : $${Math.round(inflow).toLocaleString()}`);
console.log(`  outflow total: $${Math.round(outflow).toLocaleString()}`);
console.log(`  invoices     : ${state.invoices.length}`);
console.log(`  disputes     : ${state.disputes.length} (deadlines: ${state.disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW').map((d) => `${d.id} +${Math.ceil((new Date(d.respondBy).getTime() - now.getTime()) / 86400000)}d`).join(', ')})`);
console.log(`  fraud auths  : ${fraud} (card-testing burst)`);
console.log(`  generated at : ${now.toISOString()}`);
