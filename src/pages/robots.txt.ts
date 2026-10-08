import type { APIRoute } from 'astro';

// Generated rather than shipped from public/ so the sitemap URL always follows
// the canonical origin (SITE_URL in site.config.mjs) instead of a stale literal.
export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('astro.config.mjs must set `site` for robots.txt to resolve the sitemap URL.');

  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site).href}`, ''].join('\n');

  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
