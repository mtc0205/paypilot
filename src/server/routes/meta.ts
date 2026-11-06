import type { FastifyInstance } from 'fastify';
import type { AppMeta } from '../../shared/types.js';
import type { AppContext } from '../context.js';

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    paypalEnv: ctx.config.paypalEnv,
    aiProvider: ctx.config.aiProvider,
    seeded: ctx.store.isSeeded,
  }));

  app.get('/api/meta', async () => {
    const meta: AppMeta = {
      version: '1.0.0',
      paypalEnv: ctx.config.paypalEnv,
      aiProvider: ctx.config.aiProvider,
      aiModel: ctx.config.aiModel || null,
      merchantName: ctx.store.snapshot.merchant.name,
      seededAt: ctx.store.isSeeded ? ctx.store.snapshot.seededAt : null,
      counts: {
        transactions: ctx.store.snapshot.transactions.length,
        invoices: ctx.store.snapshot.invoices.length,
        disputes: ctx.store.snapshot.disputes.length,
        orders: ctx.store.snapshot.orders.length,
        audit: ctx.store.snapshot.audit.length,
      },
    };
    return meta;
  });
}
