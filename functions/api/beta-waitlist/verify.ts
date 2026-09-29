import { hash, redirect, type WaitlistEnv } from '../beta-waitlist/_shared.js';
export const onRequestGet = async ({ request, env }: { request: Request; env: WaitlistEnv }) => {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get('token');
  if (!rawToken) return redirect(env, 'invalid');
  const now = new Date().toISOString();
  const result = await env.DB.prepare('UPDATE beta_registrations SET verified_at = ?, token_used_at = ? WHERE verification_token_hash = ? AND token_expires_at > ? AND token_used_at IS NULL').bind(now, now, await hash(rawToken), now).run();
  return redirect(env, result.meta?.changes ? 'verified' : 'invalid');
};