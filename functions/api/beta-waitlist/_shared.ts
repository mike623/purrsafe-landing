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

export const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/** Marks a quota rejection so a caller can tell it apart from an unreadable counter. */
export const RATE_LIMITED = 'rate_limited';

export const clientKey = (request: Request): string => request.headers.get('CF-Connecting-IP') ?? 'unknown';

/**
 * The quota a Pages deployment can actually enforce. Pages Functions support only
 * a subset of Workers bindings and the Cloudflare Rate Limiting binding is not in
 * it (https://developers.cloudflare.com/pages/functions/bindings/), so every
 * metered route counts in D1. One copy of the upsert keeps the window semantics
 * identical across routes; callers pass their own key and ceiling.
 */
export const assertRateLimit = async (db: D1Database, key: string, maxRequests: number): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`
    INSERT INTO beta_registration_rate_limits (client_key, request_count, window_started_at)
    VALUES (?1, 1, ?2)
    ON CONFLICT(client_key) DO UPDATE SET
      request_count = CASE WHEN ?2 - window_started_at >= ?3 THEN 1 ELSE request_count + 1 END,
      window_started_at = CASE WHEN ?2 - window_started_at >= ?3 THEN ?2 ELSE window_started_at END
    RETURNING request_count
  `).bind(key, now, RATE_LIMIT_WINDOW_SECONDS).first<{ request_count: number }>();
  if (!row || row.request_count > maxRequests) {
    throw new Error(RATE_LIMITED);
  }
};

export const pruneRateLimits = async (db: D1Database, now: number): Promise<void> => {
  await db.prepare('DELETE FROM beta_registration_rate_limits WHERE window_started_at < ?1').bind(now - RATE_LIMIT_WINDOW_SECONDS * 2).run();
};
