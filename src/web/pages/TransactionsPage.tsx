import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type CellClassParams, type CellClickedEvent, type ColDef, type ICellRendererParams, type ValueFormatterParams } from 'ag-grid-community';
import { ArrowLeftRight, Bot, Loader2, Search, Sparkles } from 'lucide-react';
import type { Transaction } from '@shared/types';
import { explainTransaction, getTransactions, REFRESH_EVENT } from '../lib/api';
import { dateTimeLabel, money } from '../lib/format';
import { Drawer, EmptyState, GenericChip, RiskBadge, SkeletonCard, StatusChip, TypeChip } from '../components/ui';
import { useChatStore } from '../state/chat';
import { toast } from '../state/toast';

ModuleRegistry.registerModules([AllCommunityModule]);

const ppTheme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 12.5,
  headerBackgroundColor: '#0c1c31',
  headerTextColor: '#e2ecf6',
  headerColumnBorder: { style: 'solid', color: '#234061' },
  headerRowBorder: { style: 'solid', color: '#234061', width: 1 },
  oddRowBackgroundColor: '#f8fafc',
  rowHoverColor: '#effcf9',
  accentColor: '#0da49e',
  borderColor: '#e2e8f0',
  wrapperBorder: { style: 'solid', color: '#e2e8f0', width: 1 },
  cellHorizontalPadding: 12,
  rowHeight: 38,
  headerHeight: 40,
});

/* ------------------------------ Cell renderers -------------------------------- */

function PartyCell(p: ICellRendererParams<Transaction>) {
  const tx = p.data;
  if (!tx) return null;
  return (
    <div className="flex min-w-0 flex-col justify-center leading-tight">
      <span className="truncate font-medium text-navy-900">{tx.counterparty.name}</span>
      <span className="truncate text-[10.5px] text-slate-400">{tx.counterparty.email}</span>
    </div>
  );
}

function AmountCell(p: ICellRendererParams<Transaction>) {
  const tx = p.data;
  if (!tx) return null;
  const positive = tx.direction === 'in';
  return (
    <span className={`font-mono text-[13px] font-semibold tabular-nums ${positive ? 'text-emerald-700' : 'text-slate-600'}`}>
      {positive ? '+' : '−'}
      {money(tx.amount).replace('-', '')}
    </span>
  );
}

function RiskCell(p: ICellRendererParams<Transaction>) {
  const tx = p.data;
  if (!tx) return null;
  return <RiskBadge score={tx.risk.score} flags={tx.risk.flags} />;
}

function TypeCell(p: ICellRendererParams<Transaction>) {
  return p.data ? <TypeChip type={p.data.type} /> : null;
}

function StatusCell(p: ICellRendererParams<Transaction>) {
  return p.data ? <StatusChip status={p.data.status} /> : null;
}

/* --------------------------------- Page --------------------------------------- */

export function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [explanation, setExplanation] = useState<{ summary: string; bullets: string[] } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [quickFilter, setQuickFilter] = useState('');
  const gridRef = useRef<AgGridReact<Transaction>>(null);
  const openChat = useChatStore((s) => s.setOpen);
  const send = useChatStore((s) => s.send);

  const load = useCallback(() => {
    getTransactions()
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [load]);

  const columnDefs = useMemo<ColDef<Transaction>[]>(
    () => [
      {
        headerName: 'Date',
        field: 'timestamp',
        sortable: true,
        sort: 'desc',
        width: 150,
        valueFormatter: (p: ValueFormatterParams<Transaction>) => (p.value ? dateTimeLabel(p.value) : ''),
        filter: 'agDateColumnFilter',
        filterParams: { comparator: (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime() },
      },
      { headerName: 'Counterparty', field: 'counterparty.name', cellRenderer: PartyCell, flex: 2.1, minWidth: 200, filter: true },
      { headerName: 'Description', field: 'description', flex: 1.9, minWidth: 170, tooltipField: 'description', filter: true },
      { headerName: 'Category', field: 'category', width: 140, filter: 'agSetColumnFilter' },
      { headerName: 'Type', field: 'type', cellRenderer: TypeCell, width: 122, filter: 'agSetColumnFilter' },
      { headerName: 'Status', field: 'status', cellRenderer: StatusCell, width: 112, filter: 'agSetColumnFilter' },
      {
        headerName: 'Amount',
        field: 'amount',
        sortable: true,
        width: 118,
        cellRenderer: AmountCell,
        cellClass: (p: CellClassParams) => (p.data?.direction === 'in' ? 'text-right' : 'text-right'),
        headerClass: 'ag-right-aligned-header',
        filter: 'agNumberColumnFilter',
      },
      { headerName: 'Risk', field: 'risk.score', sortable: true, width: 96, cellRenderer: RiskCell, filter: 'agNumberColumnFilter' },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ resizable: true, sortable: true, filter: true, menuTabs: ['filterMenuTab', 'generalMenuTab'] }),
    [],
  );

  const onQuickFilter = (value: string) => {
    setQuickFilter(value);
    gridRef.current?.api.updateGridOptions({ quickFilterText: value });
  };

  const openDetail = async (tx: Transaction) => {
    setSelected(tx);
    setExplanation(null);
  };

  const explain = async (id: string) => {
    setExplaining(true);
    try {
      setExplanation(await explainTransaction(id));
    } catch (e) {
      toast.error('Explain failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExplaining(false);
    }
  };

  if (error) return <EmptyState title="Could not load transactions" hint={error} />;
  if (!rows) return <SkeletonCard rows={12} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">
            Ledger · {rows.length.toLocaleString()} transactions
            <span className="ml-2 font-normal text-slate-500">
              net{' '}
              {money(
                rows.reduce((acc, t) => acc + (t.direction === 'in' ? t.amount : -t.amount), 0),
                false,
              )}
            </span>
          </h2>
          <p className="text-xs text-slate-500">14 months of history · click a row for risk stats and a plain-language explanation</p>
        </div>
        <div className="relative w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={quickFilter}
            onChange={(e) => onQuickFilter(e.target.value)}
            placeholder="Quick filter — try “northwind”, “refund”, “card”…"
            className="pp-input pl-9"
            data-testid="quick-filter"
          />
        </div>
      </div>

      <div className="pp-card overflow-hidden">
        <div className="h-[620px]">
          <AgGridReact<Transaction>
            ref={gridRef}
            theme={ppTheme}
            columnDefs={columnDefs}
            rowData={rows}
            defaultColDef={defaultColDef}
            pagination
            paginationPageSize={25}
            paginationPageSizeSelector={[25, 50, 100]}
            rowSelection={{ mode: 'singleRow', enableClickSelection: true }}
            onCellClicked={(e: CellClickedEvent<Transaction>) => {
              if (e.rowPinned !== 'top' && e.data) void openDetail(e.data);
            }}
            tooltipShowDelay={300}
          />
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Transaction ${selected.id}` : ''}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between">
              <p className={`font-mono text-3xl font-bold ${selected.direction === 'in' ? 'text-emerald-700' : 'text-slate-700'}`}>
                {selected.direction === 'in' ? '+' : '−'}
                {money(selected.amount)}
              </p>
              <div className="flex gap-1.5">
                <TypeChip type={selected.type} />
                <StatusChip status={selected.status} />
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-xs">
              <div>
                <dt className="text-slate-400">Counterparty</dt>
                <dd className="mt-0.5 font-medium text-navy-900">{selected.counterparty.name}</dd>
                <dd className="text-slate-500">{selected.counterparty.email}</dd>
              </div>
              <div>
                <dt className="text-slate-400">When</dt>
                <dd className="mt-0.5 font-medium text-navy-900">{dateTimeLabel(selected.timestamp)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Method / category</dt>
                <dd className="mt-0.5 font-medium text-navy-900">
                  {selected.method.toUpperCase()} · {selected.category}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Risk</dt>
                <dd className="mt-1"><RiskBadge score={selected.risk.score} flags={selected.risk.flags} /></dd>
                {selected.risk.flags.length > 0 && <dd className="mt-1 leading-relaxed text-slate-500">{selected.risk.flags.join(' · ')}</dd>}
              </div>
              {selected.invoiceId && (
                <div>
                  <dt className="text-slate-400">Invoice</dt>
                  <dd className="mt-0.5 font-mono text-navy-900">{selected.invoiceId}</dd>
                </div>
              )}
              {selected.disputeId && (
                <div>
                  <dt className="text-slate-400">Dispute</dt>
                  <dd className="mt-0.5 font-mono text-rose-600">{selected.disputeId}</dd>
                </div>
              )}
            </dl>

            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-800">
                  <Sparkles size={13} /> Explain this
                </p>
                <div className="flex gap-2">
                  <button className="pp-btn-ghost px-2.5 py-1 text-xs" onClick={() => void explain(selected.id)} disabled={explaining}>
                    {explaining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Insight engine
                  </button>
                  <button
                    className="pp-btn-ghost px-2.5 py-1 text-xs"
                    onClick={() => {
                      setSelected(null);
                      openChat(true);
                      void send(`Explain transaction ${selected.id}`);
                    }}
                  >
                    <Bot size={12} /> Ask First Mate
                  </button>
                </div>
              </div>
              {explanation ? (
                <div className="mt-3">
                  <p className="text-xs font-medium leading-relaxed text-navy-900">{explanation.summary}</p>
                  <ul className="mt-2 space-y-1.5">
                    {explanation.bullets.map((b, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-brand-700/70">Generated by deterministic math (robust z-scores, cadence stats) — zero LLM calls.</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Deterministic explanation from the insight engine — statistical context, counterparty history, risk signals.</p>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <ArrowLeftRight size={12} /> Raw: <code className="font-mono">{selected.id}</code>
              <GenericChip tone="slate">{selected.currency}</GenericChip>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
