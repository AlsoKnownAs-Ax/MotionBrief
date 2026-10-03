/**
 * The style tokens Scene code may use: Palette roles and typography, nothing else (ADR 0003).
 * Scene code reads them as CSS variables, so a Palette or typography swap is a re-render.
 * This is the narrow input a Style Preset feeds the frame; treatments and Motion join it later.
 */

export const PALETTE_ROLES = [
  "bg",
  "bg2",
  "surface",
  "surface2",
  "line",
  "ink",
  "muted",
  "accent",
  "accent2",
  "accent3",
  "good",
  "bad",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

export type Palette = {
  mode: "light" | "dark";
  colors: Record<PaletteRole, string>;
};

/** The OFL font families the frame bundles; Scene code reaches them only through `var(--font-*)`. */
export type FontFamily = "Inter" | "JetBrains Mono";

export type Face = {
  family: FontFamily;
  weight: number;
  /** CSS letter-spacing. */
  tracking?: string;
  /** Size relative to the frame's type scale, for faces that run small or large. */
  scale?: number;
};

export const TYPE_ROLES = ["display", "body", "label", "mono"] as const;

export type TypeRole = (typeof TYPE_ROLES)[number];

export type Typography = Record<TypeRole, Face>;

export type FrameTokens = {
  palette: Palette;
  typography: Typography;
};

/** The default Style Preset's tokens: a dark navy Palette with Inter and JetBrains Mono. */
export const BLUEPRINT: FrameTokens = {
  palette: {
    mode: "dark",
    colors: {
      bg: "#070b14",
      bg2: "#0d1424",
      surface: "#111a2e",
      surface2: "#17223b",
      line: "#2a3a5c",
      ink: "#eef3fb",
      muted: "#93a1bd",
      accent: "#ff7a3d",
      accent2: "#38bdf8",
      accent3: "#a78bfa",
      good: "#22c55e",
      bad: "#f43f5e",
    },
  },
  typography: {
    display: { family: "Inter", weight: 800, tracking: "-0.03em" },
    body: { family: "Inter", weight: 600 },
    label: { family: "Inter", weight: 600 },
    mono: { family: "JetBrains Mono", weight: 400 },
  },
};
