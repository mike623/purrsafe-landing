import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { nonCanonicalHosts, SITE_URL } from '../site.config.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('canonical origin', () => {
  it('is a bare https origin with no trailing slash', () => {
    expect(SITE_URL).toBe(new URL(SITE_URL).origin);
    expect(new URL(SITE_URL).protocol).toBe('https:');
  });

  // wrangler.toml and README.md cannot import site.config.mjs, so they are the
  // two places a stale hostname can survive. Assert on them instead.
  it('matches wrangler.toml PUBLIC_SITE_URL', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).toMatch(new RegExp(`^PUBLIC_SITE_URL = "${SITE_URL}"$`, 'm'));
    expect(nonCanonicalHosts(wrangler)).toEqual([]);
  });

  it('matches the BETA_APP_URL value documented in README.md', () => {
    const readme = read('README.md');
    expect(readme).toContain(`\`${SITE_URL}\``);
    expect(nonCanonicalHosts(readme)).toEqual([]);
  });

  it('is the only origin astro.config.mjs can produce', () => {
    const config = read('astro.config.mjs');
    expect(config).toContain('site: SITE_URL');
    expect(nonCanonicalHosts(config)).toEqual([]);
  });
});
