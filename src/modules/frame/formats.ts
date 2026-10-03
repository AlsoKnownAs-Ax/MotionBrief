import type { Format } from "../../contract";

/**
 * Where Scene content may sit, in pixels: `x` from each side, between `top` and `bottom`.
 * Below `bottom` is reserved: for Captions in vertical, breathing room in horizontal.
 */
export type SafeZone = { x: number; top: number; bottom: number };

export type FrameSize = { width: number; height: number; safe: SafeZone };

/** Each Format's frame, with safe zones tuned in the spike. Vertical keeps its bottom fifth for Captions. */
export const FRAME_SIZES = {
  horizontal: { width: 1920, height: 1080, safe: { x: 120, top: 100, bottom: 980 } },
  vertical: { width: 1080, height: 1920, safe: { x: 72, top: 180, bottom: 1500 } },
} satisfies Record<Format, FrameSize>;
