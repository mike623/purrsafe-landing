import { json, type WaitlistEnv } from '../beta-waitlist/_shared.js';

interface Env extends WaitlistEnv {
  RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };

const GLOBAL_RATE_LIMIT_KEY = 'beta-events:global';

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
  const allowed = (env.ALLOWED_ORIGINS ?? env.PUBLIC_SITE_URL).split(',').map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
};

export const onRequestOptions = ({ request, env }: Context) =>
  new Response(null, { status: 204, headers: { 'access-control-allow-origin': originFor(request, env) ?? 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });

export const onRequestGet = () =>
  new Response('POST required', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });

export const onRequestPost = async ({ request, env }: Context) => {
  if (!originFor(request, env)) return json({ message: 'Origin not allowed.' }, 403);

  const body = await request.json().catch(() => ({})) as { event_name?: unknown };
  const eventName = typeof body.event_name === 'string' ? body.event_name : '';
  if (!clientEvents.has(eventName)) return json({ message: 'Unsupported event.' }, 400);

  if (env.RATE_LIMITER) {
    const limit = await env.RATE_LIMITER.limit({ key: GLOBAL_RATE_LIMIT_KEY });
    if (!limit.success) return json({ message: 'Too many events.' }, 429);
  }

  const upstream = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'analytics', event_name: eventName, source: SOURCE }),
  }).catch(() => undefined);

  // Analytics must never degrade the funnel, so an upstream failure is reported
  // without detail and the page ignores it.
  if (!upstream?.ok) return json({ message: 'Event not recorded.' }, 502);
  return json({ success: true });
};
