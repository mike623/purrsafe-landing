import type { D1Database } from './beta-waitlist/_shared.js';

interface Env {
  DB: D1Database;
  RATE_LIMITER: { limit(input: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_ACTION: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  PUBLIC_SITE_URL: string;
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_REQUESTS = 5;
const GLOBAL_RATE_LIMIT_KEY = 'beta-waitlist:global';
const GLOBAL_RATE_LIMIT_MAX_REQUESTS = 100;

const json = (body: Record<string, unknown>, status = 200, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'access-control-allow-origin': origin ?? 'null',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    },
  });

const originFor = (request: Request, env: Env) => {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? env.PUBLIC_SITE_URL).split(',').map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
};

const clientKey = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';

const assertRateLimit = async (db: D1Database, key: string, maxRequests: number) => {
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
    throw new Error('rate_limited');
  }
};

const pruneRateLimits = async (db: D1Database, now: number) => {
  await db.prepare('DELETE FROM beta_registration_rate_limits WHERE window_started_at < ?1').bind(now - RATE_LIMIT_WINDOW_SECONDS * 2).run();
};

const callSupabase = async (env: Env, body: Record<string, unknown>) => fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const onRequestOptions = ({ request, env }: Context) =>
  new Response(null, { status: 204, headers: { 'access-control-allow-origin': originFor(request, env) ?? 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });

export const onRequestPost = async ({ request, env }: Context) => {
  const origin = originFor(request, env);
  if (!origin) return json({ message: 'Origin not allowed.' }, 403);

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const betaConsent = form.get('beta_consent') === 'yes';
  const researchOptIn = form.get('research_opt_in') === 'yes';
  const turnstileToken = String(form.get('cf-turnstile-response') ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !betaConsent || !turnstileToken) return json({ message: 'Enter a valid email, accept beta consent, and complete verification.' }, 400, origin);

  try {
    const platformLimit = await env.RATE_LIMITER.limit({ key: GLOBAL_RATE_LIMIT_KEY });
    if (!platformLimit.success) throw new Error('rate_limited');
    const now = Math.floor(Date.now() / 1000);
    await pruneRateLimits(env.DB, now);
    await assertRateLimit(env.DB, GLOBAL_RATE_LIMIT_KEY, GLOBAL_RATE_LIMIT_MAX_REQUESTS);
    await assertRateLimit(env.DB, `client:${clientKey(request)}`, RATE_LIMIT_MAX_REQUESTS);
  } catch (error) {
    if (error instanceof Error && error.message === 'rate_limited') return json({ message: 'Too many attempts. Try again later.' }, 429, origin);
    throw error;
  }

  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: turnstileToken, remoteip: request.headers.get('CF-Connecting-IP') ?? '' }) });
  const verificationResult = await verification.json() as { success?: boolean; hostname?: string; action?: string };
  if (!verificationResult.success || verificationResult.hostname !== env.TURNSTILE_HOSTNAME || verificationResult.action !== env.TURNSTILE_ACTION) return json({ message: 'Verification failed. Try again.' }, 400, origin);

  const upstream = await callSupabase(env, { action: 'signup', email, cat_count: '1', tracking_method: 'other', consent: betaConsent, source: 'organic', research_opt_in: researchOptIn });
  const result = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  if (!upstream.ok) return json({ message: result.error ?? 'Unable to save signup right now.' }, 502, origin);
  return json({ message: result.duplicate ? 'You are already on the beta list.' : 'Check your email for your beta confirmation.' }, 202, origin);
};