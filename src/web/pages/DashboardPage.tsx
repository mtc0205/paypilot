import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CalendarClock, Scale, Users } from 'lucide-react';
import type { InsightAlert } from '@shared/types';
import { getOverview, type OverviewResponse } from '../lib/api';
import { money, pct } from '../lib/format';
import { AlertIcon, EmptyState, KpiCard, Panel, SeverityDot, SkeletonCard } from '../components/ui';
import { CashflowChart } from '../components/CashflowChart';
import { useChatStore } from '../state/chat';

const SEVERITY_BORDER: Record<InsightAlert['severity'], string> = {
  critical: 'border-l-rose-500',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-400',
};

export function DashboardPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openChat = useChatStore((s) => s.setOpen);
  const send = useChatStore((s) => s.send);

  const load = useCallback(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <EmptyState icon={<AlertTriangle size={28} />} title="Could not load dashboard" hint={error} />;
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} rows={2} />
          ))}
        </div>
        <SkeletonCard rows={9} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard rows={6} />
          <SkeletonCard rows={6} />
        </div>
      </div>
    );
  }

  const { kpis, forecast } = data;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label="Net today"
          value={money(kpis.netToday, false)}
          sub="settled so far"
          icon={<Banknote size={18} />}
        />
        <KpiCard
          label="Net · 30 days"
          value={money(kpis.net30d, false)}
          delta={pct(kpis.net30dDeltaPct)}
          deltaGood={kpis.net30dDeltaPct >= 0}
          sub="vs prior 30d"
          icon={kpis.net30dDeltaPct >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
        />
        <KpiCard label="MRR (detected)" value={money(kpis.mrr, false)} sub={`${kpis.activeSubscriptions} recurring series`} icon={<CalendarClock size={18} />} />
        <KpiCard
          label="Dispute rate"
          value={`${kpis.disputeRate.toFixed(2)}%`}
          sub={`${kpis.openDisputes} open · 90d window`}
          icon={<Scale size={18} />}
        />
        <KpiCard
          label="Critical alerts"
          value={String(kpis.criticalAlerts)}
          sub={kpis.criticalAlerts > 0 ? 'need attention' : 'all clear'}
          icon={<AlertTriangle size={18} />}
        />
      </div>

      {/* Cash-flow chart */}
      <Panel
        title={
          <span className="flex items-baseline gap-2">
            Cash flow · net per day
            <span className="text-xs font-normal text-slate-500">
              next 30d forecast {money(forecast.expectedTotal, false)}{' '}
              <span className="text-slate-400">
                (80% band {money(forecast.lowTotal, false)} – {money(forecast.highTotal, false)}, trend{' '}
                {forecast.slopePerDay >= 0 ? '+' : '−'}
                {money(Math.abs(forecast.slopePerDay), false)}/day)
              </span>
            </span>
          </span>
        }
      >
        <CashflowChart series={data.series} forecast={forecast.points} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Alert feed */}
        <Panel
          title={`Alert feed · ${data.alerts.length}`}
          className="lg:col-span-2"
          actions={
            <button
              className="text-xs font-semibold text-brand-600 hover:text-brand-700"
              onClick={() => {
                openChat(true);
                void send("What's happening with my money?");
              }}
            >
              Ask First Mate →
            </button>
          }
        >
          {data.alerts.length === 0 ? (
            <EmptyState title="No alerts" hint="The insight engine has nothing to flag — quiet seas." />
          ) : (
            <ul className="space-y-2.5">
              {data.alerts.map((a) => (
                <li key={a.id} className={`rounded-lg border border-slate-100 border-l-[3px] bg-slate-50/50 px-3.5 py-2.5 ${SEVERITY_BORDER[a.severity]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-semibold text-navy-900">{a.title}</p>
                    <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-slate-400">
                      <SeverityDot severity={a.severity} />
                      {a.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.detail}</p>
                  {a.transactionIds && a.transactionIds.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-slate-400">linked: {a.transactionIds.slice(0, 4).join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {/* Top customers */}
          <Panel title={<span className="flex items-center gap-2"><Users size={15} className="text-navy-700" /> Customer concentration · 90d</span>}>
            <ul className="space-y-2.5">
              {data.customers.slice(0, 5).map((c) => (
                <li key={c.name}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="truncate font-medium text-slate-700">{c.name}</span>
                    <span className="ml-2 shrink-0 text-slate-500">
                      {money(c.revenue90d, false)} · {c.share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${c.share >= 12 ? 'bg-amber-500' : 'bg-navy-400'}`}
                      style={{ width: `${Math.min(c.share * 4, 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Subscriptions */}
          <Panel title={`Recurring · ${data.subscriptions.length} detected`}>
            <ul className="space-y-1.5">
              {data.subscriptions.slice(0, 7).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.direction === 'in' ? 'bg-brand-500' : 'bg-slate-400'}`} />
                    <span className="truncate font-medium text-slate-700">{s.counterparty}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">
                    {money(s.amount, false)}/{Math.round(s.cadenceDays)}d
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-400">
              Detected by the subscription engine (amount tolerance + cadence regularity) — not the LLM. Teal = revenue in,
              grey = expenses.
            </p>
          </Panel>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <AlertIcon severity="info" /> Insights computed by the deterministic engine on every page load — numbers are auditable,
        not generated.
      </p>
    </div>
  );
}
