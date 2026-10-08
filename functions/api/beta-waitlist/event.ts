import {
  assertRateLimit,
  clientKey,
  json,
  logFailure,
  logMisconfiguration,
  missingEnv,
  pruneRateLimits,
  RATE_LIMITED,
  type D1Database,
  type WaitlistEnv,
} from '../beta-waitlist/_shared.js';

interface Env extends WaitlistEnv {
  DB: D1Database;
  // Optional by platform, not by policy: Pages Functions receive only a subset of
  // Workers bindings and the Cloudflare Rate Limiting binding is not in it
  // (https://developers.cloudflare.com/pages/functions/bindings/), so production
  // is metered by the D1 counter below. This stays declared so the handler still
  // honours a platform limiter if it is ever hosted as a Worker.
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };

const ROUTE = 'beta-waitlist/event';
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_SITE_URL'] as const;
const GLOBAL_RATE_LIMIT_KEY = 'beta-events:global';
// A visitor emits at most three events per page, so these ceilings leave normal
// browsing untouched while capping what a scripted caller can add to the funnel
// counts. Analytics is best-effort by design, so shedding past the cap is safe.
const GLOBAL_RATE_LIMIT_MAX_EVENTS = 600;
const CLIENT_RATE_LIMIT_MAX_EVENTS = 30;

/**
 * Only the three funnel events a visitor's browser can legitimately observe.
 * `beta_form_submitted`, `beta_confirmation_sent`, `beta_confirmation_clicked`
 * and the activation events are recorded server-side by the Supabase function
 * from state it can actually verify, so accepting them here would let anyone
 * forge conversion counts with a curl loop.
 */
const clientEvents = new Set(['beta_page_view', 'beta_cta_click', 'beta_form_started']);

/**
 * The payload forwarded upstream is rebuilt from scratch — only the event name
 * and source survive. Nothing a caller puts in the body can reach the event
 * sink, so an email address or cat detail cannot end up in `beta_funnel_events`
 * even by accident. Signup is recorded as `organic`, so events match it.
 */
const SOURCE = 'organic';

const originFor = (request: Request, env: Env) => {
  const origin = request.headers.get('Origin');
  // Defaults to the empty allowlist so an unconfigured deployment denies the
  // request instead of throwing out of the preflight handler as a 1101.
  const allowed = (env?.ALLOWED_ORIGINS ?? env?.PUBLIC_SITE_URL ?? '').split(',').map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
};

export const onRequestOptions = ({ request, env }: Context) =>
  new Response(null, { status: 204, headers: { 'access-control-allow-origin': originFor(request, env) ?? 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });

export const onRequestGet = () =>
  new Response('POST required', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });

export const onRequestPost = async ({ request, env }: Context) => {
  // Checked before anything reads a binding: an unset value would otherwise throw
  // and reach the browser as a 1101, which hides an incomplete deployment behind
  // what looks like an application bug.
  const missing = missingEnv(env, REQUIRED_VARS);
  if (!env?.DB || typeof env.DB.prepare !== 'function') missing.push('DB');
  if (missing.length) {
    logMisconfiguration(ROUTE, missing);
    return json({ message: 'Event not recorded.' }, 503);
  }

  if (!originFor(request, env)) return json({ message: 'Origin not allowed.' }, 403);

  const body = await request.json().catch(() => ({})) as { event_name?: unknown };
  const eventName = typeof body.event_name === 'string' ? body.event_name : '';
  if (!clientEvents.has(eventName)) return json({ message: 'Unsupported event.' }, 400);

  try {
    if (env.RATE_LIMITER) {
      const platformLimit = await env.RATE_LIMITER.limit({ key: GLOBAL_RATE_LIMIT_KEY });
      if (!platformLimit.success) throw new Error(RATE_LIMITED);
    }
    const now = Math.floor(Date.now() / 1000);
    await pruneRateLimits(env.DB, now);
    await assertRateLimit(env.DB, GLOBAL_RATE_LIMIT_KEY, GLOBAL_RATE_LIMIT_MAX_EVENTS);
    await assertRateLimit(env.DB, `beta-events:client:${clientKey(request)}`, CLIENT_RATE_LIMIT_MAX_EVENTS);
  } catch (error) {
    if (error instanceof Error && error.message === RATE_LIMITED) return json({ message: 'Too many events.' }, 429);
    // D1 carries the only quota this deployment can enforce, so an unreadable
    // counter drops the event instead of forwarding it unmetered.
    logFailure(ROUTE, 'quota check', error);
    return json({ message: 'Event not recorded.' }, 503);
  }

  let upstream: Response | null = null;
  try {
    upstream = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'analytics', event_name: eventName, source: SOURCE }),
    });
  } catch (error) {
    logFailure(ROUTE, 'upstream analytics', error);
  }

  // Analytics must never degrade the funnel, so an upstream failure is reported
  // without detail and the page ignores it.
  if (!upstream?.ok) return json({ message: 'Event not recorded.' }, 502);
  return json({ success: true });
};
