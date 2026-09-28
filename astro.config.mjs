import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mike623.github.io',
  base: '/purrsafe-landing',
  integrations: [sitemap()],
  output: 'static',
});
