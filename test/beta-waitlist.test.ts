import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/beta-waitlist';
import { onRequestGet as verify } from '../functions/api/beta-waitlist/verify';
import { onRequestGet as unsubscribe } from '../functions/api/beta-waitlist/unsubscribe';
import { type D1Database, type D1Statement, type WaitlistEnv } from '../functions/api/beta-waitlist/_shared';

const env = (db: D1Database): WaitlistEnv & Record<string, unknown> => ({
  DB: db,
  PUBLIC_SITE_URL: 'https://pursafe.example',
  TURNSTILE_SECRET: 'turnstile-secret',
  TURNSTILE_HOSTNAME: 'pursafe.example',
  TURNSTILE_ACTION: 'beta_waitlist',
  RESEND_API_KEY: 'resend-secret',
  RESEND_FROM: 'PurrSafe <beta@pursafe.example>',
  ALLOWED_ORIGINS: 'https://pursafe.example',
});

function database(options: { rateCount?: number; changes?: number } = {}): D1Database {
  let rateCount = options.rateCount ?? 0;
  return {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) { values = nextValues; return this; },
        async first<T>() {
          if (query.includes('rate_limits')) {
            rateCount += 1;
            return { request_count: rateCount } as T;
          }
          return null;
        },
        async run() {
          if (query.includes('verification_token_hash') || query.includes('unsubscribe_token_hash')) return { meta: { changes: options.changes ?? 1 } };
          void values;
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

function request(ip = '203.0.113.10') {
  const form = new FormData();
  form.set('email', 'cat@example.com');
  form.set('beta_consent', 'yes');
  form.set('research_opt_in', 'no');
  form.set('cf-turnstile-response', 'turnstile-token');
  return new Request('https://pursafe.example/api/beta-waitlist', {
    method: 'POST',
    headers: { Origin: 'https://pursafe.example', 'CF-Connecting-IP': ip },
    body: form,
  });
}

const turnstileSuccess = () => new Response(JSON.stringify({ success: true, hostname: 'pursafe.example', action: 'beta_waitlist' }));

afterEach(() => vi.restoreAllMocks());

describe('beta waitlist security controls', () => {
  it('rate limits before storage and email work', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(turnstileSuccess()));
    const response = await onRequestPost({ request: request(), env: env(database({ rateCount: 5 })) as never });
    expect(response.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects Turnstile hostname or action mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, hostname: 'attacker.example', action: 'other' }))));
    const response = await onRequestPost({ request: request(), env: env(database()) as never });
    expect(response.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not put email in verification or unsubscribe URLs', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => url.includes('siteverify') ? turnstileSuccess() : new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await onRequestPost({ request: request(), env: env(database()) as never });
    expect(response.status).toBe(202);
    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const emailBody = JSON.parse(String(requestInit.body)) as { html: string };
    expect(emailBody.html).not.toContain('email=');
    expect(emailBody.html).toContain('/verify?token=');
    expect(emailBody.html).toContain('/unsubscribe?token=');
  });

  it('consumes verification token once and redirects without token or email', async () => {
    const db = database({ changes: 1 });
    const response = await verify({ request: new Request('https://pursafe.example/api/beta-waitlist/verify?token=verify-token'), env: env(db) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=verified');
    expect(response.headers.get('location')).not.toContain('token');

  });

  it('expires and one-time consumes unsubscribe token', async () => {
    const response = await unsubscribe({ request: new Request('https://pursafe.example/api/beta-waitlist/unsubscribe?token=unsubscribe-token'), env: env(database({ changes: 0 })) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
  });
});
