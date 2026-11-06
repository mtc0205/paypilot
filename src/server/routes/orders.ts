import type { FastifyInstance } from 'fastify';
import type { DemoOrder } from '../../shared/types.js';
import { MockPayPalProvider } from '../paypal/mock/ledger.js';
import type { AppContext } from '../context.js';

/**
 * Demo checkout — proves the Orders API v2 flow end-to-end (create → buyer
 * approves → capture) using the same code path as sandbox mode.
 */
export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/demo/order', async (req, reply) => {
    const body = req.body as { item?: string; amount?: number } | undefined;
    const item = body?.item?.trim() || 'PayPilot demo mug';
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      reply.code(400);
      return { error: 'amount must be a number between 0.01 and 10000' };
    }
    const order = await ctx.provider.createOrder({ item, amount });
    ctx.store.logAudit({
      actor: 'human',
      action: 'create_order',
      args: { item, amount },
      result: 'ok',
      detail: `Demo order ${order.id} created (${order.status})`,
      approved: true,
      approver: 'merchant',
      relatedId: order.id,
    });
    return order;
  });

  app.post('/api/demo/order/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(ctx.provider instanceof MockPayPalProvider)) {
      reply.code(400);
      return { error: 'Buyer approval happens on paypal.com in sandbox mode — this endpoint only exists for the mock demo' };
    }
    try {
      return ctx.provider.approveOrder(id);
    } catch (e) {
      reply.code(422);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post('/api/demo/order/:id/capture', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const order: DemoOrder = await ctx.provider.captureOrder(id);
      ctx.store.logAudit({
        actor: 'human',
        action: 'capture_order',
        args: { order_id: id },
        result: 'ok',
        detail: `Captured ${order.id} — ${order.amount} USD settled to ledger`,
        approved: true,
        approver: 'merchant',
        relatedId: order.id,
      });
      return order;
    } catch (e) {
      reply.code(422);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get('/api/demo/orders', async () => ctx.store.snapshot.orders.slice(0, 10));
}
