---
version: alpha
name: Framer-design-analysis
description: "A confident dark-canvas builder marketing site that treats the page like a working artboard — pure black surfaces, white display type set in GT Walsheim Medium with aggressive negative tracking, and a single confident brand orange (#ff7a3d) that fills the primary CTA and marks hyperlinks and selection states. The page rhythm is broken by oversized vibrant gradient atmosphere panels — magenta, violet, amber spotlights — that act as living showcase tiles, not decoration. Every primary CTA is an orange pill on dark; every card is a translucent or charcoal surface; every section title pulls letter-spacing tight enough to feel like a poster."

colors:
  primary: "#ff7a3d"
  on-primary: "#000000"
  ink: "#ffffff"
  ink-muted: "#999999"
  canvas: "#090909"
  surface-1: "#141414"
  surface-2: "#1c1c1c"
  hairline: "#262626"
  hairline-soft: "#1a1a1a"
  inverse-canvas: "#ffffff"
  inverse-ink: "#000000"
  gradient-magenta: "#d44df0"
  gradient-violet: "#6a4cf5"
  gradient-amber: "#ffb23d"
  gradient-coral: "#ff5577"
  semantic-success: "#22c55e"
  surface-3: "#262626"
  status-working: "#6a4cf5"
  status-working-ink: "#b3a4ff"
  status-flagged: "#ffb23d"
  status-fallback: "#ff5577"
  status-fallback-ink: "#ff8aa1"
  status-success: "#22c55e"
  status-working-tint: "#18142f"
  status-flagged-tint: "#261d0f"
  status-fallback-tint: "#2b1418"
  status-success-tint: "#0c2013"

typography:
  display-xxl:
    fontFamily: GT Walsheim Framer Medium
    fontSize: 110px
    fontWeight: 500
    lineHeight: 0.85
    letterSpacing: -5.5px
  display-xl:
    fontFamily: GT Walsheim Medium
    fontSize: 85px
    fontWeight: 500
    lineHeight: 0.95
    letterSpacing: -4.25px
    fontFeature: ss02
  display-lg:
    fontFamily: GT Walsheim Medium
    fontSize: 62px
    fontWeight: 500
    lineHeight: 1.00
    letterSpacing: -3.1px
    fontFeature: ss02
  display-md:
    fontFamily: GT Walsheim Medium
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.13
    letterSpacing: -1.0px
  headline:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.20
    letterSpacing: -0.8px
    fontFeature: cv05
  subhead:
    fontFamily: Inter Variable
    fontSize: 24px
    fontWeight: 400
    lineHeight: 1.30
    letterSpacing: -0.01px
    fontFeature: cv11
  body-lg:
    fontFamily: Inter Variable
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.30
    letterSpacing: -0.18px
    fontFeature: cv11
  body:
    fontFamily: Inter Variable
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.30
    letterSpacing: -0.15px
    fontFeature: cv11
  body-sm:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: -0.14px
    fontFeature: cv11
  caption:
    fontFamily: Inter Variable
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: -0.13px
    fontFeature: cv11
  micro:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.20
    letterSpacing: -0.12px
    fontFeature: cv11
  button:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -0.14px
    fontFeature: cv11
  app-display:
    fontFamily: Inter Variable
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.13
    letterSpacing: -1px
    fontFeature: cv11
  app-title:
    fontFamily: Inter Variable
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.5px
    fontFeature: cv11
  app-body:
    fontFamily: Inter Variable
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.14px
    fontFeature: cv11
  app-sm:
    fontFamily: Inter Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.1px
    fontFeature: cv11
  app-xs:
    fontFamily: Inter Variable
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.05px
    fontFeature: cv11

rounded:
  xs: 4px
  sm: 6px
  md: 10px
  lg: 15px
  xl: 20px
  xxl: 30px
  pill: 100px
  full: 9999px
  app-xs: 4px
  app-sm: 6px
  app-md: 10px
  app-lg: 12px
  app-xl: 16px

spacing:
  hair: 1px
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 15px
  lg: 20px
  xl: 30px
  xxl: 40px
  section: 96px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 15px
  button-primary-pressed:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 15px
  button-tertiary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 10px 15px
  button-translucent:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.xxl}"
    padding: 8px 14px
  button-icon-circular:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    size: 40px
  pricing-tab-default:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 14px
  pricing-tab-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 8px 14px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 10px 14px
  text-input-focused:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 10px 14px
  pricing-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 24px
  pricing-card-featured:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 24px
  template-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 12px
  gradient-spotlight-card:
    backgroundColor: "{colors.gradient-violet}"
    textColor: "{colors.ink}"
    typography: "{typography.subhead}"
    rounded: "{rounded.xl}"
    padding: 32px
  gradient-spotlight-card-magenta:
    backgroundColor: "{colors.gradient-magenta}"
    textColor: "{colors.ink}"
    typography: "{typography.subhead}"
    rounded: "{rounded.xl}"
    padding: 32px
  gradient-spotlight-card-amber:
    backgroundColor: "{colors.gradient-amber}"
    textColor: "{colors.ink}"
    typography: "{typography.subhead}"
    rounded: "{rounded.xl}"
    padding: 32px
  product-mockup-tile:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: 16px
  feature-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
  comparison-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    height: 56px
  faq-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 24px
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 64px 32px
  app-title-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.app-sm}"
    height: 52px
  app-button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.app-body}"
    rounded: "{rounded.pill}"
    height: 34px
    padding: 0 15px
  app-button-tertiary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.app-body}"
    rounded: "{rounded.pill}"
    height: 34px
    padding: 0 15px
  app-button-tertiary-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    typography: "{typography.app-body}"
    rounded: "{rounded.pill}"
    height: 34px
  app-button-ghost:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.app-body}"
    rounded: "{rounded.pill}"
    height: 34px
    padding: 0 15px
  app-button-sm:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.app-sm}"
    rounded: "{rounded.pill}"
    height: 28px
    padding: 0 11px
  app-icon-button:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    size: 34px
  app-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.app-body}"
    rounded: "{rounded.app-md}"
    height: 36px
    padding: 0 12px
  app-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.app-sm}"
    rounded: "{rounded.app-lg}"
    padding: 12px
  app-dialog:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.app-body}"
    rounded: "{rounded.app-xl}"
    padding: 20px
  app-kbd:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
  app-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
    padding: 0 7px
  app-badge-working:
    backgroundColor: "{colors.status-working-tint}"
    textColor: "{colors.status-working-ink}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
  app-badge-flagged:
    backgroundColor: "{colors.status-flagged-tint}"
    textColor: "{colors.status-flagged}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
  app-badge-fallback:
    backgroundColor: "{colors.status-fallback-tint}"
    textColor: "{colors.status-fallback-ink}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
  app-badge-success:
    backgroundColor: "{colors.status-success-tint}"
    textColor: "{colors.status-success}"
    typography: "{typography.app-xs}"
    rounded: "{rounded.app-sm}"
    height: 20px
---

## Overview

Framer's marketing canvas is a near-pure black artboard. The dominant surface is `{colors.canvas}` — almost pure black with a faint warmth — and on top of it sits oversized white display type set in **GT Walsheim Medium** with letter-spacing pulled to extreme negative values (-5.5px on the 110px display, -4.25px on the 85px hero). The page reads like a poster: one assertive statement per band, generous breathing room above and below.

The single chromatic brand color is `{colors.primary}` orange — it fills the primary CTA pill and doubles as the signal color for hyperlinks, selection halos, and a subtle orange-tinted shadow ring on focused inputs. Everything else in the chrome is monochrome: white secondary pills, charcoal cards, gray secondary text. What makes Framer distinctive is the rhythm break — every few sections the page drops in a **vibrant gradient atmosphere card**: a magenta-violet spotlight, a sunset-amber wash, a coral-pink panel. These aren't section backgrounds; they're individual cards arranged in a card grid, each one a small living poster that shows what Framer can produce.

Body type is **Inter Variable**, with Framer leaning hard into Inter's character variants (`cv01`, `cv05`, `cv09`, `cv11`, `ss03`, `ss07`, `dlig`) — the result is a body voice that feels custom-tuned, with single-storey "a", straight-leg "l", and tabular figures. There's no light mode on the marketing site; the brand IS dark.

**Key Characteristics:**
- Black-canvas marketing system: `{colors.canvas}` is the surface for hero, body, pricing, FAQ, and footer alike — no light interludes.
- Massive negative letter-spacing on display sizes (-5.5px / -4.25px / -3.1px) creates a poster-grade headline cadence.
- Orange pill (`{components.button-primary}`) is the only primary CTA shape across the site; secondary actions live as white pills (`{components.button-secondary}`), charcoal pills (`{components.button-tertiary}`), or text links.
- Oversized **gradient spotlight cards** (violet, magenta, amber, coral) act as showcase tiles inside the dark grid; they are individual cards, not section backgrounds.
- Inter Variable with bespoke OpenType character variants (`cv01/05/09/11`, `ss03/ss07`, `dlig`) used everywhere body type appears — the typographic voice is unmistakable.
- Border radius scale runs from 4px utility chips up to 100px pills and full circles, with 15–20px the default for cards and 30px for atmospheric gradient cards.
- A single chromatic brand color `{colors.primary}` orange: the primary CTA fill, plus hyperlinks, focus, and selection — never decorative.

## Colors

> Source pages: framer.com (home), /ai/, /startups/, /marketplace/templates/nudge/, /gallery/a16z-speedrun-×-tonik, /pricing.

### Brand & Accent
- **Brand Orange** ({colors.primary}): The single chromatic brand color. Fills every primary CTA pill (with `{colors.on-primary}` black text — white on this orange fails contrast at ~2.6:1; black passes at ~8:1), and serves as the signal color for hyperlinks, focused-input rings, and selection states (~7.7:1 on canvas). Never used for section backgrounds or large decorative fills.
- **Pure White** ({colors.ink} / {colors.inverse-canvas}): Every display headline and body line on canvas, and the fill of the secondary pill.

### Surface
- **Canvas** ({colors.canvas}): Default page background — near-black with a faint warmth. Footer, pricing, hero, and FAQ all sit on it.
- **Surface 1** ({colors.surface-1}): One step above canvas — pricing cards, secondary buttons, mockup tiles.
- **Surface 2** ({colors.surface-2}): Two steps above — featured pricing card, hero pill backdrop, selected pricing tab.
- **Hairline** ({colors.hairline}): 1px borders on input groups, comparison-table dividers.
- **Hairline Soft** ({colors.hairline-soft}): Subtler dividers — between FAQ rows and footer column rules.
- **Inverse Canvas** ({colors.inverse-canvas}): Pure white — used as the surface of the secondary pill (`{components.button-secondary}`) and a small set of light-mode template thumbnails embedded in the showcase grid.

### Text
- **Ink** ({colors.ink}): All headline and emphasized body type — pure white.
- **Ink Muted** ({colors.ink-muted}): Secondary type — gray (#999999) used for meta info, footer columns, comparison-row labels, deselected pricing tabs. Hierarchy on the dark canvas is carried by ink → ink-muted contrast, not by weight changes.

### Semantic
- **Success Green** ({colors.semantic-success}): Pricing comparison-table checkmarks. Glyph fill, not surface.

### Brand Gradient (signature)
- **Gradient Magenta** ({colors.gradient-magenta}): Spotlight card variant.
- **Gradient Violet** ({colors.gradient-violet}): Spotlight card variant — most common.
- **Gradient Amber** ({colors.gradient-amber}): Spotlight card variant — sunset wash. Deliberately yellower than `{colors.primary}` so a spotlight card never reads as a giant CTA.
- **Gradient Coral** ({colors.gradient-coral}): Spotlight card variant — coral/pink.

These four sit as oversized atmospheric tiles inside otherwise monochrome card grids — a dark canvas with one or two glowing spotlight cards is a recurring page signature.

## Typography

### Font Family

- **GT Walsheim Framer Medium** / **GT Walsheim Medium** — Framer's display typeface. Geometric, slightly humanist, very confident at large sizes with extreme negative tracking. Fallbacks: `GT Walsheim Medium Placeholder` system font.
- **Inter Variable** — System body typeface. Used with extensive OpenType character variants: `cv01` (alternate "1"), `cv05` (alternate "g"), `cv09` (alternate "i" / "l"), `cv11` (alternate "0"), `ss03` / `ss07` stylistic sets, `dlig` discretionary ligatures, and `tnum` for numerics in tabular contexts. The result is a body voice that feels bespoke without commissioning a custom face.
- **Inter** — Used selectively for `{typography.headline}` (the 22px / 20px tier). The non-variable cut catches small tracking targets that the variable file rounds.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xxl}` | 110px | 500 | 0.85 | -5.5px | Largest hero headline (home, AI page) |
| `{typography.display-xl}` | 85px | 500 | 0.95 | -4.25px | Section opener headlines |
| `{typography.display-lg}` | 62px | 500 | 1.00 | -3.1px | Sub-section openers |
| `{typography.display-md}` | 32px | 500 | 1.13 | -1.0px | Card titles, smaller display |
| `{typography.headline}` | 22px | 700 | 1.20 | -0.8px | Pricing tier headlines, FAQ category titles |
| `{typography.subhead}` | 24px | 400 | 1.30 | -0.01px | Lead body next to display headlines |
| `{typography.body-lg}` | 18px | 400 | 1.30 | -0.18px | Hero subhead, lead paragraphs |
| `{typography.body}` | 15px | 400 | 1.30 | -0.15px | Default body, card descriptions |
| `{typography.body-sm}` | 14px | 500 | 1.40 | -0.14px | Pricing comparison rows, dense data |
| `{typography.caption}` | 13px | 500 | 1.20 | -0.13px | Eyebrows, footer columns, meta |
| `{typography.micro}` | 12px | 400 | 1.20 | -0.12px | Disclaimer, footnote |
| `{typography.button}` | 14px | 500 | 1.0 | -0.14px | Pill buttons |

### Principles

- **Letter-spacing scales with size, hard.** Display-xxl pulls -5.5px (5% of size); body sticks to about -1% (-0.15px on 15px). The result: posters at the top, comfortable reading at body.
- **OpenType character variants are the brand voice.** Switching off `cv11`, `ss03`, etc. visibly changes the body voice — the brand depends on them.
- **Weight stays in a narrow band.** Display sits at 500, body at 400, body-sm/caption at 500. Hierarchy is carried by size + tracking, not by 700/900 ramps.
- **Tight line-heights everywhere.** Even body runs at 1.30 — Framer's editorial tone is denser than typical SaaS marketing.

### Note on Font Substitutes

If implementing without GT Walsheim Medium, suitable open-source substitutes include **Mona Sans**, **Geist**, or **Inter** at weight 600–700 with manually tightened tracking. Mona Sans's hairline weights at 100–300 are particularly close to Framer's cleaner section openers. Inter Variable is open-source — keep it as-is and preserve the documented OpenType variants.

## Layout

### Spacing System

- **Base unit**: 5px (Framer uses non-standard 5/10/15/20/30 increments rather than the more common 4/8/16/24).
- **Tokens (front matter)**: `{spacing.hair}` 1px · `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 15px · `{spacing.lg}` 20px · `{spacing.xl}` 30px · `{spacing.xxl}` 40px · `{spacing.section}` 96px.
- Card interior padding: `{spacing.lg}` 20px on pricing cards; `{spacing.xl}` 30px on gradient spotlight cards.
- Pill button padding: 10px vertical · 15px horizontal — `{components.button-primary}`.
- Section padding (vertical): roughly `{spacing.section}` 96px on home; tighter (~64px) on pricing comparison.

### Grid & Container

- Max content width sits around the 1199px breakpoint, with side gutters that scale toward `{spacing.xl}` on desktop.
- Card grids on the home gallery use 2-up at desktop, collapsing to 1-up below 810px.
- Pricing tier grid is 4-up across the documented breakpoints; comparison table beneath it uses fixed-width left column with horizontally scrolling tier columns at narrow widths.

### Whitespace Philosophy

The dark canvas IS the whitespace. Where lighter brands lean on white air to separate sections, Framer leans on long stretches of black with a single oversized statement floating in the middle. Sections separate by mode change: a band of charcoal cards, then a band of black with a gradient spotlight, then back to charcoal — like cuts in a dark film.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow, no border | Default for canvas-mounted display type, FAQ rows, footer |
| 1 (charcoal) | `{colors.surface-1}` lift on canvas | Pricing cards, mockup tiles, secondary buttons |
| 2 (light-edge) | `rgba(255,255,255,0.10)` 0.5px top edge + `rgba(0,0,0,0.25)` 0px 10px 30px drop | Floating product cards, modal cards |
| 3 (selected) | `rgba(255,122,61,0.15)` 0px 0px 0px 1px ring | Focused inputs, selected option |

Four shadow signatures recur across the homepage: a 1px subtle drop, a translucent orange ring, a thick near-black 2px outline (used as the active-element marker on sub-nav), and the layered light-edge + drop-shadow used for floating cards.

### Decorative Depth

- **Gradient spotlight cards** are the dominant depth device — color saturation against black canvas substitutes for shadow-driven elevation.
- **Layered product mockups** (browser frames containing live Framer-built sites) sit inside `{colors.surface-1}` cards with the level-2 light-edge treatment.
- **Subtle orange ring (focus / selected)** is the only chromatic depth signal — used to mark the active state of input groups and pricing tier toggles without changing the underlying surface.

## Shapes

### Border Radius Scale

Framer's extracted radius set is unusually granular (1px, 4px, 5px, 6px, 8px, 10px, 12px, 15px, 20px, 30px, 40px, 100px). The named scale below picks the levels the marketing surface actually consumes.

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Small chip / utility radius |
| `{rounded.sm}` | 6px | Inline tag, badge |
| `{rounded.md}` | 10px | Form input, list item |
| `{rounded.lg}` | 15px | Template card thumbnails |
| `{rounded.xl}` | 20px | Pricing cards, mockup tiles |
| `{rounded.xxl}` | 30px | Gradient spotlight cards, oversized panels |
| `{rounded.pill}` | 100px | All primary text CTAs |
| `{rounded.full}` | 9999px | Circular icon buttons, avatar circles |

### Photography & Illustration Geometry

- Embedded site mockups (browser-chromed previews of Framer-built sites) sit in `{rounded.xl}` 20px tiles with `{spacing.md}` 15px interior padding.
- Gradient spotlight cards use `{rounded.xxl}` 30px corners — softer than the 20px content cards by design, to make them feel like atmospheric panels rather than tighter UI.
- Icon glyphs and sub-nav glyphs render in `{rounded.full}` circles at 32–40px sizes.

## Components

### Buttons

**`button-primary`** — Orange pill on dark canvas. The primary CTA across home, pricing, AI, and gallery pages.
- Background `{colors.primary}`, text `{colors.on-primary}`, type `{typography.button}`, padding 10px 15px, rounded `{rounded.pill}`.
- Pressed state lives in `button-primary-pressed` (the live site uses a transform-scale shrink rather than a darkened fill).

**`button-secondary`** — White pill. The visual counterpart to the orange primary when a second strong action sits beside it.
- Background `{colors.inverse-canvas}`, text `{colors.inverse-ink}`, type `{typography.button}`, padding 10px 15px, rounded `{rounded.pill}`.

**`button-tertiary`** — Charcoal pill. Used for low-emphasis navigation actions ("Sign in", "Talk to sales").
- Background `{colors.surface-1}`, text `{colors.ink}`, type `{typography.button}`, padding 10px 15px, rounded `{rounded.pill}`.

**`button-translucent`** — Translucent / lifted secondary used on top of busy backgrounds (gallery hero, gradient cards).
- Background `{colors.surface-2}`, text `{colors.ink}`, type `{typography.button}`, rounded `{rounded.xxl}`, padding 8px 14px.

**`button-icon-circular`** — 40px circle for inline icon actions (carousel arrows, social links).
- Background `{colors.surface-1}`, text `{colors.ink}`, rounded `{rounded.full}`, size 40px.

### Pricing Tabs

**`pricing-tab-default`** + **`pricing-tab-selected`** — The pill-toggle that switches between Basic / Pro / Business / Enterprise on `/pricing`.
- Default: `{colors.canvas}` background, `{colors.ink-muted}` text, rounded `{rounded.pill}`.
- Selected: `{colors.surface-2}` background, `{colors.ink}` text — selected = lift, not color. Surface depth communicates "active" without needing a chromatic fill.

### Inputs & Forms

**`text-input`** + **`text-input-focused`** — Form fields on `/pricing` (seat-count, currency switcher) and the in-product preview surfaces.
- Background `{colors.surface-1}`, text `{colors.ink}`, type `{typography.body}`, rounded `{rounded.md}`, padding 10px 14px.
- Focused state retains the same surface; the focus ring is the level-3 orange-tinted shadow `rgba(255,122,61,0.15)` 0 0 0 1px.

### Cards & Containers

**`pricing-card`** — Each tier on `/pricing`.
- Background `{colors.surface-1}`, text `{colors.ink}`, type `{typography.body}`, rounded `{rounded.xl}`, padding 24px.

**`pricing-card-featured`** — The Pro tier (visually emphasized).
- Background `{colors.surface-2}`, otherwise identical structure. The lift is one surface step up — no chromatic outline.

**`template-card`** — Thumbnail tile in the home "Built with Framer" gallery and `/marketplace`.
- Background `{colors.surface-1}`, text `{colors.ink}`, type `{typography.body-sm}`, rounded `{rounded.lg}`, padding 12px.

**`product-mockup-tile`** — Larger tile that frames a live product UI mock (Framer canvas, Workshop video, AI translate panel).
- Background `{colors.surface-1}`, text `{colors.ink}`, type `{typography.body-sm}`, rounded `{rounded.xl}`, padding 16px.

### Gradient Spotlight Cards (signature)

The defining decorative surface of Framer's marketing — oversized atmospheric tiles dropped into otherwise monochrome card grids. Variants:

**`gradient-spotlight-card`** — violet ground (most common).
- Background `{colors.gradient-violet}`, text `{colors.ink}`, type `{typography.subhead}`, rounded `{rounded.xl}`, padding 32px. (The on-site card often pushes to `{rounded.xxl}` 30px when it spans a wider tile.)

**`gradient-spotlight-card-magenta`** — magenta-pink ground.
- Background `{colors.gradient-magenta}`, otherwise identical.

**`gradient-spotlight-card-amber`** — sunset-amber wash.
- Background `{colors.gradient-amber}`, otherwise identical.

(Coral pink follows the same shape with `{colors.gradient-coral}`.)

### Comparison & FAQ

**`feature-row`** + **`comparison-row`** — Single rows inside the pricing comparison table.
- `feature-row`: `{colors.canvas}` background, `{colors.ink}` text. Header rows.
- `comparison-row`: `{colors.canvas}` background, `{colors.ink-muted}` text. Data rows with `{typography.body-sm}` and 1px `{colors.hairline-soft}` underlines.

**`faq-row`** — Each accordion line in the pricing-page FAQ.
- Background `{colors.canvas}`, text `{colors.ink}`, type `{typography.body}`, rounded `{rounded.md}`, padding 24px.

### Navigation

**`top-nav`** — Sticky bar on `{colors.canvas}` with the Framer wordmark left, primary nav links centered, and a `button-tertiary` ("Sign in") + `button-primary` ("Get started for free") pair right.
- Background `{colors.canvas}`, text `{colors.ink}`, type `{typography.body-sm}`, height 56px.
- Mobile: collapses primary links into a hamburger; the two pill CTAs collapse into a single primary pill on the bar.

### Footer

**`footer`** — Dense link grid on `{colors.canvas}` with the Framer wordmark left and 5–6 columns of caption-sized links.
- Background `{colors.canvas}`, text `{colors.ink-muted}`, type `{typography.caption}`, padding 64px 32px.

## App Scale

MotionBrief is a desktop app, not a marketing page, so it uses a denser scale on the same brand: canvas, surface lifts, white ink, one orange signal, Inter with its character variants. The `app-*` tokens in the front matter are that scale. The marketing tokens above stay as the brand reference; app UI uses the `app-*` tokens. They are wired into Tailwind and shadcn/ui in `src/renderer/src/styles/globals.css` (shadcn's roles `background`, `card`, `primary`, `muted`, `accent`, `border`, `ring` map onto canvas, surface-1, primary, ink-muted, surface-3, hairline and primary).

- **Type**: `{typography.app-body}` 14px is the default; `{typography.app-sm}` 13px for dense rows and secondary text; `{typography.app-xs}` 12px for badges, keys and meta; `{typography.app-title}` 20px for dialog and panel titles; `{typography.app-display}` 32px for at most one screen heading. No display sizes above 32px in the app.
- **Radii**: denser than the marketing cards. `{rounded.app-sm}` 6px badges and keys, `{rounded.app-md}` 10px inputs and menus, `{rounded.app-lg}` 12px panels, `{rounded.app-xl}` 16px dialogs. Buttons stay pills (`{rounded.pill}`); icon buttons stay circles.
- **Sizes**: title bar 52px (`{components.app-title-bar}`), buttons 34px or 28px small, inputs 36px, badges and keys 20px. The window's minimum size is 1024×640.
- **Surfaces**: canvas → `{colors.surface-1}` panels and dialogs → `{colors.surface-2}` resting controls → `{colors.surface-3}` hover lift. On surfaces, hover is a lift, not a color. Filled pills (primary orange, secondary white) only brighten or dim slightly on hover, never change hue, and every pill shrinks a little when pressed.
- **Status colors**: working (violet), flagged (amber), fallback (coral) and success (green). A status badge is the status color as text on a 12–16% tint of itself over canvas (`{colors.status-*-tint}`), with a dot. Use the `-ink` variants for text where the base color is too dark to read (`{colors.status-working-ink}`, `{colors.status-fallback-ink}`). Status colors never fill buttons and never replace the orange signal.
- **Title bar**: the window has no native title bar. The app's own bar drags the window; macOS keeps its traffic lights on the left, Windows its caption buttons on the right, with an app-menu button on the left because Windows shows no menu bar.

## Do's and Don'ts

### Do

- Keep `{colors.canvas}` (near-black) as the system's anchor surface, with white type on it. Every band of the page sits on canvas or a surface lift.
- Push display-size letter-spacing aggressively negative — `{typography.display-xxl}` at -5.5px is the brand signature, not a stylistic accident.
- Use `{colors.primary}` orange for the primary CTA fill, hyperlinks, focus rings, and selected indicators — and nothing else. One orange pill per view is the rule; it marks THE action.
- Always set `{colors.on-primary}` black text on orange fills. White on this orange fails contrast.
- Drop one or two `gradient-spotlight-card` variants into a card grid; they are the brand's atmosphere device. Don't overdo it — three or more in the same viewport reads as a moodboard, not a system.
- Compose every CTA as a pill (`{rounded.pill}`); secondary actions live as white or charcoal pills, never as bordered ghost buttons.
- Keep body type Inter Variable with character variants `cv01`, `cv05`, `cv09`, `cv11`, `ss03`, `ss07` enabled — the brand voice depends on them.
- Use surface lift (canvas → surface-1 → surface-2) to mark hierarchy on dark, not opacity changes on white type.

### Don't

- Don't ship a light-mode marketing page. Framer's identity is dark.
- Don't introduce mid-tone gray text outside `{colors.ink-muted}`. The hierarchy is binary: `ink` or `ink-muted`.
- Don't use `{colors.primary}` orange as a section background, card fill, or large decorative area. It's for the primary pill and signals only.
- Don't square off CTAs. Pill (`{rounded.pill}`) or full circle is the brand vocabulary.
- Don't reduce the negative letter-spacing on display sizes "for accessibility". The compression is intrinsic to the brand voice; reduce the SIZE if needed, but keep the percentage.
- Don't apply gradient backgrounds to whole sections. Gradients are CARDS, not section grounds.
- Don't combine more than one chromatic accent. The palette is monochrome plus one orange plus the gradient family — not "orange, blue, and green".

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Desktop | 1199px | Default desktop layout |
| Tablet | 810px | Card grids collapse 4-up → 2-up; nav becomes hamburger |
| Mobile-Lg | 809px | Pricing comparison table becomes per-tier accordion |
| Mobile-XS | 98px | Smallest documented breakpoint — single-column everything |

### Touch Targets

- Pill buttons (`button-primary`, `button-secondary`) maintain a minimum 44px tap height across all viewports — combine `{typography.button}` 14px line-height with the documented 10px vertical padding.
- Circular icon buttons (`button-icon-circular`) are 40px on desktop and grow to 44px on touch viewports.
- Pricing-tab pills hold ≥40px tap height; below 810px they may collapse into a horizontal-scroll row instead of stacking.

### Collapsing Strategy

- **Nav**: horizontal nav with a centered link group + right-anchored pill pair collapses to a hamburger overlay below 810px. The `button-primary` stays visible on the bar.
- **Card grids**: the gallery and template-card grids go 2-up on desktop → 1-up on mobile. Gradient spotlight cards retain `{rounded.xxl}` corners at every viewport — they don't bleed.
- **Pricing comparison table**: collapses into per-tier accordions below 810px to avoid horizontal scroll.
- **Display type**: `{typography.display-xxl}` 110px scales down toward `{typography.display-lg}` 62px on tablet and `{typography.display-md}` 32px on mobile, preserving the percentage-negative letter-spacing.

### Image Behavior

- Embedded product mockups (browser frames containing live Framer-built sites) maintain their aspect ratio and never crop.
- Gradient spotlight cards keep their gradient orientations across breakpoints — the gradient direction is part of the brand spec.

## Iteration Guide

1. Focus on ONE component at a time and reference it by its `components:` token name (e.g., `{components.button-primary}`, `{components.gradient-spotlight-card}`).
2. When introducing a new section on the dark canvas, decide first which surface lift it lives on — `{colors.canvas}` for hero/FAQ, `{colors.surface-1}` for cards, `{colors.surface-2}` for featured cards. The depth choice is the most consequential decision.
3. Default body to `{typography.body}` with all the documented OpenType variants; reach for `{typography.subhead}` only inside spotlight cards.
4. Run `npx @google/design.md lint DESIGN.md` after edits — `broken-ref`, `contrast-ratio`, and `orphaned-tokens` warnings flag issues automatically.
5. Add new variants as separate component entries (`-pressed`, `-featured`, `-selected`) — do not bury them in prose.
6. Treat `{colors.primary}` orange as the single brand color: the primary pill, hyperlinks, focus, and selection — that's it. If you find yourself reaching for a second orange (or a lighter/darker tint as a new fill), the brand is drifting.
7. Gradient spotlight cards are scarce by design. One or two per long page is the spec; three is a moodboard.

## Known Gaps

- The exact gradient stops for the spotlight cards are derived from screenshot pixels rather than from CSS variables — the production gradients are likely defined as `linear-gradient` strings on individual elements rather than as design tokens. Treat the documented `{colors.gradient-*}` hex values as base anchors, not as exact gradient specs.
- Form-field validation / error styling is not visible on the inspected pages because no error states render in the static screenshots.
- Dark mode is the only mode — no light-mode adaptation is documented because the marketing site does not ship one.
- The marketplace template detail page returned sparser CSS variable data than the other pages; surface tokens for that page were inferred from the matching home / gallery treatment rather than extracted directly.
