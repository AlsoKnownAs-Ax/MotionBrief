import type { Motion } from "../../contract";

/** The `MB.*` helper defaults a Motion sets, as the runtime reads them from `MB_DATA.motion`. */
export type MotionDefaults = {
  /** Entrances and emphasis. */
  ease: string;
  /** Moves from one place to another. */
  easeInOut: string;
  /** For wipes, blurs and draw-ons, which an overshooting ease would push past their end state. */
  settle: string;
  /** An entrance's length in seconds; draw-ons and other helpers scale from it. */
  duration: number;
  /** How much longer (calm) or shorter (punchy) the helpers' other defaults run. */
  pace: number;
  /** The entrance MB.reveal uses when Scene code names none. */
  reveal: "rise" | "pop" | "fade";
  /** How far MB.emphasize scales an element. */
  emphasis: number;
  /** The frame rate a unit's timeline is quantized to; 0 plays it smoothly. */
  fps: number;
};

/** Character sets the easing family; from the Style Preset spike. */
const CHARACTERS = {
  smooth: { ease: "power3.out", easeInOut: "power2.inOut", settle: "power3.out", duration: 0.5, reveal: "rise", emphasis: 1.08, fps: 0 },
  springy: { ease: "back.out(1.7)", easeInOut: "back.inOut(1.3)", settle: "power3.out", duration: 0.55, reveal: "pop", emphasis: 1.14, fps: 0 },
  snappy: { ease: "expo.out", easeInOut: "expo.inOut", settle: "expo.out", duration: 0.35, reveal: "rise", emphasis: 1.08, fps: 0 },
  // Short entrances, so an element held back by the 12 fps steps still arrives by its word + 0.1 s.
  stepped: { ease: "power2.out", easeInOut: "power2.inOut", settle: "power2.out", duration: 0.3, reveal: "fade", emphasis: 1.08, fps: 12 },
} satisfies Record<Motion["character"], Omit<MotionDefaults, "pace">>;

/** Energy sets how long the helpers take. */
const PACE = { calm: 1.25, balanced: 1, punchy: 0.8 } satisfies Record<Motion["energy"], number>;

export function motionDefaults({ energy, character }: Motion): MotionDefaults {
  const defaults = CHARACTERS[character];
  const pace = PACE[energy];

  return { ...defaults, duration: Math.round(defaults.duration * pace * 1000) / 1000, pace };
}
