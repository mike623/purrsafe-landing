import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../functions/api/beta-waitlist';
import { onRequestGet as verify } from '../functions/api/beta-waitlist/verify';
import { onRequestGet as unsubscribe } from '../functions/api/beta-waitlist/unsubscribe';
import { hash, type D1Database, type D1Statement, type WaitlistEnv } from '../functions/api/beta-waitlist/_shared.js';

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

type TokenRow = {
  verificationTokenHash: string;
  verificationExpiresAt: string;
  verificationUsedAt: string | null;
  unsubscribeTokenHash: string;
  unsubscribeExpiresAt: string;
  unsubscribeUsedAt: string | null;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
};

function database(options: { rateCount?: number; token?: Partial<TokenRow> } = {}): D1Database {
  let rateCount = options.rateCount ?? 0;
  const token: TokenRow = {
    verificationTokenHash: 'verification-hash',
    verificationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    verificationUsedAt: null,
    unsubscribeTokenHash: 'unsubscribe-hash',
    unsubscribeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    unsubscribeUsedAt: null,
    verifiedAt: null,
    unsubscribedAt: null,
    ...options.token,
  };
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
          if (query.includes('verification_token_hash')) {
            const [verifiedAt, tokenUsedAt, tokenHash, expiresAt] = values as [string, string, string, string];
            const changes = tokenHash === token.verificationTokenHash && token.verificationExpiresAt > expiresAt && token.verificationUsedAt === null ? 1 : 0;
            if (changes) {
              token.verifiedAt = verifiedAt;
              token.verificationUsedAt = tokenUsedAt;
            }
            return { meta: { changes } };
          }
          if (query.includes('unsubscribe_token_hash')) {
            const [unsubscribedAt, tokenUsedAt, tokenHash, expiresAt] = values as [string, string, string, string];
            const changes = tokenHash === token.unsubscribeTokenHash && token.unsubscribeExpiresAt > expiresAt && token.unsubscribeUsedAt === null ? 1 : 0;
            if (changes) {
              token.unsubscribedAt = unsubscribedAt;
              token.unsubscribeUsedAt = tokenUsedAt;
            }
            return { meta: { changes } };
          }
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

  it('accepts a verification token once, then rejects reuse', async () => {
    const db = database({ token: { verificationTokenHash: await hash('verify-token') } });
    const request = new Request('https://pursafe.example/api/beta-waitlist/verify?token=verify-token');
    const response = await verify({ request, env: env(db) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=verified');
    expect(response.headers.get('location')).not.toContain('token');
    const reused = await verify({ request, env: env(db) });
    expect(reused.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
  });

  it('rejects expired verification tokens', async () => {
    const db = database({
      token: {
        verificationTokenHash: await hash('expired-token'),
        verificationExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    const response = await verify({ request: new Request('https://pursafe.example/api/beta-waitlist/verify?token=expired-token'), env: env(db) });
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
  });

  it('accepts an unsubscribe token once, then rejects reuse and expiry', async () => {
    const db = database({ token: { unsubscribeTokenHash: await hash('unsubscribe-token') } });
    const request = new Request('https://pursafe.example/api/beta-waitlist/unsubscribe?token=unsubscribe-token');
    const response = await unsubscribe({ request, env: env(db) });
    expect(response.headers.get('location')).toBe('https://pursafe.example/?beta=unsubscribed');
    const reused = await unsubscribe({ request, env: env(db) });
    expect(reused.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');

    const expiredDb = database({
      token: {
        unsubscribeTokenHash: await hash('expired-unsubscribe-token'),
        unsubscribeExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    const expired = await unsubscribe({ request: new Request('https://pursafe.example/api/beta-waitlist/unsubscribe?token=expired-unsubscribe-token'), env: env(expiredDb) });
    expect(expired.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
  });

  it('keeps verification and unsubscribe token scopes separate', async () => {
    const db = database({
      token: {
        verificationTokenHash: await hash('verify-token'),
        unsubscribeTokenHash: await hash('unsubscribe-token'),
      },
    });
    const verificationWithUnsubscribeToken = await verify({ request: new Request('https://pursafe.example/api/beta-waitlist/verify?token=unsubscribe-token'), env: env(db) });
    const unsubscribeWithVerificationToken = await unsubscribe({ request: new Request('https://pursafe.example/api/beta-waitlist/unsubscribe?token=verify-token'), env: env(db) });
    expect(verificationWithUnsubscribeToken.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
    expect(unsubscribeWithVerificationToken.headers.get('location')).toBe('https://pursafe.example/?beta=invalid');
  });
});
