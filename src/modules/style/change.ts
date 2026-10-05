import { isDeepStrictEqual } from "node:util";
import type { CaptionStyle, StyleChangeKind, StylePreset } from "../../contract";

/** Whether a video shows Captions before a style change and after it. */
export type CaptionsChange = { before: boolean; after: boolean };

/** The Preset choices Scene code is written for: changing any regenerates every unit. */
const RESTYLE_CHOICES = [
  { choice: "motion", label: "Motion" },
  { choice: "direction", label: "direction" },
  { choice: "treatments", label: "treatments" },
  { choice: "transitions", label: "Transitions" },
  { choice: "canvas", label: "Canvas preference" },
] as const satisfies readonly { choice: keyof StylePreset; label: string }[];

/** How Captions show the current word, as a style change's summary names it. */
const CAPTION_STYLE_LABELS = {
  highlight: "Highlight",
  pop: "Pop",
  plain: "Plain",
} satisfies Record<CaptionStyle, string>;

/**
 * What changing a video's Style Preset snapshot from `current` to `next` costs. Another Preset, or a change to the
 * choices Scene code is written for, is a restyle; Palette, typography, caption style and Captions on or off are
 * drawn by the frame from tokens, so they are a swap. A name alone changes nothing.
 */
export function classifyStyleChange(current: StylePreset, next: StylePreset, captions: CaptionsChange): StyleChangeKind {
  if (next.id !== current.id || restyled(current, next).length > 0) {
    return "restyle";
  }

  if (swapped(current, next, captions).length > 0) {
    return "swap";
  }

  return "none";
}

/** A style change in a line, for its Version: "Palette: Ember, Captions on", or "Restyled to Whiteboard". */
export function describeStyleChange(current: StylePreset, next: StylePreset, captions: CaptionsChange): string {
  if (next.id !== current.id) {
    return `Restyled to ${next.name}`;
  }

  const changed = restyled(current, next);

  if (changed.length > 0) {
    return `Restyled: ${changed.join(", ")}`;
  }

  return swapped(current, next, captions).join(", ");
}

/** The choices Scene code is written for that differ, by name. */
function restyled(current: StylePreset, next: StylePreset): string[] {
  return RESTYLE_CHOICES.filter(({ choice }) => !isSame(current[choice], next[choice])).map(({ label }) => label);
}

/** What a swap changes, each as its Version's summary says it. */
function swapped(current: StylePreset, next: StylePreset, captions: CaptionsChange): string[] {
  return [
    { isChanged: !isSame(current.palette, next.palette), line: `Palette: ${next.palette.name}` },
    { isChanged: !isSame(current.typography, next.typography), line: `Typography: ${next.typography.name}` },
    { isChanged: current.captions !== next.captions, line: `Caption style: ${CAPTION_STYLE_LABELS[next.captions]}` },
    { isChanged: captions.before !== captions.after, line: captionsLine(captions.after) },
  ]
    .filter(({ isChanged }) => isChanged)
    .map(({ line }) => line);
}

function captionsLine(isOn: boolean) {
  if (isOn) {
    return "Captions on";
  }

  return "Captions off";
}

/** Equal as saved: an absent field is the same as an undefined one, and allowed Transitions are a set. */
function isSame(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(saved(a), saved(b));
}

function saved(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.toSorted();
  }

  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}
