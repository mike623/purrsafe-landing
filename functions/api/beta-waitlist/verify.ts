interface Env { DB: D1Database; PUBLIC_SITE_URL: string }
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();
  const rawToken = url.searchParams.get('token');
  if (!email || !rawToken) return new Response('Invalid verification link.', { status: 400 });
  const result = await env.DB.prepare('UPDATE beta_registrations SET verified_at = ?, token_used_at = ? WHERE email = ? AND verification_token_hash = ? AND token_expires_at > ? AND token_used_at IS NULL').bind(new Date().toISOString(), new Date().toISOString(), email, await hash(rawToken), new Date().toISOString()).run();
  return new Response(result.meta.changes ? 'Email verified. Your PurrSafe beta registration is confirmed.' : 'This verification link is invalid or expired.', { status: result.meta.changes ? 200 : 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
};