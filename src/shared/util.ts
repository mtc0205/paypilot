/** Small pure helpers shared by server and web. No dependencies. */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Quantile (0..1) of a list. Linear interpolation, sorts a copy. Empty list -> 0. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** UTC date key: YYYY-MM-DD */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar-day arithmetic in UTC. */
export function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole calendar days from a to b (b - a), UTC based. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfUtcDay(b).getTime() - startOfUtcDay(a).getTime()) / 86_400_000);
}

export function weekdayOf(dateKeyStr: string): number {
  return new Date(`${dateKeyStr}T00:00:00Z`).getUTCDay();
}

export function fmtMoney(n: number, opts?: { cents?: boolean }): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts?.cents === false ? 0 : 2,
    maximumFractionDigits: opts?.cents === false ? 0 : 2,
  }).format(n);
}

export function fmtPct(n: number, digits = 1): string {
  return `${n >= 0 ? '' : '-'}${Math.abs(n).toFixed(digits)}%`;
}

export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Signed amount: inflows positive, outflows negative. */
export function signedAmount(direction: 'in' | 'out', amount: number): number {
  return direction === 'in' ? amount : -amount;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
