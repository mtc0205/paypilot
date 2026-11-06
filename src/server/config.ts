import dotenv from 'dotenv';

dotenv.config();

export type AiProviderName = 'mock' | 'openai' | 'anthropic' | 'gemini';

export interface Config {
  port: number;
  paypalEnv: 'mock' | 'sandbox';
  paypalBaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  paypalMerchantEmail: string;
  aiProvider: AiProviderName;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  webUrl: string;
  dataFile: string | null;
  logLevel: string;
}

function str(env: Record<string, string | undefined>, key: string, fallback = ''): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const paypalEnv = str(env, 'PAYPAL_ENV', 'mock') === 'sandbox' ? 'sandbox' : 'mock';
  const aiProviderRaw = str(env, 'AI_PROVIDER', 'mock');
  const aiProvider: AiProviderName =
    aiProviderRaw === 'openai' || aiProviderRaw === 'anthropic' || aiProviderRaw === 'gemini' ? aiProviderRaw : 'mock';
  const port = Number(str(env, 'PORT', '5075'));
  return {
    port: Number.isFinite(port) && port > 0 ? port : 5075,
    paypalEnv,
    paypalBaseUrl: str(env, 'PAYPAL_BASE_URL', 'https://api-m.sandbox.paypal.com'),
    paypalClientId: str(env, 'PAYPAL_CLIENT_ID'),
    paypalClientSecret: str(env, 'PAYPAL_CLIENT_SECRET'),
    paypalMerchantEmail: str(env, 'PAYPAL_MERCHANT_EMAIL', 'merchant@example.com'),
    aiProvider,
    aiApiKey: str(env, 'AI_API_KEY'),
    aiBaseUrl: str(env, 'AI_BASE_URL'),
    aiModel: str(env, 'AI_MODEL'),
    webUrl: str(env, 'WEB_URL', 'http://localhost:5075'),
    dataFile: str(env, 'DATA_FILE', 'data/state.json') || null,
    logLevel: str(env, 'LOG_LEVEL', 'warn'),
  };
}
