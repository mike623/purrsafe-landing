import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestOptions, onRequestPost } from '../functions/api/beta-waitlist/event.js';

const env = (overrides: Record<string, unknown> = {}) => ({
  PUBLIC_SITE_URL: 'https://pursafe.example',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  ALLOWED_ORIGINS: 'https://pursafe.example',
  ...overrides,
}) as never;

const request = (body: unknown, origin: string | null = 'https://pursafe.example') =>
  new Request('https://pursafe.example/api/beta-waitlist/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) },
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

  it('honours the platform rate limiter before calling upstream', async () => {
    const fetchSpy = upstreamOk();
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await onRequestPost({ request: request({ event_name: 'beta_page_view' }), env: env({ RATE_LIMITER: { limit } }) });

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'beta-events:global' });
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
    const preflight = onRequestOptions({ request: request({}, 'https://pursafe.example'), env: env() });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://pursafe.example');
  });
});
