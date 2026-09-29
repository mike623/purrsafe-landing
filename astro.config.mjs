import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pursafe.selenasolutions.com',
  base: '/',
  integrations: [sitemap()],
  output: 'static',
});
