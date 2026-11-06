import { useCallback, useEffect, useState } from 'react';
import { CheckSquare, Clock, Copy, FileEdit, Loader2, Scale, Sparkles, Square } from 'lucide-react';
import type { Dispute } from '@shared/types';
import { draftDispute, getDisputes, toggleEvidence, REFRESH_EVENT } from '../lib/api';
import { countdown, dateTimeLabel, money } from '../lib/format';
import { EmptyState, GenericChip, Panel, SkeletonCard } from '../components/ui';
import { useChatStore } from '../state/chat';
import { toast } from '../state/toast';

const REASON_LABEL: Record<Dispute['reason'], string> = {
  UNAUTHORIZED: 'Unauthorized transaction',
  MERCHANDISE_NOT_AS_DESCRIBED: 'Not as described',
  ITEM_NOT_RECEIVED: 'Item not received',
  DUPLICATE: 'Duplicate charge',
  REFUNDED: 'Refund not credited',
  SUBSCRIBED_UNKNOWN: 'Subscription disputed',
};

export function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const openChat = useChatStore((s) => s.setOpen);
  const send = useChatStore((s) => s.send);

  const load = useCallback(() => {
    getDisputes()
      .then(setDisputes)
      .catch((e) => toast.error('Could not load disputes', e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, [load]);

  const doDraft = async (d: Dispute) => {
    setDraftingId(d.id);
    try {
      const res = await draftDispute(d.id);
      setDrafts((prev) => ({ ...prev, [d.id]: res.draft }));
      toast.success('Draft ready', `Response drafted for ${d.id} — review before submitting.`);
    } catch (e) {
      toast.error('Draft failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDraftingId(null);
    }
  };

  const doToggle = async (d: Dispute, index: number, done: boolean) => {
    try {
      const res = await toggleEvidence(d.id, index, done);
      setDisputes((prev) =>
        prev
          ? prev.map((x) => (x.id === d.id ? { ...x, evidence: x.evidence.map((e, i) => (i === index ? { ...e, done: res.evidence[i]?.done ?? done } : e)) } : x))
          : prev,
      );
    } catch (e) {
      toast.error('Update failed', e instanceof Error ? e.message : String(e));
    }
  };

  if (!disputes) return <SkeletonCard rows={10} />;

  const open = disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW');
  const resolved = disputes.filter((d) => d.status !== 'OPEN' && d.status !== 'UNDER_REVIEW');
  const exposure = open.reduce((a, d) => a + d.amount, 0);

  if (disputes.length === 0) {
    return <EmptyState icon={<Scale size={28} />} title="No disputes" hint="Buyers love you. When one lands, PayPilot tracks deadlines and drafts your response." />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">
          {open.length} open · {money(exposure, false)} at stake
          <span className="ml-2 font-normal text-slate-500">{resolved.length} resolved historically</span>
        </h2>
        <button
          className="pp-btn-ghost text-xs"
          onClick={() => {
            openChat(true);
            void send('Any disputes needing attention?');
          }}
        >
          Ask First Mate for a briefing
        </button>
      </div>

      {open.map((d) => {
        const cd = countdown(d.respondBy);
        const doneCount = d.evidence.filter((e) => e.done).length;
        const draft = drafts[d.id] ?? d.aiDraft;
        return (
          <article key={d.id} className="pp-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-navy-900">{d.id}</span>
                  <GenericChip tone={d.status === 'OPEN' ? 'rose' : 'amber'}>{d.status.replace(/_/g, ' ')}</GenericChip>
                  <GenericChip tone="slate">{REASON_LABEL[d.reason] ?? d.reason}</GenericChip>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">
                  <span className="font-semibold text-navy-900">{money(d.amount)}</span> disputed by{' '}
                  <span className="font-medium">{d.buyer.name}</span>
                  <span className="text-slate-400"> ({d.buyer.email})</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Opened {dateTimeLabel(d.openedAt)} · linked transaction{' '}
                  <button
                    className="font-mono text-brand-600 hover:underline"
                    onClick={() => {
                      openChat(true);
                      void send(`Explain transaction ${d.transactionId}`);
                    }}
                  >
                    {d.transactionId}
                  </button>
                </p>
              </div>
              <div
                className={`flex flex-col items-center rounded-xl px-4 py-2.5 ring-1 ring-inset ${
                  cd.urgent ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : cd.soon ? 'bg-amber-50 text-amber-700 ring-amber-600/20' : 'bg-slate-50 text-slate-600 ring-slate-500/20'
                }`}
              >
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide">
                  <Clock size={11} /> Respond by
                </span>
                <span className="text-lg font-bold leading-tight">{cd.text}</span>
                <span className="text-[10px] opacity-70">{dateTimeLabel(d.respondBy)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Evidence checklist · {doneCount}/{d.evidence.length}
                </p>
                <ul className="mt-2 space-y-1">
                  {d.evidence.map((e, i) => (
                    <li key={e.label}>
                      <button className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50" onClick={() => void doToggle(d, i, !e.done)}>
                        {e.done ? <CheckSquare size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <Square size={15} className="mt-0.5 shrink-0 text-slate-300" />}
                        <span>
                          <span className={`block text-xs font-medium ${e.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{e.label}</span>
                          <span className="block text-[11px] text-slate-400">{e.hint}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <FileEdit size={12} /> AI-drafted response
                  </p>
                  <div className="flex gap-2">
                    {draft && (
                      <button
                        className="pp-btn-ghost px-2 py-1 text-[11px]"
                        onClick={() => {
                          void navigator.clipboard?.writeText(draft);
                          toast.success('Copied to clipboard');
                        }}
                      >
                        <Copy size={11} /> Copy
                      </button>
                    )}
                    <button className="pp-btn-accent px-2.5 py-1 text-[11px]" disabled={draftingId === d.id} onClick={() => void doDraft(d)}>
                      {draftingId === d.id ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {draft ? 'Redraft' : 'Draft response'}
                    </button>
                  </div>
                </div>
                {draft ? (
                  <pre className="pp-scroll mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-sans text-[11.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
                    {draft}
                  </pre>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    One click drafts a full response from the linked transaction and the reason-specific evidence strategy.
                    Drafting is local and reversible — submitting to PayPal is always a separate, manual step.
                  </p>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {resolved.length > 0 && (
        <Panel title="Resolved">
          <ul className="space-y-2 text-xs">
            {resolved.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-mono font-semibold text-slate-600">{d.id}</span>
                <span className="text-slate-500">{REASON_LABEL[d.reason] ?? d.reason}</span>
                <span className="font-medium text-slate-600">{money(d.amount, false)}</span>
                <GenericChip tone="emerald">{d.status.replace(/_/g, ' ')}</GenericChip>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
