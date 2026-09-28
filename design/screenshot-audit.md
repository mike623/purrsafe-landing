# Landing product-proof screenshot audit

Owner: UIDesigner · Issue: PUR-71 · Date: 2026-09-28

Audit of the four real-app captures staged in `design/assets/` for use in the
landing hero and product-proof sections.

## Provenance

All four are genuine in-app iPhone 6.5" captures, not mockups or composites.

| Landing asset | Source file | Source size | Staged size |
| --- | --- | --- | --- |
| `app-memory-feed@2x.png` | `purrsafe_flutter/fastlane/screenshots/en-US/iPhone65-01_memory_feed.png` | 1320×2868 | 880×1912 |
| `app-profiles@2x.png` | `…/iPhone65-02_profiles.png` | 1320×2868 | 880×1912 |
| `app-ask-ai@2x.png` | `…/iPhone65-03_ask_ai.png` | 1320×2868 | 880×1912 |
| `app-add-event@2x.png` | `…/iPhone65-06_add_event.png` | 1320×2868 | 880×1912 |

Source repo: Application project, local folder `/Users/mikewong/workspace/catty2`.
Staged copies are uniform 2/3 downscales; aspect ratio is preserved. `880×1912`
is `440×956` CSS px at `@2x`, which matches the intended device-mock width.

Provenance is clean. Content is not.

## Blocking content defects

### 1. A dog appears in a "feline family gallery" — `app-profiles@2x.png`

The screen header reads **"Families / Your feline family gallery"**. Directly
below it, one of the two profile cards is **LUNU, a beagle puppy**. The tip card
underneath says "Long-press any cat card to remove it…".

This is unusable for landing product proof. PurrSafe's whole positioning is a
cat memory app, and the single largest photo in the shot is a dog sitting under
copy that says "feline". A visitor reads this as either a broken product or
leftover test data — both destroy the trust the page is being built to create.

The same beagle also appears in `app-memory-feed@2x.png` (the "LUNU" pet chip
and avatar) and in `app-ask-ai@2x.png` (a LUNU session card).

### 2. Pet avatars are landscape photos — `app-add-event@2x.png`

In the "Who is this for?" row, Mochi's and LUNU's avatars are **waterfall /
scenery photographs**, not the pets. The Profiles screen renders the correct pet
photos for the same two animals, so this is an avatar-resolution defect in the
add-event sheet, not bad seed data.

### 3. Category icons are wrong — `app-memory-feed@2x.png`

Three of four feed rows render the **scales / weight** icon:

- "Loves the new feather toy" → scales (should be play/behavior)
- "Sneezing - monitoring" → scales (should be health)
- "Weight check - 4.2 kg" → scales (correct)
- "Breakfast - tuna pate" → fork & knife (correct)

At the size this runs in a landing hero the icon column is legible, and a
repeated wrong icon reads as an unfinished product.

## Non-blocking issues

- **Empty-form product proof.** `app-add-event@2x.png` shows Title empty
  ("Give this memory a title…") and Body Weight `0.0`. An empty form is weak
  proof. Capture it filled in.
- **Bottom clipping.** In the same shot the "Photo" section is sliced by the tab
  bar mid-control.
- **Dead space.** `app-ask-ai@2x.png` is ~45% empty below the tip card;
  `app-profiles@2x.png` is ~30% empty. Both need cropping (see below) or they
  will look sparse in a device mock.
- **Stale date.** The feed is dated "May 13, 2026", roughly four months before
  today. Prefer a recent date on recapture.

## Recommendation

Do **not** ship the landing product proof from the current four assets. Request
a recapture (see the follow-up issue filed with SWE). Until that lands:

- **Hero:** use `app-memory-feed@2x.png` only, cropped to Mochi-only content, or
  hold the hero device mock behind the recapture.
- Do not use `app-profiles@2x.png` or `app-add-event@2x.png` in any published
  composition.

## Recapture spec

Same device class and pipeline as the existing fastlane captures — iPhone 6.5",
`1320×2868`, `en-US`, light theme, status bar clock set consistently.

1. **Memory feed** — two *cat* profiles, correct per-category icons, four to five
   rows with recent dates, mixed categories.
2. **Profiles** — two cats. Replace or rename the beagle record.
3. **Ask AI** — two cat session cards; keep the "only consult their memories"
   line, it is good trust copy.
4. **Add event** — Title filled with a real memory name, Body Weight populated,
   real pet avatars, sheet scrolled so no control is clipped by the tab bar.

## Crop and alt-text guidance

Crops are given in staged-asset pixels (`880×1912` canvas), origin top-left.

| Asset | Crop | Reason |
| --- | --- | --- |
| `app-memory-feed@2x.png` | full frame, or `0,0 880×1440` for a tile | Retain nav + tab bar for device authenticity |
| `app-ask-ai@2x.png` | `0,0 880×1120` | Removes dead space below the tip card |
| `app-profiles@2x.png` | `0,0 880×1250` | Removes dead space below the tip card |
| `app-add-event@2x.png` | full frame | Sheet is full-bleed; crop cannot fix the clipping |

Always keep the Dynamic Island and home indicator inside the crop, or crop them
out entirely. A half-cut status bar reads as a broken image.

Alt text — describe the evidence, not the widget:

- memory feed → `PurrSafe memory feed showing dated care entries for a cat, including a meal, a weight check, and a health note.`
- ask AI → `PurrSafe Ask AI screen listing each cat's assistant session, noting the assistant only uses that cat's own memories.`
- profiles → `PurrSafe Families screen showing cat profile cards with a health status badge and a link to each cat's archive.`
- add event → `PurrSafe add-memory sheet with memory type, title, and body weight fields.`

Do not write "screenshot of the app" — it tells a screen-reader user nothing
about what the product does.

## Unresolved

- Whether the beagle is intentional (multi-species support) or test data. If
  PurrSafe supports dogs, the in-app "feline family gallery" copy is wrong and
  the landing positioning needs a decision from CMO. If it does not, the record
  is test data and should not appear in any capture.
