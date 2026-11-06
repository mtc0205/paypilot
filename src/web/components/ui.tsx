import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { TransactionStatus, TransactionType } from '@shared/types';
import { useToastStore } from '../state/toast';

/* ---------------------------------- Panel ------------------------------------ */

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pp-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* --------------------------------- KPI card ---------------------------------- */

export function KpiCard({
  label,
  value,
  delta,
  deltaGood,
  sub,
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  sub?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="pp-card flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold text-navy-900">{value}</p>
        {(delta || sub) && (
          <p className="mt-1 text-xs">
            {delta && (
              <span className={`font-semibold ${deltaGood ? 'text-emerald-600' : 'text-rose-600'}`}>{delta}</span>
            )}
            {sub && <span className="ml-1 text-slate-500">{sub}</span>}
          </p>
        )}
      </div>
      {icon && <div className="rounded-lg bg-navy-50 p-2 text-navy-700">{icon}</div>}
    </div>
  );
}

/* --------------------------------- Chips ------------------------------------- */

const STATUS_STYLES: Record<TransactionStatus, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  VOIDED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  DENIED: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  REVERSED: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

const TYPE_STYLES: Record<TransactionType, string> = {
  PAYMENT: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  REFUND: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  FEE: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  PAYOUT: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  SUBSCRIPTION: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  CHARGEBACK: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  AUTHORIZATION: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  TRANSFER: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function StatusChip({ status }: { status: TransactionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function TypeChip({ type }: { type: TransactionType }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TYPE_STYLES[type]}`}>
      {type}
    </span>
  );
}

export function GenericChip({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'teal' | 'navy' | 'amber' | 'rose' | 'emerald' | 'violet' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    teal: 'bg-brand-50 text-brand-700 ring-brand-600/20',
    navy: 'bg-navy-50 text-navy-700 ring-navy-600/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    rose: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

/* -------------------------------- Risk badge --------------------------------- */

export function riskTone(score: number): { bg: string; label: string } {
  if (score >= 55) return { bg: 'bg-rose-600', label: 'HIGH' };
  if (score >= 25) return { bg: 'bg-amber-500', label: 'MED' };
  if (score > 0) return { bg: 'bg-emerald-500', label: `LOW` };
  return { bg: 'bg-slate-300', label: '—' };
}

export function RiskBadge({ score, flags }: { score: number; flags?: string[] }) {
  const tone = riskTone(score);
  const tip = flags && flags.length > 0 ? flags.join(', ') : 'No fraud signals';
  return (
    <span title={tip} className="inline-flex items-center gap-1.5">
      <span className={`inline-flex h-5 min-w-[44px] items-center justify-center rounded-md px-1.5 text-[10px] font-bold tracking-wide text-white ${tone.bg}`}>
        {score > 0 ? score : ''}
      </span>
      <span className="text-[10px] font-semibold text-slate-500">{tone.label}</span>
    </span>
  );
}

/* ------------------------------ Loading / empty ------------------------------- */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} />;
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pp-card p-5">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i % 2 ? 'w-3/4' : 'w-full'}`} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      {icon && <div className="text-slate-400">{icon}</div>}
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="max-w-sm text-xs text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

/* --------------------------------- Drawer ------------------------------------ */

export function Drawer({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-navy-950/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside className={`relative flex h-full w-full ${width} animate-slide-in-right flex-col bg-white shadow-pop`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 text-sm font-semibold text-navy-900">{title}</div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="pp-scroll flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/* --------------------------------- Toasts ------------------------------------ */

export function Toasts() {
  const { toasts, dismiss } = useToastStore();
  const icons = {
    success: <CheckCircle2 size={17} className="text-emerald-500" />,
    error: <XCircle size={17} className="text-rose-500" />,
    info: <Info size={17} className="text-sky-500" />,
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex animate-slide-in items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-pop">
          <div className="mt-0.5">{icons[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-navy-900">{t.title}</p>
            {t.detail && <p className="mt-0.5 break-words text-xs text-slate-500">{t.detail}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SeverityDot({ severity }: { severity: 'info' | 'warning' | 'critical' }) {
  const color = severity === 'critical' ? 'bg-rose-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

export function AlertIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-500" />;
  return <Info size={15} className="mt-0.5 shrink-0 text-sky-500" />;
}
