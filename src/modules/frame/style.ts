import type { StylePreset } from "../../contract";

/**
 * What the frame draws a unit in: the Style Preset's Palette and typography as CSS variables, its
 * treatments as frame-owned classes, filters and overlays, and its Motion as the `MB.*` defaults.
 * Scene code reads only the tokens (ADR 0003), so a Palette or typography swap is a re-render.
 */
export type FrameStyle = Pick<StylePreset, "palette" | "typography" | "treatments" | "motion">;
