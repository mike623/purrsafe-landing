import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestOptions, onRequestPost } from '../functions/api/beta-waitlist/event.js';
import { type D1Database, type D1Statement } from '../functions/api/beta-waitlist/_shared.js';

const ORIGIN = 'https://purrsafe.example';

// A Pages deployment cannot carry a rate-limit binding, so RATE_LIMITER is absent
// unless a case supplies one. See
// https://developers.cloudflare.com/pages/functions/bindings/.
function database(start = 0) {
  let count = start;
  const db: D1Database = {
    prepare(): D1Statement {
      return {
        bind() { return this; },
        async first<T>() { count += 1; return { request_count: count } as T; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
  return db;
}

const brokenDatabase = (): D1Database => ({
  prepare() { throw new Error('D1_ERROR: no such table: beta_registration_rate_limits'); },
});

const env = (overrides: Record<string, unknown> = {}) => ({
  DB: database(),
  PUBLIC_SITE_URL: ORIGIN,
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  ALLOWED_ORIGINS: ORIGIN,
  ...overrides,
}) as never;

const request = (body: unknown, origin: string | null = ORIGIN, ip = '203.0.113.10') =>
  new Request(`${ORIGIN}/api/beta-waitlist/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });

const upstreamOk = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })));

afterEach(() => vi.restoreAllMocks());

describe('beta funnel event endpoint', () => {
  it('forwards each client-observable funnel event to Supabase', async () => {
    for (const eventName of ['beta_page_view', 'beta_cta_click', 'beta_form_started']) {
      const fetchSpy = upstreamOk();
      const response = await onRequestPost({ request: request({ event_name: eventName }), env: env() });

      expect(response.status).toBe(200);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://project.supabase.co/functions/v1/beta-waitlist');
      expect(JSON.parse(String(init.body))).toEqual({ action: 'analytics', event_name: eventName, source: 'organic' });
      vi.restoreAllMocks();
    }
  });

  it('rejects server-owned events so conversions cannot be forged', async () => {
    for (const eventName of ['beta_form_submitted', 'beta_confirmation_sent', 'beta_confirmation_clicked', 'beta_unsubscribed', 'beta_activation']) {
      const fetchSpy = upstreamOk();
      const response = await onRequestPost({ request: request({ event_name: eventName }), env: env() });

      expect(response.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('rejects an unknown event name and a missing event name', async () => {
    for (const body of [{ event_name: 'anything_else' }, { event_name: '' }, { event_name: 42 }, {}]) {
      const fetchSpy = upstreamOk();
      expect((await onRequestPost({ request: request(body), env: env() })).status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('never forwards caller-supplied fields, so no email can reach the event sink', async () => {
    const fetchSpy = upstreamOk();
    await onRequestPost({
      request: request({ event_name: 'beta_page_view', email: 'cat@example.com', cat_count: '3+', source: 'creator', note: 'Mochi' }),
      env: env(),
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const forwarded = JSON.parse(String(init.body));
    expect(Object.keys(forwarded).sort()).toEqual(['action', 'event_name', 'source']);
    expect(forwarded.source).toBe('organic');
    expect(String(init.body)).not.toContain('cat@example.com');
    expect(String(init.body)).not.toContain('Mochi');
  });

  it('refuses a disallowed or absent origin', async () => {
    const fetchSpy = upstreamOk();
    expect((await onRequestPost({ request: request({ event_name: 'beta_page_view' }, 'https://evil.example'), env: env() })).status).toBe(403);
    expect((await onRequestPost({ request: request({ event_name: 'beta_page_view' }, null), env: env() })).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports an upstream failure without detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env() });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ message: 'Event not recorded.' });
  });

  it('survives an upstream network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect((await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env() })).status).toBe(502);
  });

  it('answers GET with 405 and preflight with the allowed origin', async () => {
    expect(onRequestGet().status).toBe(405);
    const preflight = onRequestOptions({ request: request({}, ORIGIN), env: env() });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});

// Each case here is a deployment or request shape that would otherwise throw out
// of the Function and surface to the browser as an opaque Cloudflare 1101.
describe('beta funnel event endpoint without complete configuration', () => {
  it('answers 503 for each missing value instead of throwing a 1101', async () => {
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_SITE_URL']) {
      const fetchSpy = upstreamOk();
      const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ [key]: undefined }) });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ message: 'Event not recorded.' });
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('answers 503 when the D1 binding is absent or not a database', async () => {
    for (const db of [undefined, {}, 'DB']) {
      const fetchSpy = upstreamOk();
      expect((await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ DB: db }) })).status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('answers a preflight from an empty env instead of throwing', () => {
    const preflight = onRequestOptions({ request: request({}, ORIGIN), env: {} as never });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('null');
  });

  it('drops the event rather than forwarding it unmetered when D1 is unreadable', async () => {
    const fetchSpy = upstreamOk();
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ DB: brokenDatabase() }) });

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('beta funnel event quota', () => {
  it('meters events in D1, which is the only quota a Pages deployment can enforce', async () => {
    const fetchSpy = upstreamOk();
    // The global counter is already past its ceiling, so the next event sheds.
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ DB: database(600) }) });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ message: 'Too many events.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caps one client without shedding traffic that is under the global ceiling', async () => {
    const fetchSpy = upstreamOk();
    // 30 client events are allowed; the stub counts the global row first, so a
    // start of 30 puts only the per-client row over its ceiling.
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ DB: database(30) }) });

    expect(response.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still honours a platform rate limiter when one is bound', async () => {
    const fetchSpy = upstreamOk();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ RATE_LIMITER: { limit } }) });

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'beta-events:global' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
