import { redirect, type WaitlistEnv } from '../beta-waitlist/_shared.js';
export const onRequestGet = ({ env }: { request: Request; env: WaitlistEnv }) => new Response('POST required', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
export const onRequestPost = async ({ request, env }: { request: Request; env: WaitlistEnv }) => {
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  if (typeof body.token !== 'string') return redirect(env, 'invalid');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/beta-waitlist`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', token: body.token }) });
  return redirect(env, response.ok ? 'unsubscribed' : 'invalid');
};