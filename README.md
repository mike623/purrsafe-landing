# PurrSafe landing page

Astro + TypeScript static site for the PurrSafe private beta. Cloudflare Pages serves the build at `https://pursafe.selenasolutions.com` after ReleaseOps configures the project and DNS.

## Local development

Requires Node 22 LTS.

```sh
npm ci
npm run dev
```

Production checks:

```sh
npm run test
npm run check
npm run build
npm run preview
```

## Cloudflare Pages and beta registration

`wrangler.toml` defines the Pages output and a D1 binding named `DB`. D1 is the approved storage choice for the small private-beta registration queue: it keeps the endpoint server-side, avoids client credentials, and fits the static Pages deployment without adding a separate service.

ReleaseOps must replace the placeholder `database_id` with the provisioned D1 database ID, apply `db/schema.sql`, configure the Pages custom domain, and set any runtime secrets through Wrangler. No secret values belong in this repository or client bundle.

Required ReleaseOps actions:

- Provision D1 database `purrsafe-beta` and apply `db/schema.sql`.
- Set `database_id` in `wrangler.toml` to the real D1 ID.
- Configure `pursafe.selenasolutions.com` on the Cloudflare Pages project.
- Set `ALLOWED_ORIGIN` to the final canonical origin if it changes.
- Do not add client credentials. If stronger bot protection is approved later, add Turnstile end-to-end and store only its secret with `wrangler pages secret put`; do not document or commit the value.
- Run the post-deploy smoke checks against `POST /api/beta-register`.

The function at `functions/api/beta-register.ts` accepts JSON `POST` requests, trims and lowercases email addresses, rejects malformed input and honeypot submissions, rate-limits by client IP, stores unique emails, and returns explicit JSON success/error responses. D1 failures return a generic error without leaking implementation details.

## Accessibility baseline

- Semantic landmarks, headings, lists, details/summary FAQ, and descriptive page metadata.
- Visible keyboard focus styles and touch-friendly CTA targets.
- Color palette uses dark teal text on light backgrounds and a reduced-motion media query.
- No autoplay media or motion-dependent interaction.

Run a production build before Lighthouse testing. Baseline target: Lighthouse Accessibility 95+, with any remaining findings reviewed before public launch.

## Content guardrails

PurrSafe does not provide medical advice or diagnosis. The page avoids fabricated testimonials, unsupported metrics, and private credentials. Contact links remain placeholders until the beta operations address is finalized.
