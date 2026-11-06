import type { FastifyInstance } from 'fastify';
import type { Transaction } from '../../shared/types.js';
import { explainTransaction } from '../insights/index.js';
import { filterTransactions } from '../agent/tools.js';
import type { AppContext } from '../context.js';

export interface TransactionListResponse {
  rows: Transaction[];
  total: number;
  net: number;
}

export function registerTransactionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/transactions', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const args: Record<string, unknown> = {};
    if (q.q) args.query = q.q;
    if (q.type) args.type = q.type;
    if (q.status) args.status = q.status;
    if (q.direction) args.direction = q.direction;
    if (q.min) args.minAmount = Number(q.min);
    if (q.max) args.maxAmount = Number(q.max);
    if (q.lastDays) args.lastDays = Number(q.lastDays);
    const riskMin = q.riskMin ? Number(q.riskMin) : null;
    const limit = q.limit ? Math.min(Number(q.limit), 5000) : 5000;

    let rows = filterTransactions(ctx.store.snapshot.transactions, args, new Date());
    if (riskMin !== null) rows = rows.filter((t) => t.risk.score >= riskMin);
    const net = Math.round(rows.reduce((acc, t) => acc + (t.direction === 'in' ? t.amount : -t.amount), 0) * 100) / 100;
    const response: TransactionListResponse = {
      rows: rows.slice(0, limit),
      total: rows.length,
      net,
    };
    return response;
  });

  app.get('/api/transactions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = ctx.store.snapshot.transactions.find((t) => t.id === id);
    if (!tx) {
      reply.code(404);
      return { error: `Transaction ${id} not found` };
    }
    return tx;
  });

  app.get('/api/transactions/:id/explain', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = ctx.store.snapshot.transactions.find((t) => t.id === id);
    if (!tx) {
      reply.code(404);
      return { error: `Transaction ${id} not found` };
    }
    return explainTransaction(tx, ctx.store.snapshot.transactions, new Date());
  });
}
