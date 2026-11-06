import type { FastifyInstance } from 'fastify';
import type { Invoice } from '../../shared/types.js';
import { parseInvoiceText, InvoiceParseError } from '../agent/parser.js';
import type { AppContext } from '../context.js';

export function registerInvoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/invoices', async () => ctx.store.snapshot.invoices);

  app.post('/api/invoice/parse', async (req, reply) => {
    const body = req.body as { text?: string } | undefined;
    const text = body?.text;
    if (!text || typeof text !== 'string') {
      reply.code(400);
      return { error: 'Body must include { text }' };
    }
    try {
      const draft = parseInvoiceText(text);
      return { draft };
    } catch (e) {
      if (e instanceof InvoiceParseError) {
        reply.code(422);
        return { error: e.message, notes: e.notes };
      }
      throw e;
    }
  });

  app.post('/api/invoices', async (req, reply) => {
    const body = req.body as
      | { recipientName?: string; recipientEmail?: string; item?: string; amount?: number; quantity?: number; dueDays?: number; memo?: string }
      | undefined;
    if (!body?.recipientName || !(typeof body.amount === 'number' && body.amount > 0)) {
      reply.code(400);
      return { error: 'Body must include recipientName and a positive amount' };
    }
    try {
      const invoice = await ctx.provider.createInvoice({
        recipientName: body.recipientName,
        recipientEmail: body.recipientEmail,
        item: body.item ?? 'Professional services',
        amount: body.amount,
        quantity: body.quantity ?? 1,
        dueDays: body.dueDays ?? 30,
        memo: body.memo,
      });
      ctx.store.logAudit({
        actor: 'human',
        action: 'create_invoice',
        args: { recipient: body.recipientName, amount: body.amount, dueDays: body.dueDays ?? 30 },
        result: 'ok',
        detail: `Created invoice ${invoice.number}`,
        approved: true,
        approver: 'merchant',
        relatedId: invoice.id,
      });
      return invoice;
    } catch (e) {
      reply.code(422);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  const findInvoice = (id: string): Invoice | undefined => ctx.store.snapshot.invoices.find((i) => i.id === id || i.number === id);

  app.post('/api/invoices/:id/send', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const invoice = await ctx.provider.sendInvoice(id);
      ctx.store.logAudit({
        actor: 'human',
        action: 'send_invoice',
        args: { invoice_id: id },
        result: 'ok',
        detail: `Sent ${invoice.number} to ${invoice.recipient.email}`,
        approved: true,
        approver: 'merchant',
        relatedId: invoice.id,
      });
      return invoice;
    } catch (e) {
      reply.code(422);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post('/api/invoices/:id/mark-paid', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!findInvoice(id)) {
      reply.code(404);
      return { error: `Invoice ${id} not found` };
    }
    try {
      const invoice = await ctx.provider.markInvoicePaid(id);
      ctx.store.logAudit({
        actor: 'human',
        action: 'mark_invoice_paid',
        args: { invoice_id: id },
        result: 'ok',
        detail: `Marked ${invoice.number} paid — ledger updated`,
        approved: true,
        approver: 'merchant',
        relatedId: invoice.id,
      });
      return invoice;
    } catch (e) {
      reply.code(422);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}
