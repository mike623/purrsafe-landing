import { assertRateLimit, clientKey, logFailure, logMisconfiguration, missingEnv, pruneRateLimits, RATE_LIMITED, type D1Database } from './beta-waitlist/_shared.js';

interface Env {
  DB: D1Database;
  // Pages Functions support only a subset of Workers bindings, and the Cloudflare
  // Rate Limiting binding is not in it, so a Pages deployment never receives one
  // however `[[ratelimits]]` is written. See
  // https://developers.cloudflare.com/pages/functions/bindings/. The D1 quota
  // below is the quota that actually runs in production; this stays optional so
  // the handler keeps working if it is ever hosted as a Worker.
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_ACTION: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  PUBLIC_SITE_URL: string;
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };
const ROUTE = 'beta-waitlist';
const RATE_LIMIT_MAX_REQUESTS = 5;
const GLOBAL_RATE_LIMIT_KEY = 'beta-waitlist:global';
const GLOBAL_RATE_LIMIT_MAX_REQUESTS = 100;
const REQUIRED_VARS = ['TURNSTILE_SECRET', 'TURNSTILE_HOSTNAME', 'TURNSTILE_ACTION', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_SITE_URL'] as const;
const UNAVAILABLE_MESSAGE = 'Beta signup is temporarily unavailable.';

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

const browserRedirect = (env: Env, result: 'registered' | 'error') => {
  const url = new URL('/', env.PUBLIC_SITE_URL);
  url.searchParams.set('beta', result);
  return new Response(null, {
    status: 303,
    headers: { location: url.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
};

const wantsHtml = (request: Request) => {
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
};

const originFor = (request: Request, env: Env) => {
  const origin = request.headers.get('Origin');
  // Defaults to the empty allowlist so an unconfigured deployment denies the
  // request instead of throwing out of the preflight handler.
  const allowed = (env?.ALLOWED_ORIGINS ?? env?.PUBLIC_SITE_URL ?? '').split(',').map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
};

const callSupabase = async (env: Env, body: Record<string, unknown>) => fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const onRequestOptions = ({ request, env }: Context) =>
  new Response(null, { status: 204, headers: { 'access-control-allow-origin': originFor(request, env) ?? 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });

export const onRequestPost = async ({ request, env }: Context) => {
  // Checked before anything reads a binding: an unset value would otherwise throw
  // and reach the client as a 1101, which hides an incomplete deployment behind
  // what looks like an application bug.
  const missing = missingEnv(env, REQUIRED_VARS);
  if (!env?.DB || typeof env.DB.prepare !== 'function') missing.push('DB');
  if (missing.length) {
    logMisconfiguration(ROUTE, missing);
    // A redirect needs a trustworthy canonical origin, so fall back to JSON when
    // PUBLIC_SITE_URL is itself the missing value.
    return missing.includes('PUBLIC_SITE_URL') || !wantsHtml(request)
      ? json({ message: UNAVAILABLE_MESSAGE }, 503)
      : browserRedirect(env, 'error');
  }

  const origin = originFor(request, env);
  if (!origin) return json({ message: 'Origin not allowed.' }, 403);

  // `formData()` rejects any body that is not multipart or url-encoded, so an
  // arbitrary POST body has to be answered rather than allowed to throw.
  const form = await request.formData().catch(() => null);
  if (!form) return wantsHtml(request)
    ? browserRedirect(env, 'error')
    : json({ message: 'Send the signup fields as form data.' }, 400, origin);

  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const betaConsent = form.get('beta_consent') === 'yes';
  const turnstileToken = String(form.get('cf-turnstile-response') ?? '');
  const htmlFallback = wantsHtml(request);
  if (!/^\S+@\S+\.\S+$/.test(email) || !betaConsent || !turnstileToken) {
    return htmlFallback
      ? browserRedirect(env, 'error')
      : json({ message: 'Enter a valid email, accept beta consent, and complete verification.' }, 400, origin);
  }

  // An unreachable siteverify must not admit an unverified signup, so this stays
  // fail-closed instead of throwing or skipping the check.
  let verificationResult: { success?: boolean; hostname?: string; action?: string } | null = null;
  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: turnstileToken, remoteip: request.headers.get('CF-Connecting-IP') ?? '' }) });
    verificationResult = await verification.json() as { success?: boolean; hostname?: string; action?: string };
  } catch (error) {
    logFailure(ROUTE, 'turnstile verification', error);
  }
  if (!verificationResult) return htmlFallback
    ? browserRedirect(env, 'error')
    : json({ message: UNAVAILABLE_MESSAGE }, 503, origin);
  if (!verificationResult.success || verificationResult.hostname !== env.TURNSTILE_HOSTNAME || verificationResult.action !== env.TURNSTILE_ACTION) return htmlFallback
    ? browserRedirect(env, 'error')
    : json({ message: 'Verification failed. Try again.' }, 400, origin);

  try {
    // Optional by platform, not by policy: see the RATE_LIMITER note on Env.
    if (env.RATE_LIMITER) {
      const platformLimit = await env.RATE_LIMITER.limit({ key: GLOBAL_RATE_LIMIT_KEY });
      if (!platformLimit.success) throw new Error(RATE_LIMITED);
    }
    const now = Math.floor(Date.now() / 1000);
    await pruneRateLimits(env.DB, now);
    await assertRateLimit(env.DB, GLOBAL_RATE_LIMIT_KEY, GLOBAL_RATE_LIMIT_MAX_REQUESTS);
    await assertRateLimit(env.DB, `client:${clientKey(request)}`, RATE_LIMIT_MAX_REQUESTS);
  } catch (error) {
    if (error instanceof Error && error.message === RATE_LIMITED) return wantsHtml(request)
      ? browserRedirect(env, 'error')
      : json({ message: 'Too many attempts. Try again later.' }, 429, origin);
    // D1 carries the only quota this deployment can enforce, so an unreadable
    // counter rejects the request instead of waving it through unmetered.
    logFailure(ROUTE, 'quota check', error);
    return wantsHtml(request)
      ? browserRedirect(env, 'error')
      : json({ message: UNAVAILABLE_MESSAGE }, 503, origin);
  }

  let upstream: Response | null = null;
  try {
    upstream = await callSupabase(env, { action: 'signup', email, cat_count: '1', tracking_method: 'other', consent: betaConsent, source: 'organic' });
  } catch (error) {
    logFailure(ROUTE, 'upstream signup', error);
  }
  if (!upstream) return wantsHtml(request)
    ? browserRedirect(env, 'error')
    : json({ message: 'Unable to save signup right now.' }, 502, origin);
  const result = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  if (!upstream.ok) return wantsHtml(request)
    ? browserRedirect(env, 'error')
    : json({ message: result.error ?? 'Unable to save signup right now.' }, 502, origin);
  return wantsHtml(request)
    ? browserRedirect(env, 'registered')
    : json({ message: result.duplicate ? 'You are already on the beta list.' : 'Check your email for your beta confirmation.' }, 202, origin);
};