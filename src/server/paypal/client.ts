/**
 * Minimal typed PayPal REST client: OAuth2 client-credentials, fetch-based,
 * token caching with expiry refresh margin. Used by the `sandbox` provider;
 * never needed in mock mode.
 */

export interface PayPalClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class PayPalApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(`PayPal API ${status}: ${message}`);
    this.name = 'PayPalApiError';
    this.status = status;
    this.details = details;
  }
}

export class PayPalClient {
  private readonly opts: PayPalClientOptions;
  private token: { accessToken: string; expiresAt: number } | null = null;

  constructor(opts: PayPalClientOptions) {
    this.opts = opts;
  }

  async authenticate(): Promise<string> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await fetch(`${this.opts.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new PayPalApiError('OAuth2 client-credentials failed', res.status, await safeJson(res));
    }
    const json = (await res.json()) as OAuthTokenResponse;
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return this.token.accessToken;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.accessToken;
    return this.authenticate();
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const token = await this.ensureToken();
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `paypilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new PayPalApiError(`${method} ${path} failed`, res.status, await safeJson(res));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return res.statusText;
  }
}
