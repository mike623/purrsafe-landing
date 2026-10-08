import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import { SITE_URL } from './site.config.mjs';

export default defineConfig({
  site: SITE_URL,
  base: '/',
  integrations: [sitemap()],
  output: 'static',
});
