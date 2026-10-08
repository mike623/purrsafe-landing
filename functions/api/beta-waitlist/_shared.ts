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
 * Names the configuration values a deployment is missing. Reading an unset Pages
 * environment value yields `undefined`, so an unguarded `env.X.replace(...)` or
 * `env.X.limit(...)` throws out of the Function and reaches the client as an
 * opaque Cloudflare 1101 exception instead of a status we can act on.
 */
export const missingEnv = (env: unknown, keys: readonly string[]): string[] => {
  const values = (env ?? {}) as Record<string, unknown>;
  return keys.filter((key) => typeof values[key] !== 'string' || values[key] === '');
};

/** Records incomplete configuration in the Pages log without echoing any value. */
export const logMisconfiguration = (route: string, missing: readonly string[]): void => {
  console.error(`${route}: deployment is missing required configuration: ${missing.join(', ')}`);
};

/** Records an unexpected runtime failure in the Pages log without echoing request data. */
export const logFailure = (route: string, stage: string, error: unknown): void => {
  console.error(`${route}: ${stage} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
};
