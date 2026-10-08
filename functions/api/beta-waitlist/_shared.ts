export interface D1Result {
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface WaitlistEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  PUBLIC_SITE_URL: string;
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  },
});

export const isUsableToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length >= 20 && token.length <= 256;

/**
 * Stable Turnstile action for the landing-page waitlist widget. The frontend sends it
 * as `data-action` and siteverify must return it verbatim, so the two sides share one
 * constant instead of two independently configured strings.
 */
export const BETA_WAITLIST_TURNSTILE_ACTION = 'beta_waitlist';

/** Turnstile tokens are opaque and currently bounded well below this by Cloudflare. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export const isUsableTurnstileToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length > 0 && token.length <= TURNSTILE_TOKEN_MAX_LENGTH;
