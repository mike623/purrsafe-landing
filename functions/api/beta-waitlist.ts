import { createToken, hash, type D1Database } from './beta-waitlist/_shared';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_ACTION: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  PUBLIC_SITE_URL: string;
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

const json = (body: Record<string, unknown>, status = 200, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

const assertRateLimit = async (db: D1Database, key: string) => {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`
    INSERT INTO beta_registration_rate_limits (client_key, request_count, window_started_at)
    VALUES (?1, 1, ?2)
    ON CONFLICT(client_key) DO UPDATE SET
      request_count = CASE WHEN ?2 - window_started_at >= ?3 THEN 1 ELSE request_count + 1 END,
      window_started_at = CASE WHEN ?2 - window_started_at >= ?3 THEN ?2 ELSE window_started_at END
    RETURNING request_count
  `).bind(key, now, RATE_LIMIT_WINDOW_SECONDS).first<{ request_count: number }>();
  if (!row || row.request_count > RATE_LIMIT_MAX_REQUESTS) {
    throw new Error('rate_limited');
  }
};

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
    await assertRateLimit(env.DB, clientKey(request));
  } catch (error) {
    if (error instanceof Error && error.message === 'rate_limited') return json({ message: 'Too many attempts. Try again later.' }, 429, origin);
    throw error;
  }

  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: turnstileToken, remoteip: request.headers.get('CF-Connecting-IP') ?? '' }) });
  const verificationResult = await verification.json() as { success?: boolean; hostname?: string; action?: string };
  if (!verificationResult.success || verificationResult.hostname !== env.TURNSTILE_HOSTNAME || verificationResult.action !== env.TURNSTILE_ACTION) return json({ message: 'Verification failed. Try again.' }, 400, origin);

  const verificationToken = createToken();
  const unsubscribeToken = createToken();
  const verificationTokenHash = await hash(verificationToken);
  const unsubscribeTokenHash = await hash(unsubscribeToken);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await env.DB.prepare(`INSERT INTO beta_registrations (email, beta_consent, research_opt_in, verification_token_hash, token_expires_at, unsubscribe_token_hash, unsubscribe_token_expires_at, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET beta_consent = 1, research_opt_in = excluded.research_opt_in, verification_token_hash = excluded.verification_token_hash, token_expires_at = excluded.token_expires_at, token_used_at = NULL, unsubscribe_token_hash = excluded.unsubscribe_token_hash, unsubscribe_token_expires_at = excluded.unsubscribe_token_expires_at, unsubscribe_used_at = NULL, unsubscribed_at = NULL`)
    .bind(email, researchOptIn ? 1 : 0, verificationTokenHash, expires.toISOString(), unsubscribeTokenHash, expires.toISOString(), now.toISOString()).run();

  const baseUrl = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const verifyUrl = `${baseUrl}/api/beta-waitlist/verify?token=${encodeURIComponent(verificationToken)}`;
  const unsubscribeUrl = `${baseUrl}/api/beta-waitlist/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.RESEND_FROM, to: [email], subject: 'Verify your PurrSafe beta registration', html: `<p>Thanks for joining PurrSafe private beta.</p><p><a href="${verifyUrl}">Verify your email</a> within 24 hours.</p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>` }) });
  if (!sent.ok) return json({ message: 'Registration saved, but verification email could not be sent. Try again later.' }, 502, origin);
  return json({ message: 'Check your email to verify your beta registration.' }, 202, origin);
};