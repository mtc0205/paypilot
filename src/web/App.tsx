import { useEffect, useState } from 'react';
import { NavLink, Route, HashRouter, Routes, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Scale,
  ScrollText,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import type { AppMeta } from '@shared/types';
import { getMeta } from './lib/api';
import { ChatDrawer } from './components/ChatDrawer';
import { Toasts } from './components/ui';
import { useChatStore } from './state/chat';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { DisputesPage } from './pages/DisputesPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { AuditPage } from './pages/AuditPage';
import { DemoCheckoutPage } from './pages/DemoCheckoutPage';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/disputes', label: 'Disputes', icon: Scale },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/demo-checkout', label: 'Demo checkout', icon: ShoppingCart },
];

function Sidebar({ meta }: { meta: AppMeta | null }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-navy-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
          <Sparkles size={19} />
        </span>
        <div>
          <p className="text-[15px] font-bold tracking-tight text-white">PayPilot</p>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">First mate for PayPal</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? 'bg-navy-800 text-white' : 'text-slate-400 hover:bg-navy-900 hover:text-slate-200'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-navy-900 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-400">{meta?.merchantName ?? 'Loading…'}</p>
        <p className="mt-0.5">
          PayPal: <span className={meta?.paypalEnv === 'sandbox' ? 'text-brand-300' : 'text-slate-400'}>{meta?.paypalEnv ?? '—'}</span>
          {' · '}AI: <span className="text-slate-400">{meta?.aiProvider ?? '—'}</span>
        </p>
        <p className="mt-0.5">{meta ? `${meta.counts.transactions.toLocaleString()} tx · ${meta.counts.disputes} disputes` : ''}</p>
      </div>
    </aside>
  );
}

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/disputes': 'Disputes',
  '/invoices': 'Invoices',
  '/audit': 'Audit log',
  '/demo-checkout': 'Demo checkout',
};

function Topbar({ meta }: { meta: AppMeta | null }) {
  const { pathname } = useLocation();
  const setOpen = useChatStore((s) => s.setOpen);
  const title = TITLES[pathname] ?? 'PayPilot';
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur">
      <h1 className="text-[15px] font-semibold text-navy-950">{title}</h1>
      <div className="flex items-center gap-3">
        <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline-flex ${meta?.paypalEnv === 'sandbox' ? 'bg-violet-50 text-violet-700 ring-violet-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${meta?.paypalEnv === 'sandbox' ? 'bg-violet-500' : 'bg-slate-400'}`} />
          PayPal {meta?.paypalEnv ?? '…'}
        </span>
        <span className="hidden items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/20 sm:inline-flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
          AI {meta?.aiProvider ?? '…'}
        </span>
        <button onClick={() => setOpen(true)} className="pp-btn-accent" data-testid="first-mate-toggle">
          <MessageCircle size={16} />
          First Mate
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [meta, setMeta] = useState<AppMeta | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getMeta().then((m) => alive && setMeta(m)).catch(() => undefined);
    load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <HashRouter>
      <div className="min-h-screen">
        <Sidebar meta={meta} />
        <div className="pl-60">
          <Topbar meta={meta} />
          <main className="mx-auto max-w-[1200px] p-6">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/disputes" element={<DisputesPage />} />
              <Route path="/invoices" element={<InvoicesPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/demo-checkout" element={<DemoCheckoutPage />} />
            </Routes>
          </main>
        </div>
        <ChatDrawer aiProvider={meta?.aiProvider ?? 'mock'} />
        <Toasts />
      </div>
    </HashRouter>
  );
}
