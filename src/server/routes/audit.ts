import type { FastifyInstance } from 'fastify';
import { decideApproval } from '../agent/approvals.js';
import { executeApprovedTool } from '../agent/runtime.js';
import type { AppContext } from '../context.js';

export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/audit', async (req) => {
    const q = (req.query ?? {}) as { limit?: string; actor?: string };
    const limit = q.limit ? Math.min(Number(q.limit), 1000) : 200;
    let rows = ctx.store.snapshot.audit;
    if (q.actor) rows = rows.filter((a) => a.actor === q.actor);
    return { rows: rows.slice(0, limit), total: ctx.store.snapshot.audit.length };
  });

  app.get('/api/approvals', async (req) => {
    const q = (req.query ?? {}) as { status?: string };
    let rows = ctx.store.snapshot.approvals;
    if (q.status === 'pending' || q.status === 'approved' || q.status === 'rejected') {
      rows = rows.filter((a) => a.status === q.status);
    }
    return { rows: rows.slice(0, 100), total: ctx.store.snapshot.approvals.length };
  });

  app.post('/api/approvals/:id/decide', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { decision?: string; by?: string } | undefined;
    if (body?.decision !== 'approve' && body?.decision !== 'reject') {
      reply.code(400);
      return { error: 'Body must be { decision: "approve" | "reject", by?: string }' };
    }
    const decidedBy = body.by?.trim() || 'merchant';
    const outcome = await decideApproval(ctx.store, id, body.decision, decidedBy, (tool, args) =>
      executeApprovedTool(tool, args, ctx.toolCtx),
    );
    if (outcome.status === 'error') {
      reply.code(422);
      return { error: outcome.message };
    }
    return outcome;
  });
}
