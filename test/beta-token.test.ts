import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { betaTokenFrom } from '../src/lib/beta-token.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const TOKEN = 'fixture-confirmation-token-bbbbbbbb';

/**
 * The two funnel handler pages and the token key each reads. The Supabase email
 * emits the fragment form; the query form must still work so a stray link does
 * not silently report an invalid token.
 */
const PAGES = [
  { path: 'src/pages/beta.astro', key: 'confirm', helperPath: '../lib/beta-token.ts' },
  { path: 'src/pages/beta/unsubscribe.astro', key: 'token', helperPath: '../../lib/beta-token.ts' },
] as const;

describe.each(PAGES)('$path', ({ path, key, helperPath }) => {
  const source = read(path);

  it(`recovers ${key} from the fragment — the form the email emits`, () => {
    expect(betaTokenFrom({ hash: `#${key}=${TOKEN}`, search: '' }, key)).toBe(TOKEN);
  });

  it(`recovers ${key} from the query string as a fallback`, () => {
    expect(betaTokenFrom({ hash: '', search: `?${key}=${TOKEN}` }, key)).toBe(TOKEN);
  });

  it('prefers the fragment when a token arrives in both', () => {
    expect(betaTokenFrom({ hash: `#${key}=fragment`, search: `?${key}=query` }, key)).toBe(
      'fragment',
    );
  });

  it('falls back to the query string when the fragment carries an empty value', () => {
    expect(betaTokenFrom({ hash: `#${key}=`, search: `?${key}=${TOKEN}` }, key)).toBe(TOKEN);
  });

  it('returns null when neither form carries the token', () => {
    expect(betaTokenFrom({ hash: '', search: '' }, key)).toBeNull();
    expect(betaTokenFrom({ hash: '#section-one', search: '?utm_source=email' }, key)).toBeNull();
    expect(betaTokenFrom({ hash: `#${key}=`, search: `?${key}=` }, key)).toBeNull();
  });

  it('does not answer to the other page\'s key', () => {
    const otherKey = key === 'confirm' ? 'token' : 'confirm';
    expect(betaTokenFrom({ hash: `#${otherKey}=${TOKEN}`, search: '' }, key)).toBeNull();
    expect(betaTokenFrom({ hash: '', search: `?${otherKey}=${TOKEN}` }, key)).toBeNull();
  });

  // The behaviour above only reaches a visitor if the page actually delegates to
  // the helper. A page that goes back to reading `location.hash` alone is the
  // regression this guards: it passes every unit assertion above and still
  // fails every query-form click.
  it('reads its token through the shared helper, not location directly', () => {
    expect(source).toContain(`import { betaTokenFrom } from '${helperPath}';`);
    expect(source).toContain(`betaTokenFrom(location, '${key}')`);
    expect(source).not.toMatch(/new URLSearchParams\(location\./);
  });

  it('still strips the token from the address bar', () => {
    expect(source).toContain("history.replaceState(null, '', location.pathname)");
  });
});
