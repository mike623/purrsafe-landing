import { isUsableToken, json, logFailure, logMisconfiguration, missingEnv, type WaitlistEnv } from '../beta-waitlist/_shared.js';
const ROUTE = 'beta-waitlist/unsubscribe';
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const;
export const onRequestGet = ({ request: _request }: { request: Request; env: WaitlistEnv }) => new Response('POST required', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export const onRequestPost = async ({ request, env }: { request: Request; env: WaitlistEnv }) => {
  const missing = missingEnv(env, REQUIRED_VARS);
  if (missing.length) {
    logMisconfiguration(ROUTE, missing);
    return json({ message: 'Unsubscribe is temporarily unavailable.' }, 503);
  }
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  if (!isUsableToken(body.token)) return json({ message: 'Unsubscribe link is invalid, expired, or already used.' }, 400);
  let response: Response | null = null;
  try {
    response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', token: body.token }) });
  } catch (error) {
    logFailure(ROUTE, 'upstream unsubscribe', error);
  }
  // An unreachable system of record is never reported as a completed unsubscribe.
  if (!response) return json({ message: 'Unsubscribe is temporarily unavailable.' }, 502);
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return json({ message: result.error ?? 'Unsubscribe link is invalid, expired, or already used.' }, response.status >= 500 ? 502 : 400);
  return json({ message: 'You are unsubscribed.' });
};