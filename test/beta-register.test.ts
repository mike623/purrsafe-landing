import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  onRequestPost,
  type D1Database,
  type D1Statement,
} from '../functions/api/beta-register';

function database({ count = 0, fail = false } = {}): D1Database {
  let storedCount = count;
  return {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      return {
        bind(...nextValues: unknown[]) {
          values = nextValues;
          return this;
        },
        async first() {
          if (query.includes('rate_limits') && storedCount > 0) {
            return { request_count: storedCount, window_started_at: Math.floor(Date.now() / 1000) };
          }
          return null;
        },
        async run() {
          if (fail) throw new Error('database offline');
          if (query.includes('rate_limits')) storedCount = Number(values[1]);
          return { success: true };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://pursafe.selenasolutions.com/api/beta-register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('beta registration', () => {
  it('normalizes valid email addresses', () => {
    expect(normalizeEmail('  CAT@Example.COM ')).toBe('cat@example.com');
  });

  it('rejects malformed email addresses', async () => {
    const response = await onRequestPost({ request: request({ email: 'not-an-email' }), env: { DB: database() } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'invalid_email' });
  });

  it('rejects malformed JSON', async () => {
    const response = await onRequestPost({
      request: new Request('https://pursafe.selenasolutions.com/api/beta-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
      env: { DB: database() },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'invalid_request' });
  });

  it('rejects honeypot submissions', async () => {
    const response = await onRequestPost({ request: request({ email: 'cat@example.com', website: 'spam' }), env: { DB: database() } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'invalid_request' });
  });

  it('returns explicit success without exposing storage details', async () => {
    const response = await onRequestPost({ request: request({ email: '  Cat@Example.COM ' }), env: { DB: database() } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, message: 'You are on the PurrSafe beta waitlist.' });
  });

  it('returns a service error when storage fails', async () => {
    const response = await onRequestPost({ request: request({ email: 'cat@example.com' }), env: { DB: database({ fail: true }) } });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'internal_error' });
  });

  it('rate limits repeated requests from one client', async () => {
    const db = database({ count: 5 });
    const response = await onRequestPost({ request: request({ email: 'cat@example.com' }), env: { DB: db } });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'rate_limited' });
  });
});
