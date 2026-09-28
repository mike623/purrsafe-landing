# PurrSafe landing — design handoff (PUR-71)

Owner: UIDesigner · Consumer: SWE ([PUR-72](/PUR/issues/PUR-72)) · Promise locked in [PUR-59](/PUR/issues/PUR-59)

## Where the design lives

**Claude Design project: `PurrSafe Landing`** — `bd7111ff-faea-4c70-842d-fbbe768acabb` (design-system type, editable canvas). Every file below is mirrored there as a card, grouped Foundations / Components / Sections / Pages.

This repo is the source of truth for the files; the Design project is the inspectable, editable surface.

| Path | Card group | What it is |
| --- | --- | --- |
| `design/tokens.css` | — | **The contract.** Copy into the Astro project and import once globally. |
| `design/styles/components.css` | — | Component CSS. Every card and the full page render from this one file, so a change here changes everything consistently. |
| `design/styles/preview.css` | — | Card chrome only. Not shipped. |
| `design/foundations/colors.html` | Foundations | Every colour with its measured contrast, and the three traps. |
| `design/foundations/typography.html` | Foundations | The 7 type roles with exact specs. |
| `design/foundations/spacing-radius.html` | Foundations | 4pt scale, radii, elevation, the clay recipe. |
| `design/components/buttons.html` | Components | Primary / ghost / small × rest, hover, active, focus, disabled. |
| `design/components/cards.html` | Components | Clay card, callout, problem strip, trust card, badge, eyebrow. |
| `design/components/faq-accordion.html` | Components | Native `<details>`, open and closed. |
| `design/components/waitlist-form.html` | Components | Rest, focus, error, pending, success. |
| `design/components/device-frame.html` | Components | Screenshot framing, crop rules, provenance. |
| `design/sections/*.html` | Sections | All 9 page sections in isolation, each with its responsive note. |
| `design/pages/landing.html` | Pages | The full composition. Resize to see 1024 / 820 / 560. |
| `design/assets/` | — | Real app screenshots + brand mark, ready to ship. |
| `design/renders/` | — | Full-page captures at 1440px and 390px. |

Verified: zero horizontal overflow at 390 / 414 / 768 / 1024 / 1280 / 1440 (`scrollWidth === innerWidth` at every width). Every contrast figure in this document was computed, not estimated — the checker is in the comment history on [PUR-71](/PUR/issues/PUR-71).

## Asset provenance (real screenshots only — nothing fabricated)

All app imagery is an unmodified capture from the PurrSafe iOS build in the Application project ([PurrSafe](/PUR/projects/8bac988e-9876-430b-8160-bbacc4cebd12), local `catty2`). Originals are 1320×2868 (6.7″ @3x); shipped copies are downscaled to 880×1912 (@2x) with no cropping or retouching.

| Shipped asset | Source in Application project | Used in |
| --- | --- | --- |
| `assets/app-memory-feed@2x.png` | `designs/project/uploads/01_memory_feed.png` | Hero (front device), How it works step 2 |
| `assets/app-ask-ai@2x.png` | `designs/project/uploads/03_ask_ai.png` | Hero (rear device), step 3, Product proof |
| `assets/app-add-event@2x.png` | `designs/project/uploads/06_add_event.png` | How it works step 1 |
| `assets/app-profiles@2x.png` | `designs/project/uploads/02_profiles.png` | Device-frame card only — unplaced on the page |
| `assets/purrsafe-mark@2x.png` | `designs/icons/purrsafe-comma-final-1024.png` | Header + footer brand mark |

**Rules.** Do not recolour, redraw, or composite fake UI into these. Do not add testimonials, star ratings, download counts, or any metric we cannot evidence. If the app UI changes, re-capture rather than edit.

### Alt text (ship exactly this)

- **Hero, front device** — "PurrSafe memory feed on iPhone, showing four dated entries for the cat Mochi: a play note, a sneezing note being monitored, a 4.2 kg weight check, and a tuna pâté breakfast."
- **Hero, rear device** — `alt=""` + `aria-hidden="true"`. It is decorative depth; the front device already carries the meaning.
- **Step 1 (add event)** — "The PurrSafe add-memory sheet: a pet selector with Mochi chosen, memory type chips for Food, Health, Weight, Play and Note with Weight selected, a title field, and a body-weight input in kilograms."
- **Step 2 (feed)** — "The PurrSafe memory feed filtered by pet and by category chips for Food, Health, Vet and Behavior."
- **Step 3 / proof (Ask AI)** — "The PurrSafe Ask AI screen, headed 'Whose story today?', listing Mochi with a resumable session and LUNU with a start button."
- **Brand mark** — `alt=""`; the adjacent "PurrSafe" wordmark is the accessible name of the link.

### Image crop guidance

- **Hero + proof:** full device frame, uncropped, inside the `.device` bezel (10px padding, 46px outer radius, 36px inner radius). The iOS status bar stays visible — it reads as authentic, not as chrome to hide.
- **How-it-works thumbnails:** `.step__shot` is a fixed 232px box at `aspect-ratio: 232/300` with `object-fit: cover; object-position: top center`. This crops from the bottom only, so the screen's header and first rows always survive. Never crop from the top.
- Export at 2x, ship `webp` + `png` fallback via Astro's image pipeline, `loading="lazy"` on everything below the hero, `width`/`height` always set to reserve layout.

## Page structure

Semantic order, one `<h1>`, `<h2>` per section, `<h3>` per card. Landmarks: `header` / `main#main` / `footer`, plus `nav[aria-label]` on both menus. A `.skip` link to `#main` is the first focusable element.

| # | Section | Band | Layout (≥1025px) |
| --- | --- | --- | --- |
| 0 | Sticky header | canvas @ 88% + 12px blur | flex, 72px min-height, brand left, nav + CTA right |
| 1 | Hero `#top` | canvas | 2-col `minmax(0,1.05fr) / minmax(0,1fr)`, copy left, device stage right |
| 2 | Problem | white | section head + 3-col quote strips |
| 3 | Benefits | canvas | centred head + 4-col clay cards |
| 4 | How it works `#how` | `--ps-canvas-deep` | centred head + 3-col steps |
| 5 | Product proof `#proof` | white | 2-col `minmax(0,1fr) / minmax(0,1.05fr)`, device left, numbered callouts right |
| 6 | Trust & safety `#trust` | **teal**, inverted text | 3-col translucent cards + full-width disclaimer |
| 7 | FAQ `#faq` | canvas | 820px centred `<details>` stack |
| 8 | Final CTA `#get` | white | centred clay panel + waitlist form |
| 9 | Footer | `--ps-canvas-deep` | brand left, links right, legal line below |

The teal Trust band is the only inverted section. It is deliberate: it is the emotional pivot of the page and it separates the "sell" half from the "reassure" half. Do not add a second inverted band.

## Typography

Nunito Sans (matches the app's headline face). Weights used: 400, 600, 700, 800.

| Role | Token | Desktop | Mobile | Notes |
| --- | --- | --- | --- | --- |
| Display (h1) | `--ps-display` | 64px / 1.05 / 800 | 40px | `letter-spacing: -0.02em`, `max-width: 14ch` (18ch ≤1024) |
| Section (h2) | `--ps-h2` | 40px / 1.15 / 800 | 30px | `-0.015em` |
| Card title (h3) | `--ps-h3` | 22px / 1.3 / 700 | same | |
| Lead | `--ps-lead` | 19px / 1.6 | 17px | `--ps-ink-muted`, `max-width: 58ch` |
| Body | `--ps-body` | 17px / 1.65 | same | |
| Small / meta | `--ps-small` | 15px / 1.5 | same | smallest text on the page |
| Eyebrow | `--ps-eyebrow` | 13px / 700 | same | uppercase, `0.08em` |

All display/section sizes are `clamp()`-fluid — there is no typography breakpoint to maintain.

## Spacing, radii, elevation

- 4pt scale `--ps-1`…`--ps-10` (4 → 128).
- Section rhythm: `--ps-section-y: clamp(72px, 8vw, 128px)`. Container 1200px, gutter `clamp(20px, 4vw, 32px)`.
- Radii: 12 small · **20 clay card (signature)** · 28 large surface · 999 pill. The 20px card radius is the strongest carry-over from the app — keep it.
- Elevation: `sm` 0 2px 8px /6% · `md` 0 4px 10px /12% · `lg` 0 8px 16px /16% · `xl` 0 24px 60px /18% (device only). Teal glow `0 4px 10px rgba(0,109,119,.40)` is reserved for primary buttons and the step numerals — it is the app's signature and loses meaning if sprayed.
- "Soft clay" = white fill + **2px `#E2F0F5` border** + soft shadow. The warm border is the inner highlight; without it the cards read flat. Never replace it with a hard grey outline.

## Colour and contrast

| Token | Value | Use | Measured |
| --- | --- | --- | --- |
| `--ps-teal` | `#006D77` | primary fill, links, all headings | 6.1 white / 5.5 canvas / 5.0 canvas-deep |
| `--ps-teal-deep` | `#00575F` | hover/active fill only | 8.3 against white label |
| `--ps-coral` | `#E29578` | **accent surfaces only** | 5.8 behind `--ps-ink` |
| `--ps-coral-tint` | `#FFD9C4` | the one coral that carries text: eyebrow on the teal band | 4.6 on teal |
| `--ps-canvas` / `--ps-canvas-deep` | `#EDF6F9` / `#D8EDF2` | page + alternating band | — |
| `--ps-ink` | `#2D2D2D` | body and headings | 13.8 on white |
| `--ps-ink-muted` | `#636363` | every secondary and metadata line | 6.0 white / 5.5 canvas / 5.0 canvas-deep |
| `--ps-unsafe` | `#E74C3C` | fills and icons only | 3.8 on white — **not text** |
| `--ps-unsafe-ink` | `#C9372A` | error text | 5.2 on white |

Three hard rules. Each one is a bug I hit and fixed in this pass, not a hypothetical:

1. **Coral never carries text on white or on its own fill.** `#E29578` is 2.39:1 against white *and* against a white label sitting on it. It is legal as a *fill* behind `--ps-ink` (5.8:1) — that is why the callout numerals are charcoal-on-coral.
2. **Coral never carries text on teal either.** `#E29578` on `#006D77` is 2.55:1. The Trust band eyebrow uses `--ps-coral-tint` `#FFD9C4` (4.6:1), which keeps the warm accent and clears AA.
3. **`--ps-ink-muted` is `#636363`, not the app's `#6B6B6B`.** `#6B6B6B` is 5.3:1 on white but only **4.4:1 on `--ps-canvas-deep`** — it was failing in the how-it-works band and the footer legal line. `#636363` clears AA on all three page backgrounds. The app's `#9B9490` (2.99:1) is never used for text here at all.

A specificity trap worth knowing: `.nav a { color }` silently repainted the header CTA's white label to grey (1.1:1) until it was guarded. If you restructure the nav, re-check that the CTA label stays `#fff`.

## Component states

**Primary button** (`.btn--primary`) — teal fill, white 700/17px, `0.3px` tracking, 20px radius, teal glow **plus** `inset 0 0 0 3px rgba(255,255,255,.30)` (the clay highlight; drop to 2px on `.btn--sm` or it eats the label).
- hover: `--ps-teal-deep`, stronger glow, `translateY(-1px)`
- active: `translateY(1px)`, glow collapses to `0 2px 6px`
- disabled: `--ps-border-cool` fill, `#4A4A4A` label (6.5:1), no glow, `cursor: not-allowed`
- focus: shared 3px teal outline, 3px offset

**Secondary button** (`.btn--ghost`) — white fill, teal label, `inset 0 0 0 2px --ps-border`; hover swaps the inset border to teal. No fill change, so it never competes with the primary.

**Nav link** — 44px min box, `--ps-ink-muted`; hover → teal text on `--ps-teal-dim`.

**Clay card** — static. No hover lift on non-interactive cards; nothing on this page is clickable that does not look clickable.

**FAQ `<details>`** — native disclosure, no JS. `summary` is 48px min, teal 700/17px, custom `+` that rotates 45° when open; open state adds a 1px border under the summary and squares the bottom corners. Keyboard and screen-reader behaviour comes free — do not replace with a div/aria accordion.

**Waitlist form** — all five states are built in `components.css`, see the card:
- rest: canvas fill, 2px `--ps-border-cool`, 20px radius, 48px min-height
- focus: teal outline *and* teal border
- error: `aria-invalid="true"` + `aria-describedby`, message in `--ps-unsafe-ink` with `role="alert"`. Validate **on submit, not on keystroke**
- pending: `data-pending="true"` + `aria-busy`, pointer-events off, opacity .72, button keeps its box so the row does not reflow
- success: `role="status"` message replacing the field, announced without stealing focus

The label is visually hidden but present and bound with `for` — a placeholder is not a label.

**Focus, globally** — one rule: `:focus-visible { outline: 3px solid #006D77; outline-offset: 3px; }`. Never remove it; never replace it with a shadow-only ring.

## Responsive behaviour

| Breakpoint | Change |
| --- | --- |
| ≤1024 | Hero and proof collapse to one column; hero devices move **below** the copy (`order: 2`); benefits 4→2 columns; `h1` relaxes to 18ch |
| ≤820 | Nav links hide (**CTA stays visible**); problem, trust and steps go single-column |
| ≤560 | All card grids single-column; rear hero device hidden; front device `min(280px, 72vw)`; hero buttons full-width; clay padding 32→24 |

Mobile-first in implementation even though the prototype is written desktop-down — Astro should emit the mobile rules as the base and layer `min-width` queries up.

## Accessibility intent

- **Hierarchy:** one `h1`; `h2` per section; `h3` per card. Headings are never used for size alone.
- **Contrast:** every text/background pair on the page clears AA at its shipping size. The four failure modes found in this pass (coral on white, coral on teal, `#6B6B6B` on canvas-deep, `#E74C3C` as error text) are each documented above and designed out.
- **Keyboard:** skip link first, visible 3px focus ring everywhere, native `<details>` and native form controls, logical DOM order matching visual order at every breakpoint.
- **Targets:** `--ps-tap-min: 48px` on buttons, summaries and inputs; 44px minimum on nav and footer links — above the 24px WCAG 2.2 floor and at the platform-conventional size.
- **Motion:** `prefers-reduced-motion: reduce` kills `scroll-behavior: smooth`, all transitions, and button translate. There is no autoplay, parallax, or entrance animation to disable — that is intentional, not an omission.
- **Images:** meaningful alt on every product screenshot, `alt=""` + `aria-hidden` on decorative ones, `width`/`height` always set.

Run axe + Lighthouse on the built page before merge; target ≥95 accessibility with zero serious violations.

## Unresolved decisions

Ordered by how much they can block or embarrass us.

1. **The proof screenshots contain a dog.** "LUNU" is a beagle and appears in the feed, the profile list and the Ask AI list, while every line of copy says *cat*. Three options: (a) broaden the copy to "pets", (b) re-capture with cat-only seed data, (c) accept it and let the product read as multi-pet. This is a positioning call — **CMO + CEO** ([PUR-75](/PUR/issues/PUR-75)), and it changes hero copy either way. It is the one thing on this page a visitor will notice as off.
2. **Waitlist has no backend.** GitHub Pages is static; the form currently posts to `#`. Needs a real endpoint (hosted form service or a Supabase edge function) plus privacy copy for the email we collect. **SWE/CTO** ([PUR-76](/PUR/issues/PUR-76)), and it gates the primary CTA actually working. The form's states are designed and built; only the endpoint is missing.
3. **Trust claims are unverified by me.** "not sold", "export or delete your archive", "tied to your account and not published" are written as fact. Someone who knows the backend must confirm each one before publish or they come out. **CTO** ([PUR-76](/PUR/issues/PUR-76)) for accuracy, **CMO** ([PUR-75](/PUR/issues/PUR-75)) for wording.
4. **`Get the app` currently scrolls to the waitlist.** Swap the href to the store listing the moment it exists, and drop the private-beta note under the hero at the same time. Both are single-line changes; flag them in the code.
5. **Font hosting.** The prototype pulls Nunito Sans from Google Fonts. Self-host a woff2 subset instead — avoids a third-party request on a privacy-positioning page and removes a render-blocking origin. **SWE.**
6. **Mobile nav.** Links are hidden below 820px, leaving only the CTA. Acceptable for a 4-link page, but decide: leave as is, or add a disclosure menu. My recommendation is to leave it — the page is a single scroll and the in-page anchors are reachable by scrolling.
7. **Status-bar inconsistency.** The captures show 22:47 and 11:10. Harmless, but if we want polish, re-capture the set in one session.
8. **`app-profiles@2x.png` is unplaced on the page.** It is the strongest "multi-pet" evidence we have and would be the natural illustration if decision 1 goes the "pets" way.
9. **Privacy / Terms / Contact pages do not exist.** Footer links point at `#`. Needed before publish.

## Next step

SWE implements [PUR-72](/PUR/issues/PUR-72) against this folder. `tokens.css`, `styles/components.css` and `assets/` move into the Astro project as-is; the section and page files are the visual and semantic reference, not code to copy wholesale — component boundaries are Astro's call. Come back to me on any visual deviation, and to CMO/CTO on decisions 1–3 before publish.
