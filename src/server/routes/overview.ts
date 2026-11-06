import type { FastifyInstance } from 'fastify';
import type { CashflowDay, CustomerShare, ForecastPoint, InsightAlert, Kpis, Subscription } from '../../shared/types.js';
import {
  buildCashflowSummary,
  buildDailySeries,
  buildForecastSummary,
  customerConcentration,
  runInsights,
} from '../insights/index.js';
import type { AppContext } from '../context.js';

export interface OverviewResponse {
  merchant: { name: string; business: string };
  kpis: Kpis;
  series: CashflowDay[];
  forecast: { points: ForecastPoint[]; slopePerDay: number; bandHalfWidth: number; expectedTotal: number; lowTotal: number; highTotal: number };
  alerts: InsightAlert[];
  subscriptions: Subscription[];
  customers: CustomerShare[];
}

export function registerOverviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/overview', async () => {
    const now = new Date();
    const txs = ctx.store.snapshot.transactions;
    const summary = buildCashflowSummary(txs, 30, now);
    const series = buildDailySeries(txs, 120, now);
    const forecast = buildForecastSummary(txs, 30, now);
    const alerts = runInsights({ transactions: txs, disputes: ctx.store.snapshot.disputes, now });
    const customers = customerConcentration(txs, now);

    const todayKey = new Date().toISOString().slice(0, 10);
    const netToday = series.find((d) => d.date === todayKey)?.net ?? 0;
    const openDisputes = ctx.store.snapshot.disputes.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW');
    const completed90 = txs.filter(
      (t) => t.direction === 'in' && t.type === 'PAYMENT' && t.status === 'COMPLETED' && new Date(t.timestamp).getTime() > now.getTime() - 90 * 86_400_000,
    ).length;
    const kpis: Kpis = {
      netToday,
      net30d: summary.net,
      net30dDeltaPct: summary.deltaPct,
      mrr: summary.mrr,
      disputeRate: completed90 > 0 ? Math.round((openDisputes.length / completed90) * 10000) / 100 : 0,
      openDisputes: openDisputes.length,
      activeSubscriptions: summary.subscriptions.length,
      pendingInvoices: ctx.store.snapshot.invoices.filter((i) => i.status === 'DRAFT' || i.status === 'SENT').length,
      criticalAlerts: alerts.filter((a) => a.severity === 'critical').length,
    };

    const response: OverviewResponse = {
      merchant: { name: ctx.store.snapshot.merchant.name, business: ctx.store.snapshot.merchant.business },
      kpis,
      series,
      forecast: {
        points: forecast.points,
        slopePerDay: forecast.slopePerDay,
        bandHalfWidth: forecast.bandHalfWidth,
        expectedTotal: forecast.expectedTotal,
        lowTotal: forecast.lowTotal,
        highTotal: forecast.highTotal,
      },
      alerts: alerts.slice(0, 14),
      subscriptions: summary.subscriptions.slice(0, 12),
      customers: customers.slice(0, 6),
    };
    return response;
  });
}
