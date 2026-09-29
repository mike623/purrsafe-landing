# PurrSafe landing page

Astro + TypeScript static site for the PurrSafe private beta.

## Local development

Requires Node 22 LTS.

```sh
npm ci
npm run dev
```

Build and preview the static output:

```sh
npm run check
npm run build
npm run preview
```

## Deployment

Pull requests and pushes to `main` run `npm run check` and `npm run build`. A manual, protected GitHub Actions dispatch deploys `dist` to Cloudflare Pages with `wrangler`. Configure the `cloudflare-pages` environment with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the `CLOUDFLARE_PAGES_PROJECT` variable before enabling deployment.

The Pages Functions beta flow requires a D1 binding named `DB` and these environment values: `TURNSTILE_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `PUBLIC_SITE_URL`, and `ALLOWED_ORIGINS`. Public build value: `PUBLIC_TURNSTILE_SITE_KEY`. Apply `migrations/0001_beta_registrations.sql` to the D1 database before traffic.

## Accessibility baseline

- Semantic landmarks, headings, lists, details/summary FAQ, and descriptive page metadata.
- Visible keyboard focus styles and touch-friendly CTA targets.
- Color palette uses dark teal text on light backgrounds and a reduced-motion media query.
- No autoplay media or motion-dependent interaction.

Run a production build before Lighthouse testing. Baseline target: Lighthouse Accessibility 95+, with any remaining findings reviewed before public launch. A live Lighthouse score is intentionally not claimed until GitHub Pages has a deployed URL.

## Content guardrails

PurrSafe does not provide medical advice or diagnosis. The page avoids fabricated testimonials, unsupported metrics, and private credentials. Contact links remain placeholders until the beta operations address is finalized.
