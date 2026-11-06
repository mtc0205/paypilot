/**
 * PayPilot server entrypoint — Fastify REST + SSE, serving the built frontend
 * from dist/public in production. Zero env vars required (mock everything).
 */
import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { buildContext } from './context.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDisputeRoutes } from './routes/disputes.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerOverviewRoutes } from './routes/overview.js';
import { registerTransactionRoutes } from './routes/transactions.js';

// `npm start` runs from the package root; the built SPA lives in dist/public.
const publicDir = process.env.PUBLIC_DIR ?? path.resolve(process.cwd(), 'dist/public');

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = buildContext(config);

  const app = Fastify({ logger: { level: config.logLevel } });
  await app.register(cors, { origin: true });

  registerMetaRoutes(app, ctx);
  registerOverviewRoutes(app, ctx);
  registerTransactionRoutes(app, ctx);
  registerDisputeRoutes(app, ctx);
  registerInvoiceRoutes(app, ctx);
  registerOrderRoutes(app, ctx);
  registerAuditRoutes(app, ctx);
  registerChatRoutes(app, ctx);

  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      void reply.status(404).send({ error: 'Not found' });
    });
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
  const banner = [
    '',
    '  ⛵  PayPilot is up',
    `  ─  http://localhost:${config.port}`,
    `  ─  PayPal: ${config.paypalEnv}${config.paypalEnv === 'mock' ? ' (simulated)' : ''}`,
    `  ─  AI: ${config.aiProvider}${config.aiProvider === 'mock' ? ' (deterministic, no key needed)' : ''}`,
    `  ─  Ledger: ${ctx.store.snapshot.transactions.length} transactions`,
    '',
  ].join('\n');
  console.log(banner);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
