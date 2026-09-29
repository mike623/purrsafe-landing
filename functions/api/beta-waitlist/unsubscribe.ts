import { hash, redirect, type WaitlistEnv } from '../beta-waitlist/_shared.js';
export const onRequestGet = async ({ request, env }: { request: Request; env: WaitlistEnv }) => {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token');
  if (!rawToken) return redirect(env, 'invalid');
  const now = new Date().toISOString();
  const result = await env.DB.prepare('UPDATE beta_registrations SET unsubscribed_at = ?, unsubscribe_used_at = ? WHERE unsubscribe_token_hash = ? AND unsubscribe_token_expires_at > ? AND unsubscribe_used_at IS NULL').bind(now, now, await hash(rawToken), now).run();
  return redirect(env, result.meta?.changes ? 'unsubscribed' : 'invalid');
};