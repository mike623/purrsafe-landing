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
  DB: D1Database;
  PUBLIC_SITE_URL: string;
}

export const hash = async (value: string): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const createToken = (): string => `${crypto.randomUUID()}-${crypto.randomUUID()}`;

export const redirect = (env: WaitlistEnv, result: 'verified' | 'unsubscribed' | 'invalid'): Response => {
  const url = new URL('/', env.PUBLIC_SITE_URL);
  url.searchParams.set('beta', result);
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store',
    },
  });
};
