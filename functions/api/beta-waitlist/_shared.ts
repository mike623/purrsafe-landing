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

export const isUsableToken = (token: unknown): token is string =>
  typeof token === 'string' && token.length >= 20 && token.length <= 256;

export const redirect = (env: WaitlistEnv, result: 'verified' | 'unsubscribed' | 'invalid'): Response => {
  const url = new URL('/', env.PUBLIC_SITE_URL);
  url.searchParams.set('beta', result);
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
};
