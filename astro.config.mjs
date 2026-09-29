import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://pursafe.selenasolutions.com',
  integrations: [sitemap()],
  output: 'static',
});
