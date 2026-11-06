import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { Bot, ScrollText, ShieldCheck, User, Cpu } from 'lucide-react';
import type { AuditEntry } from '@shared/types';
import { getApprovals, getAudit, REFRESH_EVENT } from '../lib/api';
import { dateTimeLabel, timeAgo } from '../lib/format';
import { Drawer, EmptyState, GenericChip, SkeletonCard } from '../components/ui';

ModuleRegistry.registerModules([AllCommunityModule]);

const auditTheme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 12.5,
  headerBackgroundColor: '#0c1c31',
  headerTextColor: '#e2ecf6',
  oddRowBackgroundColor: '#f8fafc',
  rowHoverColor: '#effcf9',
  accentColor: '#0da49e',
  borderColor: '#e2e8f0',
  cellHorizontalPadding: 12,
  rowHeight: 38,
  headerHeight: 40,
});

function ActorCell(p: ICellRendererParams<AuditEntry>) {
  const e = p.data;
  if (!e) return null;
  const cfg =
    e.actor === 'agent'
      ? { tone: 'violet' as const, icon: <Bot size={11} /> }
      : e.actor === 'human'
        ? { tone: 'teal' as const, icon: <User size={11} /> }
        : { tone: 'slate' as const, icon: <Cpu size={11} /> };
  return (
    <GenericChip tone={cfg.tone}>
      <span className="flex items-center gap-1">
        {cfg.icon}
        {e.actor}
      </span>
    </GenericChip>
  );
}

function ResultCell(p: ICellRendererParams<AuditEntry>) {
  const e = p.data;
  if (!e) return null;
  const tone = e.result === 'ok' ? 'emerald' : e.result === 'pending' ? 'amber' : 'rose';
  return <GenericChip tone={tone}>{e.result}</GenericChip>;
}

function ApprovalCell(p: ICellRendererParams<AuditEntry>) {
  const e = p.data;
  if (!e) return null;
  if (!e.approved) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
      <ShieldCheck size={12} />
      {e.approver ?? 'human'}
    </span>
  );
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const gridRef = useRef<AgGridReact<AuditEntry>>(null);

  const load = useCallback(() => {
    getAudit().then((r) => setEntries(r.rows)).catch(() => setEntries([]));
    getApprovals('pending').then((r) => setPendingApprovals(r.rows.length)).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [load]);

  const columnDefs = useMemo<ColDef<AuditEntry>[]>(
    () => [
      { headerName: 'Time', field: 'ts', sortable: true, sort: 'desc', width: 168,
        valueFormatter: (p) => (p.value ? dateTimeLabel(p.value) : '') },
      { headerName: 'Actor', field: 'actor', cellRenderer: ActorCell, width: 112, filter: 'agSetColumnFilter' },
      { headerName: 'Action', field: 'action', width: 178, filter: true, cellClass: 'font-mono text-[12px] text-navy-900' },
      { headerName: 'Detail', field: 'detail', flex: 1.8, minWidth: 240, tooltipField: 'detail' },
      { headerName: 'Result', field: 'result', cellRenderer: ResultCell, width: 104, filter: 'agSetColumnFilter' },
      { headerName: 'Approved by', cellRenderer: ApprovalCell, width: 130 },
    ],
    [],
  );

  if (!entries) return <SkeletonCard rows={8} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-navy-900">
          Every agent action, human decision, and system event
          <span className="ml-2 font-normal text-slate-500">{entries.length} entries</span>
        </h2>
        {pendingApprovals > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
            <ShieldCheck size={12} /> {pendingApprovals} pending approval{pendingApprovals === 1 ? '' : 's'} — decide in chat
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={<ScrollText size={26} />} title="Audit log empty" hint="Ask First Mate to create an invoice — the approval dance lands here." />
      ) : (
        <div className="pp-card overflow-hidden">
          <div className="h-[600px]">
            <AgGridReact<AuditEntry>
              ref={gridRef}
              theme={auditTheme}
              columnDefs={columnDefs}
              rowData={entries}
              defaultColDef={{ resizable: true, sortable: true }}
              pagination
              paginationPageSize={25}
              onRowClicked={(e) => setSelected(e.data ?? null)}
            />
          </div>
        </div>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.action} · ${timeAgo(selected.ts)}` : ''} width="max-w-xl">
        {selected && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div>
                <p className="text-slate-400">Time</p>
                <p className="mt-0.5 font-medium text-navy-900">{dateTimeLabel(selected.ts)}</p>
              </div>
              <div>
                <p className="text-slate-400">Actor</p>
                <p className="mt-0.5 font-medium text-navy-900">{selected.actor}</p>
              </div>
              <div>
                <p className="text-slate-400">Result</p>
                <p className="mt-0.5 font-medium text-navy-900">{selected.result}</p>
              </div>
              <div>
                <p className="text-slate-400">Approved by</p>
                <p className="mt-0.5 font-medium text-navy-900">{selected.approver ?? '—'}</p>
              </div>
            </div>
            {selected.detail && (
              <div>
                <p className="mb-1 font-bold uppercase tracking-wide text-slate-400">Detail</p>
                <p className="rounded-lg bg-slate-50 p-3 leading-relaxed text-slate-700">{selected.detail}</p>
              </div>
            )}
            <div>
              <p className="mb-1 font-bold uppercase tracking-wide text-slate-400">Arguments</p>
              <pre className="pp-scroll max-h-72 overflow-auto rounded-lg bg-navy-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {JSON.stringify(selected.args, null, 2)}
              </pre>
            </div>
            {selected.relatedId && (
              <p className="font-mono text-[11px] text-slate-400">related: {selected.relatedId}</p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
