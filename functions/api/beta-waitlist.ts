interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  PUBLIC_SITE_URL: string;
  ALLOWED_ORIGINS?: string;
}

type Context = { request: Request; env: Env };

const json = (body: Record<string, unknown>, status = 200, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': origin ?? 'null',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    },
  });

const originFor = (request: Request, env: Env) => {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? env.PUBLIC_SITE_URL).split(',').map((value) => value.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
};

const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const token = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;

export const onRequestOptions = ({ request, env }: Context) =>
  new Response(null, { status: 204, headers: { 'access-control-allow-origin': originFor(request, env) ?? 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });

export const onRequestPost = async ({ request, env }: Context) => {
  const origin = originFor(request, env);
  if (!origin) return json({ message: 'Origin not allowed.' }, 403);

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const betaConsent = form.get('beta_consent') === 'yes';
  const researchOptIn = form.get('research_opt_in') === 'yes';
  const turnstileToken = String(form.get('cf-turnstile-response') ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !betaConsent || !turnstileToken) return json({ message: 'Enter a valid email, accept beta consent, and complete verification.' }, 400, origin);

  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: turnstileToken, remoteip: request.headers.get('CF-Connecting-IP') ?? '' }) });
  const verificationResult = await verification.json() as { success?: boolean };
  if (!verificationResult.success) return json({ message: 'Verification failed. Try again.' }, 400, origin);

  const rawToken = token();
  const tokenHash = await hash(rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await env.DB.prepare(`INSERT INTO beta_registrations (email, beta_consent, research_opt_in, verification_token_hash, token_expires_at, created_at)
    VALUES (?, 1, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET beta_consent = 1, research_opt_in = excluded.research_opt_in, verification_token_hash = excluded.verification_token_hash, token_expires_at = excluded.token_expires_at, token_used_at = NULL, unsubscribed_at = NULL`)
    .bind(email, researchOptIn ? 1 : 0, tokenHash, expires.toISOString(), now.toISOString()).run();

  const verifyUrl = `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/api/beta-waitlist/verify?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;
  const unsubscribeUrl = `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/api/beta-waitlist/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(rawToken)}`;
  const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.RESEND_FROM, to: [email], subject: 'Verify your PurrSafe beta registration', html: `<p>Thanks for joining PurrSafe private beta.</p><p><a href="${verifyUrl}">Verify your email</a> within 24 hours.</p><p><a href="${unsubscribeUrl}">Unsubscribe</a></p>` }) });
  if (!sent.ok) return json({ message: 'Registration saved, but verification email could not be sent. Try again later.' }, 502, origin);
  return json({ message: 'Check your email to verify your beta registration.' }, 202, origin);
};