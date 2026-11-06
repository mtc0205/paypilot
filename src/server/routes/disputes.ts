import type { FastifyInstance } from 'fastify';
import { draftDisputeResponse } from '../agent/drafts.js';
import type { AppContext } from '../context.js';

export function registerDisputeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/disputes', async () => ctx.store.snapshot.disputes);

  app.get('/api/disputes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dispute = ctx.store.snapshot.disputes.find((d) => d.id === id);
    if (!dispute) {
      reply.code(404);
      return { error: `Dispute ${id} not found` };
    }
    return dispute;
  });

  app.post('/api/disputes/:id/draft', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dispute = ctx.store.snapshot.disputes.find((d) => d.id === id);
    if (!dispute) {
      reply.code(404);
      return { error: `Dispute ${id} not found` };
    }
    const tx = ctx.store.snapshot.transactions.find((t) => t.id === dispute.transactionId) ?? null;
    const draft = draftDisputeResponse(dispute, tx, ctx.store.snapshot.merchant.name);
    ctx.store.update((s) => {
      const idx = s.disputes.findIndex((d) => d.id === id);
      if (idx >= 0) s.disputes[idx] = { ...s.disputes[idx], aiDraft: draft, aiDraftedAt: new Date().toISOString() };
    });
    ctx.store.logAudit({
      actor: 'human',
      action: 'draft_dispute_response',
      args: { dispute_id: id },
      result: 'ok',
      detail: `Drafted response for ${id}`,
      approved: true,
      approver: 'merchant',
      relatedId: id,
    });
    return { disputeId: id, draft };
  });

  app.post('/api/disputes/:id/evidence', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { index?: number; done?: boolean } | undefined;
    if (!body || typeof body.index !== 'number' || typeof body.done !== 'boolean') {
      reply.code(400);
      return { error: 'Body must be { index: number, done: boolean }' };
    }
    let updated: { evidence: { label: string; done: boolean }[] } | null = null;
    ctx.store.update((s) => {
      const idx = s.disputes.findIndex((d) => d.id === id);
      if (idx < 0) return;
      if (body.index === undefined || body.index < 0 || body.index >= s.disputes[idx].evidence.length) return;
      s.disputes[idx].evidence[body.index].done = body.done === true;
      updated = { evidence: s.disputes[idx].evidence.map((e) => ({ label: e.label, done: e.done })) };
    });
    if (!updated) {
      reply.code(404);
      return { error: `Dispute ${id} or evidence index not found` };
    }
    return updated;
  });
}
