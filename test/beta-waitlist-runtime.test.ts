import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/beta-waitlist.js';
import { onRequestPost as verifyPost } from '../functions/api/beta-waitlist/verify.js';
import { onRequestPost as unsubscribePost } from '../functions/api/beta-waitlist/unsubscribe.js';
import { type D1Database, type D1Statement } from '../functions/api/beta-waitlist/_shared.js';

// Every case here reproduces a production deployment shape that previously threw
// out of the Function and surfaced to the client as a Cloudflare 1101 exception.

const ORIGIN = 'https://purrsafe.selenasolutions.com';

function database(start = 0) {
  let count = start;
  const queries: string[] = [];
  const db: D1Database & { queries: string[] } = {
    queries,
    prepare(query: string): D1Statement {
      queries.push(query);
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

// A Pages deployment cannot carry a rate-limit binding, so RATE_LIMITER is absent
// from every env here. See https://developers.cloudflare.com/pages/functions/bindings/.
const pagesEnv = (db: D1Database = database(), overrides: Record<string, unknown> = {}) => ({
  DB: db,
  PUBLIC_SITE_URL: ORIGIN,
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  TURNSTILE_SECRET: 'turnstile-secret',
  TURNSTILE_HOSTNAME: 'purrsafe.selenasolutions.com',
  TURNSTILE_ACTION: 'beta_waitlist',
  ALLOWED_ORIGINS: ORIGIN,
  ...overrides,
});

const turnstileSuccess = () => new Response(JSON.stringify({ success: true, hostname: 'purrsafe.selenasolutions.com', action: 'beta_waitlist' }));
const supabaseSuccess = () => new Response(JSON.stringify({ success: true }), { status: 200 });

function formRequest(accept = 'application/json', ip = '203.0.113.10') {
  const form = new FormData();
  form.set('email', 'cat@example.com');
  form.set('beta_consent', 'yes');
  form.set('cf-turnstile-response', 'turnstile-token');
  return new Request(`${ORIGIN}/api/beta-waitlist`, { method: 'POST', headers: { Accept: accept, Origin: ORIGIN, 'CF-Connecting-IP': ip }, body: form });
}

const jsonRequest = (body: string, contentType = 'application/json') => new Request(`${ORIGIN}/api/beta-waitlist`, {
  method: 'POST',
  headers: { Accept: 'application/json', Origin: ORIGIN, 'content-type': contentType, 'CF-Connecting-IP': '203.0.113.10' },
  body,
});

afterEach(() => {
  vi.restoreAllMocks();
  // Each case asserts on whether fetch ran, so no stub may leak into the next one.
  vi.unstubAllGlobals();
});

describe('Pages deployment without a rate-limit binding', () => {
  it('still registers a valid signup using the D1 quota alone', async () => {
    const db = database();
    const fetchMock = vi.fn().mockImplementation((url: string) => url.includes('siteverify') ? turnstileSuccess() : supabaseSuccess());
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(db) as never });
    expect(response.status).toBe(202);
    expect(db.queries.filter((query) => query.includes('beta_registration_rate_limits'))).toHaveLength(3);
  });

  it('still enforces the global quota through D1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(turnstileSuccess()));
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(database(100)) as never });
    expect(response.status).toBe(429);
  });

  it('honours a platform limiter when one is bound', async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(turnstileSuccess()));
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(database(), { RATE_LIMITER: { limit } }) as never });
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'beta-waitlist:global' });
  });
});

describe('unparseable request bodies', () => {
  it.each([
    ['empty JSON object', '{}', 'application/json'],
    ['bare text', 'nonsense', 'text/plain'],
  ])('answers 400 for %s instead of throwing', async (_label, body, contentType) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: jsonRequest(body, contentType), env: pagesEnv() as never });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('incomplete deployment configuration fails closed', () => {
  it.each(['TURNSTILE_SECRET', 'TURNSTILE_HOSTNAME', 'TURNSTILE_ACTION', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'PUBLIC_SITE_URL'])('answers 503 when %s is unset', async (key) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(database(), { [key]: undefined }) as never });
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 when the D1 binding is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(database(), { DB: undefined }) as never });
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 rather than admitting a signup when the D1 quota cannot be read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(turnstileSuccess());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv(brokenDatabase()) as never });
    expect(response.status).toBe(503);
    // Turnstile ran, but the signup was never proxied upstream.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when Turnstile verification is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv() as never });
    expect(response.status).toBe(503);
  });

  it('answers 502 when the upstream registration call cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('siteverify') ? Promise.resolve(turnstileSuccess()) : Promise.reject(new Error('network'))));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest(), env: pagesEnv() as never });
    expect(response.status).toBe(502);
  });

  it.each([
    ['verify', verifyPost],
    ['unsubscribe', unsubscribePost],
  ])('answers 503 from %s when Supabase configuration is unset', async (_label, handler) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request(`${ORIGIN}/api/beta-waitlist/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'secret-token-1234567890' }) });
    const response = await handler({ request, env: { PUBLIC_SITE_URL: ORIGIN } as never });
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['verify', verifyPost],
    ['unsubscribe', unsubscribePost],
  ])('answers 502 from %s when Supabase is unreachable', async (_label, handler) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request(`${ORIGIN}/api/beta-waitlist/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'secret-token-1234567890' }) });
    const response = await handler({ request, env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', PUBLIC_SITE_URL: ORIGIN } as never });
    expect(response.status).toBe(502);
  });
});

describe('browser form submissions keep the redirect contract', () => {
  it('redirects to the error state instead of throwing when configuration is incomplete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest('text/html'), env: pagesEnv(database(), { TURNSTILE_SECRET: undefined }) as never });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?beta=error`);
  });

  it('answers 503 rather than redirecting when the canonical origin itself is unset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await onRequestPost({ request: formRequest('text/html'), env: pagesEnv(database(), { PUBLIC_SITE_URL: undefined, ALLOWED_ORIGINS: ORIGIN }) as never });
    expect(response.status).toBe(503);
  });
});
