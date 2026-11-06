/**
 * Application context — one object wiring config, store, provider and the
 * agent tool context together. Passed to every route registration.
 */
import type { AgentEvent, ChatTurn } from '../shared/types.js';
import { errorMessage } from '../shared/util.js';
import { mockRespond } from './agent/providers/mock.js';
import { openaiRespond } from './agent/providers/openai.js';
import { anthropicRespond } from './agent/providers/anthropic.js';
import { geminiRespond } from './agent/providers/gemini.js';
import { doneEvent, makeDeps } from './agent/runtime.js';
import type { ToolContext } from './agent/tools.js';
import type { Config } from './config.js';
import { MockPayPalProvider } from './paypal/mock/ledger.js';
import type { PayPalProvider } from './paypal/provider.js';
import { SandboxProvider } from './paypal/sandbox.js';
import { generateSeed } from './paypal/seed.js';
import { Store } from './store/store.js';

export const STREAM_DELAY_MS = 14;

export interface AppContext {
  config: Config;
  store: Store;
  provider: PayPalProvider;
  toolCtx: ToolContext;
  /** Run one agent turn, emitting SSE events through `emit`. */
  runAgent(message: string, history: ChatTurn[], emit: (e: AgentEvent) => void): Promise<void>;
}

export function buildContext(config: Config): AppContext {
  const store = new Store(config.dataFile);

  // Zero-config demo: auto-seed on first boot in mock mode.
  if (config.paypalEnv === 'mock' && !store.isSeeded) {
    store.reset(generateSeed({ now: new Date() }));
    console.log('[paypilot] mock mode: seeded demo data (first boot)');
  }

  const provider: PayPalProvider =
    config.paypalEnv === 'sandbox'
      ? new SandboxProvider(
          {
            baseUrl: config.paypalBaseUrl,
            clientId: config.paypalClientId,
            clientSecret: config.paypalClientSecret,
            merchantEmail: config.paypalMerchantEmail,
          },
          store,
        )
      : new MockPayPalProvider(store);

  const toolCtx: ToolContext = {
    store,
    provider,
    now: () => new Date(),
  };

  const runAgent = async (message: string, history: ChatTurn[], emit: (e: AgentEvent) => void): Promise<void> => {
    const deps = makeDeps(toolCtx, emit, STREAM_DELAY_MS);
    try {
      switch (config.aiProvider) {
        case 'openai': {
          if (!config.aiApiKey) throw new Error('AI_PROVIDER=openai but AI_API_KEY is not set');
          await openaiRespond({ message, history }, { apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl, model: config.aiModel }, deps);
          break;
        }
        case 'anthropic': {
          if (!config.aiApiKey) throw new Error('AI_PROVIDER=anthropic but AI_API_KEY is not set');
          await anthropicRespond({ message, history }, { apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl, model: config.aiModel }, deps);
          break;
        }
        case 'gemini': {
          if (!config.aiApiKey) throw new Error('AI_PROVIDER=gemini but AI_API_KEY is not set');
          await geminiRespond({ message, history }, { apiKey: config.aiApiKey, baseUrl: config.aiBaseUrl, model: config.aiModel }, deps);
          break;
        }
        default:
          await mockRespond({ message, history }, deps, toolCtx);
      }
    } catch (e) {
      emit({ type: 'error', message: errorMessage(e) });
      return;
    }
    emit(doneEvent());
  };

  return { config, store, provider, toolCtx, runAgent };
}
