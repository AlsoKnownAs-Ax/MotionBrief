import type { Format } from "../../contract";
import { FRAME_SIZES } from "./formats";
import { PALETTE_ROLES, type Face, type FrameTokens } from "./tokens";

/** Type sizes in pixels per Format, before a face's own scale. Vertical runs larger: it is read on a phone. */
const TYPE_SCALE = {
  horizontal: { display: 104, title: 64, body: 38, label: 30, mono: 30 },
  vertical: { display: 112, title: 76, body: 48, label: 40, mono: 34 },
} satisfies Record<Format, Record<string, number>>;

/** Blueprint's treatments: elevated cards, a dot grid, straight 4 px connectors, outline icons. */
const TREATMENTS = { radius: 22, borderWidth: 2, connectorWeight: 4 };

/**
 * The frame's CSS for one unit: the tokens as CSS variables on its root, the safe zone, and the
 * frame-owned classes Scene code builds with (`mb-safe`, `mb-card`, `mb-display`, `mb-title`,
 * `mb-body`, `mb-label`, `mb-mono`, `mb-accent`, `mb-icon`, `mb-wire`).
 */
export function frameCss(format: Format, { palette, typography }: FrameTokens): string {
  const { width, height, safe } = FRAME_SIZES[format];
  const sizes = TYPE_SCALE[format];
  const { display, body, label, mono } = typography;
  const colors = PALETTE_ROLES.map((role) => `--${role}: ${palette.colors[role]};`).join(" ");

  return `#root {
  position: absolute; inset: 0; overflow: hidden; color: var(--ink);
  font-family: var(--font-body); font-weight: ${body.weight};
  ${colors}
  --radius: ${TREATMENTS.radius}px; --border-w: ${TREATMENTS.borderWidth}px; --wire-w: ${TREATMENTS.connectorWeight}px;
  --shadow: ${shadowFor(palette.mode)};
  --font-display: "${display.family}"; --font-body: "${body.family}"; --font-label: "${label.family}"; --font-mono: "${mono.family}";
  --W: ${width}px; --H: ${height}px; --safe-x: ${safe.x}px; --safe-top: ${safe.top}px; --safe-bottom: ${safe.bottom}px;
  --safe-w: ${width - 2 * safe.x}px; --safe-h: ${safe.bottom - safe.top}px;
  --fs-display: ${scaled(sizes.display, display)}px; --fs-title: ${scaled(sizes.title, display)}px;
  --fs-body: ${scaled(sizes.body, body)}px; --fs-label: ${scaled(sizes.label, label)}px; --fs-mono: ${scaled(sizes.mono, mono)}px;
}
.mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }
.mb-bg::after { content: ""; position: absolute; inset: 0; opacity: .35;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--muted) 20%, transparent) 1.5px, transparent 1.6px); background-size: 48px 48px; }
.mb-safe { position: absolute; left: var(--safe-x); top: var(--safe-top); width: var(--safe-w); height: var(--safe-h); }
.mb-card { position: relative; background: var(--surface); border: var(--border-w) solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
.mb-display { font-family: var(--font-display); font-size: var(--fs-display); font-weight: ${display.weight}; letter-spacing: ${display.tracking ?? "0"}; line-height: 1.02; }
.mb-title { font-family: var(--font-display); font-size: var(--fs-title); font-weight: ${display.weight}; letter-spacing: ${display.tracking ?? "0"}; line-height: 1.08; }
.mb-body { font-family: var(--font-body); font-size: var(--fs-body); font-weight: ${body.weight}; letter-spacing: ${body.tracking ?? "0"}; line-height: 1.25; }
.mb-label { font-family: var(--font-label); font-size: var(--fs-label); font-weight: ${label.weight}; letter-spacing: ${label.tracking ?? "0"}; color: var(--muted); }
.mb-mono { font-family: var(--font-mono); font-size: var(--fs-mono); font-weight: ${mono.weight}; }
.mb-accent { color: var(--accent); }
.mb-icon { display: block; width: 1em; height: 1em; flex: none; }
.mb-wire { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mb-wire path { fill: none; stroke: var(--line); stroke-width: var(--wire-w); stroke-linecap: round; stroke-linejoin: round; }
`;
}

function scaled(size: number, face: Face): number {
  return Math.round(size * (face.scale ?? 1));
}

function shadowFor(mode: FrameTokens["palette"]["mode"]): string {
  if (mode === "dark") {
    return "0 20px 60px color-mix(in srgb, black 35%, transparent)";
  }

  return "0 12px 32px color-mix(in srgb, var(--ink) 10%, transparent)";
}
