import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/beta-waitlist.js';
import { onRequestGet as verifyGet, onRequestPost as verifyPost } from '../functions/api/beta-waitlist/verify.js';
import { onRequestGet as unsubscribeGet, onRequestPost as unsubscribePost } from '../functions/api/beta-waitlist/unsubscribe.js';
import { readFileSync } from 'node:fs';
import {
  BETA_WAITLIST_TURNSTILE_ACTION,
  TURNSTILE_TOKEN_MAX_LENGTH,
  type D1Database,
  type D1Statement,
  type WaitlistEnv,
} from '../functions/api/beta-waitlist/_shared.js';

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

function request(ip = '203.0.113.10', token = 'turnstile-token') {
  const form = new FormData();
  form.set('email', 'cat@example.com');
  form.set('beta_consent', 'yes');
  form.set('research_opt_in', 'no');
  form.set('cf-turnstile-response', token);
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

  it.each(['text/html', 'application/json'])('rejects missing Turnstile tokens for %s before upstream work', async (accept) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const testEnv = env();
    const form = new FormData();
    form.set('email', 'cat@example.com');
    form.set('beta_consent', 'yes');
    const response = await onRequestPost({
      request: new Request(request().url, {
        method: 'POST',
        headers: { Accept: accept, Origin: 'https://pursafe.example', 'CF-Connecting-IP': '203.0.113.10' },
        body: form,
      }),
      env: testEnv as never,
    });
    expect(response.status).toBe(accept === 'text/html' ? 303 : 400);
    if (accept === 'text/html') expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=error');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testEnv.RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
});

const siteverifyCall = (fetchMock: ReturnType<typeof vi.fn>) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('siteverify'));
  if (!call) throw new Error('siteverify was not called');
  const init = call[1] as RequestInit;
  return { url: String(call[0]), init, body: new URLSearchParams(String(init.body)) };
};

const siteverifyOnly = (payload: Response | Error) => {
  const mock = vi.fn().mockImplementation((url: string) => {
    if (!url.includes('siteverify')) return supabaseSuccess();
    return payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

describe('turnstile verification', () => {
  it('accepts an exact success/action/hostname match and posts a canonical siteverify request', async () => {
    const fetchMock = siteverifyOnly(turnstileSuccess());
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(202);

    const { url, init, body } = siteverifyCall(fetchMock);
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(body)).toEqual({
      secret: 'turnstile-secret',
      response: 'turnstile-token',
      remoteip: '203.0.113.10',
    });
  });

  it('uses the shared beta_waitlist action when TURNSTILE_ACTION is unset', async () => {
    const fetchMock = siteverifyOnly(new Response(JSON.stringify({ success: true, hostname: 'pursafe.example', action: BETA_WAITLIST_TURNSTILE_ACTION })));
    const testEnv = { ...env(), TURNSTILE_ACTION: '' };
    const response = await onRequestPost({ request: request(), env: testEnv as never });
    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an action mismatch without touching Supabase', async () => {
    const fetchMock = siteverifyOnly(new Response(JSON.stringify({ success: true, hostname: 'pursafe.example', action: 'contact' })));
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Verification failed. Try again.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a hostname mismatch without touching Supabase', async () => {
    const fetchMock = siteverifyOnly(new Response(JSON.stringify({ success: true, hostname: 'localhost', action: 'beta_waitlist' })));
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['string', 'true'],
    ['number', 1],
    ['object', {}],
    ['null', null],
    ['absent', undefined],
  ])('rejects a non-boolean %s success claim', async (_label, success) => {
    const fetchMock = siteverifyOnly(new Response(JSON.stringify({ success, hostname: 'pursafe.example', action: 'beta_waitlist' })));
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a replayed token with the generic verification failure', async () => {
    const fetchMock = siteverifyOnly(new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Verification failed. Try again.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies a maximum-length token upstream', async () => {
    const fetchMock = siteverifyOnly(turnstileSuccess());
    const token = 'x'.repeat(TURNSTILE_TOKEN_MAX_LENGTH);
    const response = await onRequestPost({ request: request('203.0.113.11', token), env: env() as never });
    expect(response.status).toBe(202);
    expect(siteverifyCall(fetchMock).body.get('response')).toBe(token);
  });

  it('rejects an oversized token before any upstream call', async () => {
    const fetchMock = siteverifyOnly(turnstileSuccess());
    const testEnv = env();
    const response = await onRequestPost({ request: request('203.0.113.12', 'x'.repeat(TURNSTILE_TOKEN_MAX_LENGTH + 1)), env: testEnv as never });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Enter a valid email, accept beta consent, and complete verification.' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testEnv.RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it.each([
    ['TURNSTILE_SECRET', { TURNSTILE_SECRET: '' }],
    ['TURNSTILE_SECRET whitespace', { TURNSTILE_SECRET: '   ' }],
    ['TURNSTILE_HOSTNAME', { TURNSTILE_HOSTNAME: '' }],
  ])('fails closed when %s is missing, without calling siteverify', async (_label, overrides) => {
    const fetchMock = siteverifyOnly(turnstileSuccess());
    const testEnv = { ...env(), ...overrides };
    const response = await onRequestPost({ request: request(), env: testEnv as never });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Verification failed. Try again.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a 500 from siteverify', new Response('upstream boom', { status: 500 })],
    ['a 403 from siteverify', new Response(JSON.stringify({ success: true, hostname: 'pursafe.example', action: 'beta_waitlist' }), { status: 403 })],
    ['an unparseable siteverify body', new Response('<html>not json</html>', { status: 200 })],
    ['a non-object siteverify body', new Response('"ok"', { status: 200 })],
    ['a network error', new TypeError('network down')],
    ['a siteverify timeout', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })],
  ])('fails closed on %s', async (_label, outcome) => {
    const fetchMock = siteverifyOnly(outcome);
    const response = await onRequestPost({ request: request(), env: env() as never });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ message: 'Verification failed. Try again.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redirects the HTML fallback instead of leaking a verification failure body', async () => {
    siteverifyOnly(new Response(JSON.stringify({ success: false })));
    const form = new FormData();
    form.set('email', 'cat@example.com');
    form.set('beta_consent', 'yes');
    form.set('cf-turnstile-response', 'turnstile-token');
    const response = await onRequestPost({
      request: new Request('https://pursafe.example/api/beta-waitlist', {
        method: 'POST',
        headers: { Accept: 'text/html', Origin: 'https://pursafe.example', 'CF-Connecting-IP': '203.0.113.13' },
        body: form,
      }),
      env: env() as never,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=error');
  });
});

describe('turnstile client lifecycle', () => {
  const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

  it('sends the same action the server requires', () => {
    expect(page).toContain("import { BETA_WAITLIST_TURNSTILE_ACTION } from '../../functions/api/beta-waitlist/_shared'");
    expect(page).toContain('data-action={BETA_WAITLIST_TURNSTILE_ACTION}');
    expect(BETA_WAITLIST_TURNSTILE_ACTION).toBe('beta_waitlist');
  });

  it('renders the widget explicitly and retains its ID', () => {
    expect(page).toContain('turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback');
    expect(page).toMatch(/widgetId = window\.turnstile\.render\(/);
    expect(page).toContain('window.turnstile?.reset(widgetId)');
  });

  it('resets the widget after every AJAX attempt and on expiry or timeout', () => {
    expect(page).toMatch(/} finally \{[\s\S]*resetWidget\(\);[\s\S]*\}/);
    expect(page).toContain("'expired-callback': resetWidget");
    expect(page).toContain("'timeout-callback': resetWidget");
  });

  it('blocks a submit that has no fresh token instead of replaying one', () => {
    expect(page).toContain('window.turnstile?.getResponse(widgetId)');
    expect(page).toContain('Complete the verification check, then try again.');
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
