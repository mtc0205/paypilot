import type { FastifyInstance } from 'fastify';
import type { AgentEvent, ChatTurn } from '../../shared/types.js';
import type { AppContext } from '../context.js';

/**
 * SSE chat endpoint. Events: token | tool_call | tool_result |
 * approval_request | done | error (see shared/types.ts AgentEvent).
 */
export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/chat/stream', async (req, reply) => {
    const body = req.body as { message?: string; history?: ChatTurn[] } | undefined;
    const message = body?.message?.trim();
    if (!message) {
      reply.code(400);
      return { error: 'Body must include { message }' };
    }
    const history = Array.isArray(body?.history)
      ? body.history.filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant')).slice(-6)
      : [];

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write(': connected\n\n');
    let closed = false;
    raw.on('close', () => {
      closed = true;
    });

    const send = (event: AgentEvent) => {
      if (closed) return;
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await ctx.runAgent(message, history, send);
      if (!closed) send({ type: 'done', messageId: `msg_${Date.now().toString(36)}` });
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (!closed) raw.end();
    }
  });

  app.post('/api/chat/message', async (req, reply) => {
    // Non-streaming variant (handy for tests / Postman).
    const body = req.body as { message?: string; history?: ChatTurn[] } | undefined;
    const message = body?.message?.trim();
    if (!message) {
      reply.code(400);
      return { error: 'Body must include { message }' };
    }
    const events: AgentEvent[] = [];
    await ctx.runAgent(message, body?.history ?? [], (e) => events.push(e));
    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => (e as { text: string }).text)
      .join('');
    return { text, events };
  });
}
