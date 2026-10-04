import { PaletteRoleSchema, type Face, type Format, type Treatments } from "../../contract";
import { FRAME_SIZES } from "./formats";
import type { FrameStyle } from "./style";

/** Type sizes in pixels per Format, before a face's own scale. Vertical runs larger: it is read on a phone. */
const TYPE_SCALE = {
  horizontal: { display: 104, title: 64, body: 38, label: 30, mono: 30 },
  vertical: { display: 112, title: 76, body: 48, label: 40, mono: 34 },
} satisfies Record<Format, Record<string, number>>;

/** The id of the displacement filter that gives sketchy outlines and icons their hand-drawn wobble. */
export const SKETCH_FILTER = "mb-sketch";

/**
 * The frame's CSS for one unit: the tokens as CSS variables on its root, the safe zone, and the
 * frame-owned classes Scene code builds with (`mb-safe`, `mb-card`, `mb-display`, `mb-title`,
 * `mb-body`, `mb-label`, `mb-mono`, `mb-accent`, `mb-icon`, `mb-wire`), drawn in the Preset's treatments.
 */
export function frameCss(format: Format, { palette, typography, treatments }: FrameStyle): string {
  const { width, height, safe } = FRAME_SIZES[format];
  const sizes = TYPE_SCALE[format];
  const { display, body, label, mono } = typography;
  const colors = PaletteRoleSchema.options.map((role) => `--${role}: ${palette.colors[role]};`).join(" ");

  return `#root {
  position: absolute; inset: 0; overflow: hidden; color: var(--ink);
  font-family: var(--font-body); font-weight: ${body.weight};
  ${colors}
  --radius: ${treatments.radius}px; --border-w: ${borderWidth(treatments)}px; --wire-w: ${treatments.connector.weight}px;
  --shadow: ${shadowFor(palette.mode)};
  --font-display: "${display.family}"; --font-body: "${body.family}"; --font-label: "${label.family}"; --font-mono: "${mono.family}";
  --W: ${width}px; --H: ${height}px; --safe-x: ${safe.x}px; --safe-top: ${safe.top}px; --safe-bottom: ${safe.bottom}px;
  --safe-w: ${width - 2 * safe.x}px; --safe-h: ${safe.bottom - safe.top}px;
  --fs-display: ${scaled(sizes.display, display)}px; --fs-title: ${scaled(sizes.title, display)}px;
  --fs-body: ${scaled(sizes.body, body)}px; --fs-label: ${scaled(sizes.label, label)}px; --fs-mono: ${scaled(sizes.mono, mono)}px;
}
${BACKGROUNDS[treatments.background]}
.mb-safe { position: absolute; left: var(--safe-x); top: var(--safe-top); width: var(--safe-w); height: var(--safe-h); }
${SURFACES[treatments.surface]}
.mb-display { font-family: var(--font-display); font-size: var(--fs-display); font-weight: ${display.weight}; letter-spacing: ${display.tracking ?? "0"}; line-height: 1.02; }
.mb-title { font-family: var(--font-display); font-size: var(--fs-title); font-weight: ${display.weight}; letter-spacing: ${display.tracking ?? "0"}; line-height: 1.08; }
.mb-body { font-family: var(--font-body); font-size: var(--fs-body); font-weight: ${body.weight}; letter-spacing: ${body.tracking ?? "0"}; line-height: 1.25; }
.mb-label { font-family: var(--font-label); font-size: var(--fs-label); font-weight: ${label.weight}; letter-spacing: ${label.tracking ?? "0"}; color: var(--muted); }
.mb-mono { font-family: var(--font-mono); font-size: var(--fs-mono); font-weight: ${mono.weight}; }
.mb-accent { color: var(--accent); }
.mb-icon { display: block; width: 1em; height: 1em; flex: none; }
${ICONS[treatments.icons]}
.mb-wire { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mb-wire path { fill: none; stroke: var(--line); stroke-width: var(--wire-w); stroke-linecap: round; stroke-linejoin: round; }
${sketchyCss(treatments)}`;
}

const BACKGROUNDS = {
  solid: ".mb-bg { position: absolute; inset: 0; background: var(--bg); }",
  gradient: ".mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }",
  "dot-grid": `.mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }
.mb-bg::after { content: ""; position: absolute; inset: 0; opacity: .35;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--muted) 20%, transparent) 1.5px, transparent 1.6px); background-size: 48px 48px; }`,
  "line-grid": `.mb-bg { position: absolute; inset: 0; background: var(--bg); }
.mb-bg::after { content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(color-mix(in srgb, var(--line) 28%, transparent) 1.5px, transparent 1.5px), linear-gradient(90deg, color-mix(in srgb, var(--line) 28%, transparent) 1.5px, transparent 1.5px);
  background-size: 64px 64px; background-position: -1px -1px; }`,
} satisfies Record<Treatments["background"], string>;

const SURFACES = {
  flat: ".mb-card { position: relative; background: var(--surface); border: 0; border-radius: var(--radius); }",
  outlined: ".mb-card { position: relative; background: var(--surface); border: var(--border-w) solid var(--line); border-radius: var(--radius); }",
  elevated:
    ".mb-card { position: relative; background: var(--surface); border: var(--border-w) solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }",
} satisfies Record<Treatments["surface"], string>;

/** Chips wrap the icon, so an icon takes the same 1em box in every icon treatment. */
const ICONS = {
  outline: "",
  "outline-chip": `.mb-chip { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 1em; height: 1em; flex: none; border-radius: 26%; background: var(--surface2); border: 2px solid var(--line); }
.mb-chip > .mb-icon { width: .58em; height: .58em; }`,
  "filled-chip": `.mb-chip { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 1em; height: 1em; flex: none; border-radius: 30%; background: currentColor; border: var(--border-w) solid var(--line); }
.mb-chip > .mb-icon { width: .56em; height: .56em; color: var(--surface); }`,
} satisfies Record<Treatments["icons"], string>;

/**
 * Sketchy outlines: a card's outline moves to a `::before` behind a displacement filter, so the text
 * on it stays crisp; icons and chips wobble the same way. Connectors wobble in their geometry
 * instead (MB.connect), because a filter's box clips a perfectly straight line.
 */
function sketchyCss({ line, surface }: Treatments): string {
  if (line !== "sketchy") {
    return "";
  }

  const outlines =
    surface === "flat"
      ? ""
      : `.mb-card { border-color: transparent; }
.mb-card::before { content: ""; position: absolute; inset: calc(-1 * var(--border-w)); border: var(--border-w) solid var(--line); border-radius: inherit; filter: url(#${SKETCH_FILTER}); pointer-events: none; }
`;

  return `${outlines}.mb-icon, .mb-chip { filter: url(#${SKETCH_FILTER}); }
.mb-chip > .mb-icon { filter: none; }
`;
}

/** Outlined surfaces carry the connectors' weight, so boxes and lines read as drawn with one pen. */
function borderWidth({ surface, connector }: Treatments): number {
  if (surface === "outlined") {
    return Math.max(2, connector.weight - 1);
  }

  return 2;
}

function scaled(size: number, face: Face): number {
  return Math.round(size * (face.scale ?? 1));
}

function shadowFor(mode: FrameStyle["palette"]["mode"]): string {
  if (mode === "dark") {
    return "0 20px 60px color-mix(in srgb, black 35%, transparent)";
  }

  return "0 12px 32px color-mix(in srgb, var(--ink) 10%, transparent)";
}
