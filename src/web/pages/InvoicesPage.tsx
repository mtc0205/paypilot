import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { FileText, Loader2, Send, Sparkles, Wand2 } from 'lucide-react';
import type { Invoice, ParsedInvoiceDraft } from '@shared/types';
import { createInvoice, getInvoices, markInvoicePaid, parseInvoice, REFRESH_EVENT, sendInvoice } from '../lib/api';
import { dayLabel, money } from '../lib/format';
import { EmptyState, GenericChip, SkeletonCard } from '../components/ui';
import { toast } from '../state/toast';

ModuleRegistry.registerModules([AllCommunityModule]);

const invoiceTheme = themeQuartz.withParams({
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

const STATUS_TONE: Record<Invoice['status'], 'slate' | 'teal' | 'amber' | 'emerald' | 'rose' | 'violet'> = {
  DRAFT: 'slate',
  SENT: 'teal',
  PAID: 'emerald',
  MARKED_AS_PAID: 'emerald',
  CANCELLED: 'rose',
  REFUNDED: 'violet',
};

function StatusCell(p: ICellRendererParams<Invoice>) {
  return p.data ? <GenericChip tone={STATUS_TONE[p.data.status]}>{p.data.status.replace(/_/g, ' ')}</GenericChip> : null;
}

function ItemsCell(p: ICellRendererParams<Invoice>) {
  const inv = p.data;
  if (!inv) return null;
  const first = inv.items[0];
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="truncate font-medium text-navy-900">{first?.name ?? 'Services'}</span>
      {inv.items.length > 1 && <span className="text-[10.5px] text-slate-400">+{inv.items.length - 1} more item(s)</span>}
      {first && first.quantity > 1 && <span className="text-[10.5px] text-slate-400">×{first.quantity} @ {money(first.unitAmount)}</span>}
    </div>
  );
}

function DueCell(p: ICellRendererParams<Invoice>) {
  const inv = p.data;
  if (!inv) return null;
  const overdue = (inv.status === 'SENT' || inv.status === 'DRAFT') && new Date(`${inv.dueDate}T23:59:59Z`).getTime() < Date.now();
  return (
    <span className={overdue ? 'font-semibold text-rose-600' : 'text-slate-600'}>
      {dayLabel(inv.dueDate)}
      {overdue && ' · overdue'}
    </span>
  );
}

function CreatedByCell(p: ICellRendererParams<Invoice>) {
  return p.data ? <GenericChip tone={p.data.createdBy === 'agent' ? 'violet' : 'slate'}>{p.data.createdBy}</GenericChip> : null;
}

function ActionsCell(p: ICellRendererParams<Invoice>) {
  const inv = p.data;
  const refresh = p.context?.refresh as (() => void) | undefined;
  const [busy, setBusy] = useState<string | null>(null);
  if (!inv) return null;
  const act = async (kind: 'send' | 'paid') => {
    setBusy(kind);
    try {
      if (kind === 'send') {
        await sendInvoice(inv.id);
        toast.success('Invoice sent', `${inv.number} emailed to ${inv.recipient.email}`);
      } else {
        await markInvoicePaid(inv.id);
        toast.success('Marked paid', `${inv.number} settled — ledger updated`);
      }
      refresh?.();
    } catch (e) {
      toast.error('Action failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex h-full items-center gap-1.5">
      {inv.status === 'DRAFT' && (
        <button className="pp-btn-accent px-2 py-0.5 text-[11px]" disabled={busy !== null} onClick={() => void act('send')}>
          {busy === 'send' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send
        </button>
      )}
      {inv.status === 'SENT' && (
        <button className="pp-btn-ghost px-2 py-0.5 text-[11px]" disabled={busy !== null} onClick={() => void act('paid')}>
          {busy === 'paid' ? <Loader2 size={11} className="animate-spin" /> : null} Mark paid
        </button>
      )}
    </div>
  );
}

/* --------------------------------- Composer ---------------------------------- */

const EXAMPLES = [
  'Invoice Jane Doe $280 for design retainer, due in 14 days',
  'Invoice Acme Corp $420 for consulting, due in 14 days',
  'Send an invoice to Marcus Chen for $1,200.50, due next week',
  'Bill Bright Loop Coffee $650 for monthly retainer, due in 30 days',
];

function Composer({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState(EXAMPLES[0]);
  const [draft, setDraft] = useState<ParsedInvoiceDraft | null>(null);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);

  const doParse = async () => {
    setParsing(true);
    try {
      const res = await parseInvoice(text);
      setDraft(res.draft);
    } catch (e) {
      setDraft(null);
      toast.error('Could not parse', e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const doCreate = async () => {
    if (!draft) return;
    setCreating(true);
    try {
      const inv = await createInvoice({
        recipientName: draft.recipientName ?? 'Customer',
        recipientEmail: draft.recipientEmail,
        item: draft.itemName,
        amount: draft.amount,
        dueDays: draft.dueDays,
        memo: draft.memo,
      });
      toast.success('Invoice created', `${inv.number} · ${money(inv.total)} to ${inv.recipient.name} (DRAFT)`);
      setDraft(null);
      onCreated();
    } catch (e) {
      toast.error('Create failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="pp-card p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600">
          <Wand2 size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-navy-900">Compose in plain English</h2>
          <p className="text-xs text-slate-500">Parsed by the deterministic NL parser — the same one the First Mate agent uses.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doParse()}
          placeholder="Invoice Jane Doe $280 for design retainer, due in 14 days"
          className="pp-input"
        />
        <button className="pp-btn-primary shrink-0" onClick={() => void doParse()} disabled={parsing}>
          {parsing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Parse
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 hover:border-brand-400 hover:text-brand-700" onClick={() => setText(ex)}>
            {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
          </button>
        ))}
      </div>

      {draft && (
        <div className="mt-4 animate-slide-in rounded-xl border border-brand-200 bg-brand-50/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-800">Preview · confidence {(draft.confidence * 100).toFixed(0)}%</p>
            <button className="pp-btn-ghost px-2 py-1 text-[11px]" onClick={() => setDraft(null)}>Discard</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
            <Field label="Recipient" value={draft.recipientName ?? '— (unnamed)'} />
            <Field label="Email" value={draft.recipientEmail ?? '—'} />
            <Field label="Amount" value={`${money(draft.amount)}${draft.quantity > 1 ? ` × ${draft.quantity}` : ''}`} />
            <Field label="Line item" value={draft.itemName} />
            <Field label="Due in" value={`${draft.dueDays} days`} />
            <Field label="Memo" value={draft.memo ?? '—'} />
          </div>
          {draft.notes.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">⚠ {draft.notes.join(' · ')}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button className="pp-btn-accent" onClick={() => void doCreate()} disabled={creating}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Create PayPal invoice (DRAFT)
            </button>
            <span className="text-[11px] text-slate-500">Human-initiated action — audit-logged as you.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 font-medium text-navy-900">{value}</p>
    </div>
  );
}

/* ----------------------------------- Page ------------------------------------- */

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const gridRef = useRef<AgGridReact<Invoice>>(null);

  const load = useCallback(() => {
    getInvoices()
      .then(setInvoices)
      .catch((e) => toast.error('Could not load invoices', e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [load]);

  const columnDefs = useMemo<ColDef<Invoice>[]>(
    () => [
      { headerName: 'Number', field: 'number', width: 128, filter: true, cellClass: 'font-mono text-[12px] font-semibold text-navy-900' },
      { headerName: 'Recipient', field: 'recipient.name', flex: 1.4, minWidth: 160, filter: true,
        cellRenderer: (p: ICellRendererParams<Invoice>) => (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium text-navy-900">{p.data?.recipient.name}</span>
            <span className="truncate text-[10.5px] text-slate-400">{p.data?.recipient.email}</span>
          </div>
        ) },
      { headerName: 'Items', flex: 1.5, minWidth: 170, cellRenderer: ItemsCell },
      { headerName: 'Total', field: 'total', width: 108, sortable: true, headerClass: 'ag-right-aligned-header', cellClass: 'text-right font-mono font-semibold text-navy-900 tabular-nums', filter: 'agNumberColumnFilter',
        valueFormatter: (p) => money(Number(p.value ?? 0)) },
      { headerName: 'Due', field: 'dueDate', width: 118, sortable: true, cellRenderer: DueCell, filter: 'agDateColumnFilter' },
      { headerName: 'Status', field: 'status', width: 118, cellRenderer: StatusCell, filter: 'agSetColumnFilter' },
      { headerName: 'By', field: 'createdBy', width: 92, cellRenderer: CreatedByCell },
      { headerName: 'Actions', width: 122, sortable: false, filter: false, cellRenderer: ActionsCell },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true }), []);

  if (!invoices) return <SkeletonCard rows={8} />;

  const outstanding = invoices.filter((i) => i.status === 'SENT').reduce((a, i) => a + i.total, 0);

  return (
    <div className="space-y-4">
      <Composer onCreated={load} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">
          {invoices.length} invoices · {money(outstanding, false)} outstanding
        </h2>
      </div>

      {invoices.length === 0 ? (
        <EmptyState icon={<FileText size={26} />} title="No invoices yet" hint="Use the composer above, or ask First Mate: “invoice Acme $420 for consulting”." />
      ) : (
        <div className="pp-card overflow-hidden">
          <div className="h-[400px]">
            <AgGridReact<Invoice>
              ref={gridRef}
              theme={invoiceTheme}
              columnDefs={columnDefs}
              rowData={invoices}
              defaultColDef={defaultColDef}
              pagination
              paginationPageSize={10}
              context={{ refresh: load }}
            />
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Send buttons are direct human actions (audit-logged). The agent path is gated differently: it must ask for approval
        via an approval card before anything is created or sent.
      </p>
    </div>
  );
}
