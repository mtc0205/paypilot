import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Send,
  ShieldAlert,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { useChatStore } from '../state/chat';
import type { ApprovalCard as ApprovalCardData, ToolCard as ToolCardData } from '../state/chat';

const SUGGESTIONS = [
  "What's happening with my money?",
  'Invoice Acme $420 for consulting, due in 14 days',
  'Any disputes needing attention?',
  'Forecast next 30 days',
];

const TOOL_ICONS: Record<string, string> = {
  search_transactions: 'Search',
  get_cashflow_summary: 'Cash summary',
  forecast_cashflow: 'Forecast',
  detect_anomalies: 'Anomalies',
  list_disputes: 'Disputes',
  draft_dispute_response: 'Draft dispute',
  create_invoice: 'Create invoice',
  send_invoice: 'Send invoice',
  explain_transaction: 'Explain tx',
};

function ToolResultCard({ card }: { card: ToolCardData }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_ICONS[card.tool] ?? card.tool;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 text-left">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        {card.status === 'running' ? (
          <Loader2 size={14} className="animate-spin text-brand-600" />
        ) : card.status === 'ok' ? (
          <Wrench size={14} className="text-brand-600" />
        ) : (
          <X size={14} className="text-rose-500" />
        )}
        <span className="text-xs font-semibold text-navy-800">{label}</span>
        <span className={`ml-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${card.status === 'running' ? 'bg-slate-200 text-slate-500' : card.status === 'ok' ? 'bg-brand-100 text-brand-800' : 'bg-rose-100 text-rose-700'}`}>
          {card.tool}
        </span>
        {card.summary && <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{card.summary}</span>}
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-2">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-slate-400">arguments</p>
          <pre className="max-h-32 overflow-auto rounded bg-white p-2 font-mono text-[11px] text-slate-600">{JSON.stringify(card.args, null, 2)}</pre>
          <p className="mb-1 mt-2 font-mono text-[10px] uppercase tracking-wide text-slate-400">result</p>
          <pre className="max-h-52 overflow-auto rounded bg-white p-2 font-mono text-[11px] text-slate-600">
            {card.data === undefined ? '…' : JSON.stringify(card.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ card }: { card: ApprovalCardData }) {
  const decide = useChatStore((s) => s.decide);
  const [busy, setBusy] = useState(false);
  const decided = card.status !== 'pending';
  const amount = typeof card.args.amount === 'number' ? card.args.amount : null;
  const recipient = typeof card.args.recipient === 'string' ? card.args.recipient : null;

  return (
    <div className={`rounded-lg border p-3 text-left ${decided ? (card.status === 'approved' ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-300 bg-slate-100') : 'border-amber-300 bg-amber-50/70'}`}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={15} className={decided ? 'text-emerald-600' : 'text-amber-600'} />
        <span className="text-xs font-bold uppercase tracking-wide text-navy-900">Approval required · {TOOL_ICONS[card.tool] ?? card.tool}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{card.rationale}</p>
      {(amount !== null || recipient) && (
        <p className="mt-1.5 font-mono text-[11px] text-slate-500">
          {recipient && <>to {recipient} </>}
          {amount !== null && <>· ${amount.toFixed(2)}</>}
        </p>
      )}
      {!decided ? (
        <div className="mt-3 flex gap-2">
          <button
            className="pp-btn-accent flex-1 py-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await decide(card.approvalId, 'approve');
              setBusy(false);
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve &amp; execute
          </button>
          <button
            className="pp-btn-ghost flex-1 py-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await decide(card.approvalId, 'reject');
              setBusy(false);
            }}
          >
            <X size={14} />
            Reject
          </button>
        </div>
      ) : (
        <p className={`mt-2 text-xs font-semibold ${card.status === 'approved' ? 'text-emerald-700' : 'text-slate-500'}`}>
          {card.status === 'approved' ? `Executed — ${card.resultSummary ?? 'done'}` : 'Rejected — nothing was executed'}
        </p>
      )}
    </div>
  );
}

export function ChatDrawer({ aiProvider }: { aiProvider: string }) {
  const { open, messages, sending, setOpen, send } = useChatStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  if (!open) return null;

  const submit = async () => {
    const text = input;
    setInput('');
    await send(text);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-navy-950/30 backdrop-blur-[1px]" onClick={() => setOpen(false)} aria-hidden />
      <aside className="relative flex h-full w-full max-w-[440px] animate-slide-in-right flex-col bg-white shadow-pop">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600">
            <Bot size={19} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-navy-900">First Mate</p>
            <p className="text-[11px] text-slate-500">
              Agent copilot · {aiProvider === 'mock' ? 'deterministic mock AI (no key)' : aiProvider}
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close chat">
            <X size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="pp-scroll flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-4">
          {messages.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-navy-900">
                <Sparkles size={15} className="text-brand-500" />
                <p className="text-sm font-semibold">Ask me about your money.</p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                I read your ledger with real math (no LLM needed) and can act — creating or sending invoices always
                requires your explicit approval first.
              </p>
              <div className="mt-3 space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-medium text-navy-800 transition hover:border-brand-400 hover:bg-brand-50/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-xl rounded-br-sm bg-navy-900 px-3.5 py-2.5 text-sm text-white">
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start">
                <div className="w-full max-w-[95%] space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-500/15 text-brand-600">
                      <Bot size={14} />
                    </span>
                    <div className="pp-chat-text min-w-0 flex-1 rounded-xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">
                      {m.text
                        .split(/\n{2,}/)
                        .filter(Boolean)
                        .map((p, i) => (
                          <p key={i} className="whitespace-pre-wrap">
                            {p}
                          </p>
                        ))}
                      {m.streaming && !m.text && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                          <Loader2 size={12} className="animate-spin" /> thinking…
                        </span>
                      )}
                      {m.error && <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{m.error}</p>}
                    </div>
                  </div>
                  {m.tools.map((t) => (
                    <ToolResultCard key={t.callId} card={t} />
                  ))}
                  {m.approval && (
                    <div className="pl-8">
                      <ApprovalCard card={m.approval} />
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        <footer className="border-t border-slate-200 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder='Try: "invoice Acme $420 for consulting, due in 14 days"'
              className="pp-input resize-none"
              disabled={sending}
            />
            <button className="pp-btn-primary h-[38px] px-3" disabled={sending || !input.trim()} onClick={() => void submit()} aria-label="Send">
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
            <Terminal size={10} /> 9 tools · mutating actions gated by human approval
          </p>
        </footer>
      </aside>
    </div>
  );
}
