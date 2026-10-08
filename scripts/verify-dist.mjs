#!/usr/bin/env node
/**
 * Fails the build if the static output references any origin other than the
 * canonical one, or is missing the canonical URLs it is supposed to emit.
 *
 * Guards against the PUR-132 class of bug: a stale hostname literal surviving
 * in dist/ because nothing asserted on the built bytes.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { nonCanonicalHosts, SITE_HOSTNAME, SITE_URL } from '../site.config.mjs';

const DIST = 'dist';

const REQUIRED_FILES = ['index.html', 'sitemap-index.xml', 'sitemap-0.xml', 'robots.txt'];

/** Origins and paths from earlier hosting attempts that must never reappear. */
const FORBIDDEN = [
  { label: 'GitHub Pages origin', pattern: /mike623\.github\.io/gi },
  { label: 'GitHub Pages base path', pattern: /\/purrsafe-landing\b/gi },
  // nonCanonicalHosts() ignores the bare zone so prose can name it; built output
  // has no such excuse, and an apex link here would be just as broken.
  { label: 'bare zone origin', pattern: new RegExp(String.raw`//${SITE_HOSTNAME.split('.').slice(-2).join(String.raw`\.`)}\b`, 'gi') },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Skip binaries: a PNG byte run can trip a text pattern and tells us nothing. */
const isText = (path) => /\.(html|xml|txt|json|js|mjs|css|svg|map|webmanifest)$/i.test(path);

const failures = [];

for (const name of REQUIRED_FILES) {
  try {
    await readFile(join(DIST, name));
  } catch {
    failures.push(`missing expected build output: ${DIST}/${name}`);
  }
}

for await (const path of walk(DIST)) {
  if (!isText(path)) continue;
  const contents = await readFile(path, 'utf8');
  const where = relative(DIST, path);

  for (const host of nonCanonicalHosts(contents)) {
    failures.push(`${where}: non-canonical host "${host}" (expected "${SITE_HOSTNAME}")`);
  }

  for (const { label, pattern } of FORBIDDEN) {
    if (pattern.test(contents)) failures.push(`${where}: ${label} reference found`);
    pattern.lastIndex = 0;
  }
}

/** The canonical URLs must actually be present, not merely un-contradicted. */
const expectations = [
  { file: 'index.html', needle: `<link rel="canonical" href="${SITE_URL}/"` },
  { file: 'sitemap-0.xml', needle: `<loc>${SITE_URL}/</loc>` },
  { file: 'robots.txt', needle: `Sitemap: ${SITE_URL}/sitemap-index.xml` },
];

for (const { file, needle } of expectations) {
  const contents = await readFile(join(DIST, file), 'utf8').catch(() => '');
  if (!contents.includes(needle)) failures.push(`${file}: expected to contain ${JSON.stringify(needle)}`);
}

if (failures.length > 0) {
  console.error(`verify-dist: ${failures.length} problem(s) in ${DIST}/`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`verify-dist: ${DIST}/ is clean; canonical origin ${SITE_URL}`);
