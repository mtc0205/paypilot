export function money(n: number, cents = true): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}

export function signedMoney(n: number, cents = true): string {
  return `${n >= 0 ? '+' : '−'}${money(Math.abs(n), cents)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 7" from a UTC date key (YYYY-MM-DD) — no timezone drift. */
export function dayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "3d left" / "31h left" countdown for dispute deadlines. */
export function countdown(iso: string, now = Date.now()): { text: string; urgent: boolean; soon: boolean } {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return { text: 'overdue', urgent: true, soon: true };
  const days = Math.floor(diff / 86_400_000);
  if (days >= 2) return { text: `${days}d left`, urgent: false, soon: days <= 7 };
  const hours = Math.max(1, Math.round(diff / 3_600_000));
  return { text: `${hours}h left`, urgent: hours <= 48, soon: true };
}

export function pct(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
}
