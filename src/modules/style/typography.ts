import type { Typography } from "../../contract";

/** The bundled OFL font pairings a Style Preset copies its typography from. */
export const INTER_JETBRAINS: Typography = {
  name: "Inter + JetBrains Mono",
  display: { family: "Inter", weight: 800, tracking: "-0.03em" },
  body: { family: "Inter", weight: 600 },
  label: { family: "Inter", weight: 600 },
  mono: { family: "JetBrains Mono", weight: 400 },
};

export const MANROPE_PLEX: Typography = {
  name: "Manrope + IBM Plex Mono",
  display: { family: "Manrope", weight: 800, tracking: "-0.03em" },
  body: { family: "Manrope", weight: 600 },
  label: { family: "Manrope", weight: 600 },
  mono: { family: "IBM Plex Mono", weight: 400 },
};

export const FREDOKA_NUNITO: Typography = {
  name: "Fredoka + Nunito",
  display: { family: "Fredoka", weight: 600, tracking: "-0.01em" },
  body: { family: "Nunito", weight: 700 },
  label: { family: "Nunito", weight: 700 },
  mono: { family: "JetBrains Mono", weight: 400 },
};

/** VT323 runs small, and IBM Plex Mono runs wide, so they are scaled to read like the others. */
export const VT323_PLEX: Typography = {
  name: "VT323 + IBM Plex Mono",
  display: { family: "VT323", weight: 400, tracking: "0.01em", scale: 1.3 },
  body: { family: "IBM Plex Mono", weight: 500, scale: 0.88 },
  label: { family: "IBM Plex Mono", weight: 500, scale: 0.88 },
  mono: { family: "IBM Plex Mono", weight: 400 },
};

export const FONT_PAIRINGS: readonly Typography[] = [INTER_JETBRAINS, MANROPE_PLEX, FREDOKA_NUNITO, VT323_PLEX];
