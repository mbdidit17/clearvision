# Home Page Redesign — "Focus Reticle"

## Context

Clear Vision (clearvision.ink) is a single-file static site: `index.html` at repo root (~2.5MB, inline base64 images), plus `_worker.js` for Cloudflare Pages functions (Stripe, auth, email). Pushing to `main` auto-deploys.

The home page (`#home` in `index.html`) is currently minimal: a logo intro animation (SVG eye that draws in, blinks, and crossfades to a PNG — classes `cv-svg`/`introgo`, recently retimed to ~3.8s), followed by a 4-column box grid (`.boxes` / `.box`) linking to Coaching, Store, My Story, Results via `showPage()`.

## Goal

A complete visual rehaul of the home page only, aiming for an Awwwards-caliber result: distinctive, premium, deliberate typography/motion/micro-interactions — not a template look. Every other page, the nav bar, and the footer must be visually and functionally untouched, since they're shared markup/CSS across all pages.

## Hard Constraints

- **Scope**: only `#home` markup/CSS/JS. No changes to `_worker.js`, any `/functions/*` fetch calls, nav bar markup/CSS, footer markup/CSS, or any other `.page` section.
- **Navigation**: all routing continues to go through the existing `showPage(n)` function and `history.pushState` — do not replace or duplicate this mechanism. The 4 destinations still call `showPage('coaching')`, `showPage('store')`, `showPage('story')`, and Results stays non-clickable (no `showPage` call).
- **Store gating**: `showPage('store')` already no-ops unless `currentUser.email==='marcelaug28@gmail.com'` (see `index.html` `showPage()`). Keep this logic as-is; the redesign only changes how the Store destination *looks* (dimmed/"Coming Soon"), not the gating logic itself.
- **Nav/footer behavior on home**: `showPage()` already hides `#nav-links` and shows `#basket-count`/footer appropriately per page — unchanged.
- **Branch workflow**: work on branch `home-redesign`, push it (Cloudflare Pages preview deploy), do not merge to `main` until explicit approval after preview review.
- **Accessibility**: respect `prefers-reduced-motion` — disable canvas particle layer and cursor-tracking, show reticle lines/labels in their resting state without animation.
- **No new build tooling**: stays plain inline CSS/JS, consistent with the current single-file architecture.

## Design

### Concept: "Focus Reticle"

Replace the "logo, then a row of 4 boxes below it" structure with one composed scene: the eye sits large and centered, and the 4 destinations sit around it at the compass points, connected by thin HUD-style lines — leaning into "Eye of Horus" and the brand's "vision / focus / clarity" language.

### Layout (desktop / large viewport)

- Eye logo (`.cv-svg` + crossfaded PNG) scales up from the current 420px to roughly 520–600px, centered in the viewport (`#home` stays a single 100vh scene, no scroll).
- Tagline **"Transformation through clarity"** as a small tracked-out uppercase kicker directly below the eye/wordmark.
- 4 destinations positioned at the four corners around the eye (exact N/E/S/W vs. diagonal corner placement to be finalized during implementation based on what reads cleanest against the eye's proportions):
  - Coaching
  - My Story
  - Store (dimmed, "Coming Soon")
  - Results (dimmed, non-clickable)
- Each destination has a thin connecting line running from the eye outward to its label, and a small HUD-style index prefix (e.g. "01 — COACHING", "02 — STORE", "03 — MY STORY", "04 — RESULTS"). Exact numbering order to be decided in implementation for visual balance.

### Layout (mobile / narrow viewport)

- Reticle lines drop out entirely (large-viewport flourish only).
- Stack: eye (smaller, e.g. current ~current mobile sizing via `max-width:80vw`) → tagline → the 4 destinations as a clean stacked list or 2×2 grid, each retaining the dimmed/bright distinction and index label but no connecting lines.
- Canvas particle layer either significantly reduced in density or disabled below a viewport-width threshold, for mobile perf.

### Motion & micro-interactions

- **Canvas accent layer**: one lightweight `<canvas>` behind the scene — fine purple/white dust motes drifting in the black, denser near the eye. Pure decorative depth layer, `pointer-events:none`, sits behind interactive elements.
- **Iris cursor-tracking**: the existing `.cv-iris` group subtly offsets toward cursor position within a small clamped range (parallax "it's watching you" touch). Disabled under `prefers-reduced-motion` and on touch devices (no persistent cursor).
- **Destination hover (desktop)**: connecting line brightens/redraws, label glows purple, label nudges slightly toward the cursor (magnetic, small clamped offset), small bracket/reticle "lock-on" cue appears around the label.
- **Coaching / My Story**: full bright/glow hover treatment (these are live destinations).
- **Store / Results**: dimmed at rest (quieter line opacity, muted label color). Store keeps its "Coming Soon" sub-label in this muted style. Results gives a small "locked" shake micro-animation on click attempt instead of any navigation (no `showPage` call, matching current non-clickable behavior).

### Intro sequence

Keep the existing eye draw → blink → crossfade animation (`cv-svg`/`introgo`, already retimed to ~3.8s) unchanged as the opening beat. Extend the choreography after the crossfade completes:
1. Reticle lines draw outward from the eye to each label position.
2. Destination labels fade/scale in with a slight stagger between the 4.
3. Tagline fades in last, softly.

One continuous narrative, plays once per page load (same `body.introgo` gating pattern as today — no loops, no replay on nav-back-to-home).

### Typography

- Bebas Neue stays for the wordmark and destination titles, at a more confident scale than the current `.box-title` (1.3rem).
- DM Sans stays for the tagline and HUD index labels/sub-labels, with wide letter-spacing for the uppercase micro-labels, consistent with the existing `.page-label` treatment used elsewhere in the site.

### Technical approach

- New CSS scoped under `#home` (or new home-specific class names that don't collide with `.box`/`.boxes`, which can be removed once the new markup replaces them) plus one small inline `<script>` module for: canvas particle loop, cursor-position tracking, hover/magnetic-pull logic, reticle draw-in sequencing, Results click-shake, `prefers-reduced-motion` branching.
- Canvas uses `requestAnimationFrame`, paused/torn down when navigating away from home (`showPage` already toggles `.page.active`; the script should stop the rAF loop when `#home` is not the active page to avoid wasted cycles on other pages).
- No new external dependencies (no WebGL library) — plain 2D canvas is sufficient for a particle/dust effect.

## Out of Scope

- Any content/copy beyond the single tagline (no new sections, no scrolling).
- Changes to nav bar or footer markup/CSS.
- Changes to Store's actual gating logic, Coaching/Store/Story/Results page content, checkout/auth flows, or `_worker.js`.
- Redesigning the intro animation itself (only extending what happens after it finishes).

## Open Items for Implementation

- Exact corner/compass placement of the 4 destinations relative to the eye (will be resolved visually during build, not a blocking decision).
- Exact numbering/order of the 4 destinations in the HUD index prefixes.
