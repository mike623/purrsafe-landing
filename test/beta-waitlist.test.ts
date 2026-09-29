import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/beta-waitlist.js';
import { onRequestGet as verifyGet, onRequestPost as verifyPost } from '../functions/api/beta-waitlist/verify.js';
import { onRequestGet as unsubscribeGet, onRequestPost as unsubscribePost } from '../functions/api/beta-waitlist/unsubscribe.js';
import { type D1Database, type D1Statement, type WaitlistEnv } from '../functions/api/beta-waitlist/_shared.js';

type TestEnv = WaitlistEnv & {
  DB: D1Database;
  RATE_LIMITER: { limit: ReturnType<typeof vi.fn> };
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_ACTION: string;
  ALLOWED_ORIGINS: string;
};

const turnstileSuccess = () => new Response(JSON.stringify({ success: true, hostname: 'pursafe.example', action: 'beta_waitlist' }));
const supabaseSuccess = (body: Record<string, unknown> = { success: true }) => new Response(JSON.stringify(body), { status: 200 });

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

const env = (db = database(), platformAllowed = true): TestEnv => ({
  DB: db,
  RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: platformAllowed }) },
  PUBLIC_SITE_URL: 'https://pursafe.example',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  TURNSTILE_SECRET: 'turnstile-secret',
  TURNSTILE_HOSTNAME: 'pursafe.example',
  TURNSTILE_ACTION: 'beta_waitlist',
  ALLOWED_ORIGINS: 'https://pursafe.example',
});

function request(ip = '203.0.113.10') {
  const form = new FormData();
  form.set('email', 'cat@example.com');
  form.set('beta_consent', 'yes');
  form.set('research_opt_in', 'no');
  form.set('cf-turnstile-response', 'turnstile-token');
  return new Request('https://pursafe.example/api/beta-waitlist', { method: 'POST', headers: { Accept: 'application/json', Origin: 'https://pursafe.example', 'CF-Connecting-IP': ip }, body: form });
}

const tokenRequest = (token: string) => new Request('https://pursafe.example/api/beta-waitlist/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });

afterEach(() => vi.restoreAllMocks());

describe('beta waitlist abuse boundary', () => {
  it('enforces the Cloudflare platform limiter before any upstream work', async () => {
    const platformEnv = env(database(), false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(turnstileSuccess()));
    const response = await onRequestPost({ request: request(), env: platformEnv as never });
    expect(response.status).toBe(429);
    expect(platformEnv.RATE_LIMITER.limit).toHaveBeenCalledWith({ key: 'beta-waitlist:global' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('applies a shared global quota before per-IP quota', async () => {
    const db = database(100);
    const platformEnv = env(db);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(turnstileSuccess()));
    const response = await onRequestPost({ request: request('198.51.100.1'), env: platformEnv as never });
    expect(response.status).toBe(429);
    expect(db.queries.filter((query) => query.includes('beta_registration_rate_limits'))).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('prunes old limiter rows and delegates registration to Supabase', async () => {
    const db = database();
    const fetchMock = vi.fn().mockImplementation((url: string) => url.includes('siteverify') ? turnstileSuccess() : supabaseSuccess());
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: request(), env: env(db) as never });
    expect(response.status).toBe(202);
    expect(db.queries.some((query) => query.includes('DELETE FROM beta_registration_rate_limits'))).toBe(true);
    expect(db.queries.every((query) => !query.includes('beta_registrations'))).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('https://project.supabase.co/functions/v1/beta-waitlist');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ action: 'signup', email: 'cat@example.com', consent: true });
  });

  it('rejects Turnstile hostname or action mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: 'attacker.example', action: 'other' }))));
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a no-JS browser form submission without a Turnstile token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: new Request(request().url, { method: 'POST', headers: { Origin: 'https://pursafe.example', 'CF-Connecting-IP': '203.0.113.10' }, body: (() => { const form = new FormData(); form.set('email', 'cat@example.com'); form.set('beta_consent', 'yes'); return form; })() }), env: env() as never });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('safe token transport', () => {
  it('does not accept bearer tokens in GET query strings', async () => {
    const testEnv = env();
    const verify = verifyGet({ request: new Request('https://pursafe.example/api/beta-waitlist/verify?token=secret'), env: testEnv });
    const unsubscribe = unsubscribeGet({ request: new Request('https://pursafe.example/api/beta-waitlist/unsubscribe?token=secret'), env: testEnv });
    expect(verify.status).toBe(405);
    expect(unsubscribe.status).toBe(405);
    expect(verify.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('forwards confirmation credentials only in a POST body and returns JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(supabaseSuccess());
    vi.stubGlobal('fetch', fetchMock);
    const response = await verifyPost({ request: tokenRequest('secret-token-1234567890'), env: env() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: 'Signup confirmed.' });
    expect(fetchMock.mock.calls[0][0]).not.toContain('?token=');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ action: 'confirm', token: 'secret-token-1234567890' });
  });

  it('surfaces an upstream confirmation failure without claiming success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Confirmation link is invalid or expired' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await verifyPost({ request: tokenRequest('secret-token-1234567890'), env: env() });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Confirmation link is invalid or expired' });
  });

  it('forwards unsubscribe credentials only in a POST body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(supabaseSuccess());
    vi.stubGlobal('fetch', fetchMock);
    await unsubscribePost({ request: new Request('https://pursafe.example/api/beta-waitlist/unsubscribe', { method: 'POST', body: JSON.stringify({ token: 'secret-token-1234567890' }), headers: { 'content-type': 'application/json' } }), env: env() });
    expect(fetchMock.mock.calls[0][0]).not.toContain('?token=');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ action: 'unsubscribe', token: 'secret-token-1234567890' });
  });

  it('rejects oversized token credentials before upstream work', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await verifyPost({ request: tokenRequest('x'.repeat(257)), env: env() });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Confirmation link is invalid or expired.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
