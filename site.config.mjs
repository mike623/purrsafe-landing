/**
 * Single source of truth for the canonical public origin.
 *
 * Everything that needs the landing origin derives it from here:
 * - `astro.config.mjs` feeds it to `site`, which drives `<link rel="canonical">`,
 *   Open Graph URLs, `src/pages/robots.txt.ts`, and the generated sitemaps.
 * - `wrangler.toml` `[vars].PUBLIC_SITE_URL` and the Supabase `BETA_APP_URL`
 *   value documented in `README.md` are asserted against it by
 *   `test/site-url.test.mjs`, so a drifting literal fails `npm test`.
 * - `scripts/verify-dist.mjs` asserts the built output contains no other host.
 *
 * Changing the canonical origin means editing this file only; the checks above
 * will point at anything left behind.
 */
export const SITE_URL = 'https://purrsafe.selenasolutions.com';

/** Hostname form of {@link SITE_URL}, e.g. for Turnstile `hostname` claims. */
export const SITE_HOSTNAME = new URL(SITE_URL).hostname;

const ZONE = SITE_HOSTNAME.split('.').slice(-2).join('.');

/**
 * Hosts in the project's DNS zone that are not {@link SITE_HOSTNAME} — the
 * `pursafe.` / `purrsafe.` class of typo. Requires a subdomain label so that
 * prose naming the bare zone (README, this comment) is not a finding; a wrong
 * host is always a subdomain.
 */
const ZONE_SUBDOMAIN = new RegExp(String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.${ZONE.replace('.', String.raw`\.`)}\b`, 'gi');

export function nonCanonicalHosts(text) {
  return (text.match(ZONE_SUBDOMAIN) ?? []).filter((host) => host.toLowerCase() !== SITE_HOSTNAME);
}
