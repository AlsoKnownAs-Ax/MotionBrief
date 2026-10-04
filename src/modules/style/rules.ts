import type { Format, Motion, StoryboardRules, StylePreset } from "../../contract";

/** The video a Storyboard is planned for: its Format, and whether Captions are on. */
export type VideoOptions = { format: Format; captions: boolean };

/** What the Storyboard validator checks a Storyboard against: the video's Format and Captions, and the Preset's Transitions and Canvas preference. */
export function storyboardRules({ transitions, canvas }: Pick<StylePreset, "transitions" | "canvas">, { format, captions }: VideoOptions): StoryboardRules {
  return { format, captions, transitions: [...transitions], canvas };
}

/** Scene lengths in seconds: the Format's hard range, which the validator enforces, and the narrower range Motion energy aims for. */
export type Pacing = { min: number; max: number; target: [number, number] };

const FORMAT_PACING = {
  horizontal: { min: 3, max: 10 },
  vertical: { min: 2.5, max: 7 },
} satisfies Record<Format, Omit<Pacing, "target">>;

/** Calm videos hold each Scene longer; punchy ones cut sooner. From the Style Preset spike. */
const ENERGY_TARGET = {
  horizontal: { calm: [5, 10], balanced: [3, 8], punchy: [3, 6] },
  vertical: { calm: [3.5, 7], balanced: [2.5, 6], punchy: [2.5, 5] },
} satisfies Record<Format, Record<Motion["energy"], [number, number]>>;

/** The Scene lengths a Storyboard aims for in a Format at a Motion energy. */
export function pacingFor(format: Format, energy: Motion["energy"]): Pacing {
  const [low, high] = ENERGY_TARGET[format][energy];

  return { ...FORMAT_PACING[format], target: [low, high] };
}
