export interface D1Result {
  success: boolean;
  results?: unknown[];
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}

export interface Env {
  DB?: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

const MAX_EMAIL_LENGTH = 254;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_REQUESTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegistrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RegistrationError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new RegistrationError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return email;
}

function json(body: Record<string, unknown>, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    },
  });
}

function requestOrigin(request: Request, env: Env): string {
  return env.ALLOWED_ORIGIN ?? new URL(request.url).origin;
}

function clientKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

async function assertRateLimit(db: D1Database, key: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare('SELECT request_count, window_started_at FROM beta_registration_rate_limits WHERE client_key = ?1')
    .bind(key)
    .first<{ request_count: number; window_started_at: number }>();

  if (existing && now - existing.window_started_at < RATE_LIMIT_WINDOW_SECONDS && existing.request_count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new RegistrationError(429, 'rate_limited', 'Too many attempts. Try again later.');
  }

  const nextCount = existing && now - existing.window_started_at < RATE_LIMIT_WINDOW_SECONDS
    ? existing.request_count + 1
    : 1;
  await db
    .prepare(`
      INSERT INTO beta_registration_rate_limits (client_key, request_count, window_started_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(client_key) DO UPDATE SET request_count = excluded.request_count, window_started_at = excluded.window_started_at
    `)
    .bind(key, nextCount, existing && now - existing.window_started_at < RATE_LIMIT_WINDOW_SECONDS ? existing.window_started_at : now)
    .run();
}

async function saveRegistration(db: D1Database, email: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO beta_registrations (email) VALUES (?1)')
    .bind(email)
    .run();
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const origin = requestOrigin(request, env);

  try {
    if (!env.DB) {
      return json({ ok: false, error: 'service_unavailable', message: 'Registration is temporarily unavailable.' }, 503, origin);
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new RegistrationError(415, 'unsupported_media_type', 'Send registration data as JSON.');
    }

    let body: { email?: unknown; website?: unknown };
    try {
      body = await request.json() as { email?: unknown; website?: unknown };
    } catch {
      throw new RegistrationError(400, 'invalid_request', 'Send a valid JSON request.');
    }
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      throw new RegistrationError(400, 'invalid_request', 'Registration could not be completed.');
    }

    const email = normalizeEmail(body.email);
    await assertRateLimit(env.DB, clientKey(request));
    await saveRegistration(env.DB, email);

    return json({ ok: true, message: 'You are on the PurrSafe beta waitlist.' }, 200, origin);
  } catch (error) {
    if (error instanceof RegistrationError) {
      return json({ ok: false, error: error.code, message: error.message }, error.status, origin);
    }

    console.error('beta registration failed', error);
    return json({ ok: false, error: 'internal_error', message: 'Registration is temporarily unavailable.' }, 500, origin);
  }
}

export function onRequestOptions({ request, env }: { request: Request; env: Env }): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': requestOrigin(request, env),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    },
  });
}
