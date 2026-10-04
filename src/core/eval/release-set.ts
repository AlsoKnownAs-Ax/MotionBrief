import type { Format } from "../../contract";

/** The bundled Style Presets an eval draws in; Blueprint is the default one. */
export type BundledPresetId = "blueprint" | "whiteboard" | "sketchbook" | "terminal";

export const DEFAULT_PRESET: BundledPresetId = "blueprint";

/**
 * The committed CC0 Voiceovers the maintainer recorded, under `eval/voiceovers/`: a ~60 s explainer for horizontal
 * and a ~30 s Short for vertical, each named after its id with any extension FFmpeg reads (`explainer.wav`). Each
 * Format is generated from its own.
 */
export const VOICEOVERS = {
  horizontal: { id: "explainer", seconds: 60 },
  vertical: { id: "short", seconds: 30 },
} satisfies Record<Format, { id: string; seconds: number }>;

/**
 * The non-default Preset and Format each release adds, one per release in this order and then from the start again,
 * so every Preset gets judged in both Formats over six releases.
 */
export const ROTATION: { preset: Exclude<BundledPresetId, "blueprint">; format: Format }[] = [
  { preset: "whiteboard", format: "vertical" },
  { preset: "sketchbook", format: "horizontal" },
  { preset: "terminal", format: "vertical" },
  { preset: "whiteboard", format: "horizontal" },
  { preset: "sketchbook", format: "vertical" },
  { preset: "terminal", format: "horizontal" },
];

/** A scripted Revision: one scoped to a single Scene (the middle one of the first Version), or one of the whole video. */
export type ScriptedRevision = { scope: "scene" | "whole-video"; message: string };

/** Every video of a release set gets the same two Revisions, so releases compare like with like. */
export const SCRIPTED_REVISIONS: ScriptedRevision[] = [
  { scope: "scene", message: "Make this Scene simpler: fewer elements on screen, and give the most important one more room." },
  { scope: "whole-video", message: "Shorten the on-screen copy everywhere so each label is three words at most." },
];

export type EvalCase = {
  /** Names the case in results and in the replay corpus, such as `explainer-horizontal-blueprint`. */
  id: string;
  voiceover: string;
  format: Format;
  preset: BundledPresetId;
  revisions: ScriptedRevision[];
};

/** A release set: the explainer in 16:9 in the default Preset, plus the rotation's Preset and Format for this release. */
export function releaseSet(rotation: number, voiceoverPath: (id: string) => string): EvalCase[] {
  const rotated = ROTATION.filter((_, index) => index === rotation % ROTATION.length);
  const videos: { preset: BundledPresetId; format: Format }[] = [{ preset: DEFAULT_PRESET, format: "horizontal" }, ...rotated];

  return videos.map(({ preset, format }) => ({
    id: `${VOICEOVERS[format].id}-${format}-${preset}`,
    voiceover: voiceoverPath(VOICEOVERS[format].id),
    format,
    preset,
    revisions: SCRIPTED_REVISIONS,
  }));
}
