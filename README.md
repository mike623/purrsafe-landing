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

The Pages Functions beta flow requires D1 `DB`, Cloudflare Rate Limiting binding `RATE_LIMITER`, and these environment values: `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAME`, `TURNSTILE_ACTION`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUBLIC_SITE_URL`, and `ALLOWED_ORIGINS`. Public build value: `PUBLIC_TURNSTILE_SITE_KEY`. Turnstile `hostname` and `action` claims must match the configured values; Turnstile success is not a quota. `RATE_LIMITER` uses one global key, while D1 applies a bounded global application quota plus a per-client quota and prunes expired rows before each request.

Pages preview and production use separate environment configuration. Configure D1, the Rate Limiting binding, Supabase URL/key, and vars in both Pages environments; preview must use a non-production D1 database and preview origin, while production uses the production D1 database and canonical origin. Keep all secret values in Pages/Wrangler, never in git. Supabase `beta-waitlist` remains the sole registration, lifecycle email, and token system of record; Pages only validates the edge request and proxies the existing function contract.

Set Supabase `BETA_APP_URL` to the matching landing origin (`https://purrsafe.app` in production, preview origin in preview). The Supabase email uses URL fragments (`/beta#confirm=...` and `/beta/unsubscribe#token=...`); browser JavaScript immediately POSTs the fragment credential to Pages, then removes the fragment. Credentials never enter a GET query string, HTTP referrer, or Pages access-log URL.

Create/configure the D1 binding as `DB`, then apply the migration from the repository root with the exact command `npx wrangler d1 migrations apply purrsafe-beta --remote`. Run it once per target database before traffic. Do not use production credentials for preview. D1 must contain limiter rows only; it must not contain registrations or token material.

## Accessibility baseline

- Semantic landmarks, headings, lists, details/summary FAQ, and descriptive page metadata.
- Visible keyboard focus styles and touch-friendly CTA targets.
- Color palette uses dark teal text on light backgrounds and a reduced-motion media query.
- No autoplay media or motion-dependent interaction.

Run a production build before Lighthouse testing. Baseline target: Lighthouse Accessibility 95+, with any remaining findings reviewed before public launch. A live Lighthouse score is intentionally not claimed until GitHub Pages has a deployed URL.

## Content guardrails

PurrSafe does not provide medical advice or diagnosis. The page avoids fabricated testimonials, unsupported metrics, and private credentials. Contact links remain placeholders until the beta operations address is finalized.
