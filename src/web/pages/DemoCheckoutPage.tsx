import { useState, type ReactNode } from 'react';
import { ArrowLeftRight, CheckCircle2, CircleDollarSign, CreditCard, Loader2, ShoppingCart } from 'lucide-react';
import type { DemoOrder } from '@shared/types';
import { approveDemoOrder, captureDemoOrder, createDemoOrder } from '../lib/api';
import { money } from '../lib/format';
import { announceRefresh } from '../lib/api';
import { EmptyState, Panel } from '../components/ui';
import { useChatStore } from '../state/chat';
import { toast } from '../state/toast';

type Stage = 'form' | 'created' | 'approved' | 'captured';

export function DemoCheckoutPage() {
  const [item, setItem] = useState('PayPilot sticker pack');
  const [amount, setAmount] = useState('19.99');
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useChatStore((s) => s.send);
  const openChat = useChatStore((s) => s.setOpen);

  const run = async (fn: () => Promise<DemoOrder>, next: Stage) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      setOrder(result);
      setStage(next);
      if (next === 'captured') {
        toast.success('Payment captured', `${money(result.amount)} settled — see it in Transactions`);
        announceRefresh();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error('Order step failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const steps: { key: Stage; label: string; icon: ReactNode }[] = [
    { key: 'created', label: '1 · Order created (Orders API v2)', icon: <ShoppingCart size={14} /> },
    { key: 'approved', label: '2 · Buyer approves', icon: <CreditCard size={14} /> },
    { key: 'captured', label: '3 · Payment captured → ledger', icon: <CheckCircle2 size={14} /> },
  ];
  const stageIdx = stage === 'form' ? -1 : stage === 'created' ? 0 : stage === 'approved' ? 1 : 2;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Panel title="Live PayPal integration, 20 seconds">
        <p className="text-xs leading-relaxed text-slate-600">
          This screen proves the <strong>real</strong> Orders API v2 code path
          (<code className="rounded bg-slate-100 px-1 font-mono text-[11px]">src/server/paypal/services/orders.ts</code>): create order → buyer
          approval → capture. In <strong>mock mode</strong> the buyer approval is simulated locally; with{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">PAYPAL_ENV=sandbox</code> + credentials the exact same server code
          calls <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">api-m.sandbox.paypal.com</code>. Captured payments land in the
          ledger and every step is audit-logged.
        </p>

        <ol className="mt-4 space-y-2">
          {steps.map((s, i) => {
            const done = stageIdx >= i;
            const active = stageIdx === i;
            return (
              <li
                key={s.key}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  done ? (active ? 'border-brand-400 bg-brand-50/50 text-brand-800' : 'border-emerald-200 bg-emerald-50/40 text-emerald-800') : 'border-slate-200 bg-white text-slate-400'
                }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${done ? 'bg-white' : 'bg-slate-100'}`}>
                  {done && !active ? <CheckCircle2 size={16} className="text-emerald-600" /> : s.icon}
                </span>
                {s.label}
                {active && busy && <Loader2 size={14} className="ml-auto animate-spin text-brand-600" />}
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel title="Checkout simulator">
        {stage === 'form' || stage === 'created' || stage === 'approved' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Item</span>
                <input value={item} onChange={(e) => setItem(e.target.value)} className="pp-input" disabled={stage !== 'form'} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Amount (USD)</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pp-input"
                  disabled={stage !== 'form'}
                  inputMode="decimal"
                />
              </label>
            </div>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              {stage === 'form' && (
                <button
                  className="pp-btn-primary"
                  disabled={busy || !item.trim() || !(Number(amount) > 0)}
                  onClick={() => void run(() => createDemoOrder(item.trim(), Number(amount)), 'created')}
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CircleDollarSign size={15} />}
                  Create order
                </button>
              )}
              {stage === 'created' && (
                <button className="pp-btn-primary" disabled={busy} onClick={() => void run(() => approveDemoOrder(order!.id), 'approved')}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                  Simulate buyer approval
                </button>
              )}
              {stage === 'approved' && (
                <button className="pp-btn-accent" disabled={busy} onClick={() => void run(() => captureDemoOrder(order!.id), 'captured')}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  Capture payment
                </button>
              )}
              {stage !== 'form' && (
                <button className="pp-btn-ghost" onClick={() => { setStage('form'); setOrder(null); setError(null); }}>
                  Start over
                </button>
              )}
            </div>
            {order && (
              <p className="font-mono text-[11px] text-slate-400">
                order {order.id} · {order.status}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={40} className="text-emerald-500" />
            <p className="text-lg font-bold text-navy-900">{money(order?.amount ?? 0)} captured</p>
            <p className="max-w-md text-xs leading-relaxed text-slate-500">
              Order <span className="font-mono">{order?.id}</span> is COMPLETED and the payment now appears in the ledger with a
              linked transaction — the insight engine, grid, and KPIs already know about it.
            </p>
            <div className="flex gap-2">
              <button
                className="pp-btn-ghost"
                onClick={() => {
                  setStage('form');
                  setOrder(null);
                }}
              >
                Run again
              </button>
              <button
                className="pp-btn-accent"
                onClick={() => {
                  openChat(true);
                  void send('Explain the most recent transaction');
                }}
              >
                <ArrowLeftRight size={14} /> Ask First Mate about it
              </button>
            </div>
          </div>
        )}
      </Panel>

      {stage !== 'form' && (
        <Panel title="Why this matters for judging">
          <ul className="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-slate-600">
            <li>Same provider interface: <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">SandboxProvider</code> and <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">MockPayPalProvider</code> implement identical contracts.</li>
            <li>Real REST payloads: OAuth2 client-credentials, intent=CAPTURE purchase units, capture endpoint.</li>
            <li>Captured funds are normalized into the shared ledger type, so insights react instantly.</li>
          </ul>
        </Panel>
      )}
      {stage === 'form' && !order && <EmptyState icon={<ShoppingCart size={26} />} title="No active order" hint="Create one above — three clicks to a settled payment." />}
    </div>
  );
}
