import type { ListedPreset, StylePreset } from "../../contract";
import { BLUEPRINT_NAVY, PHOSPHOR, SKETCH_PAPER, WHITEBOARD } from "./palettes";
import { FREDOKA_NUNITO, INTER_JETBRAINS, MANROPE_PLEX, VT323_PLEX } from "./typography";

/**
 * The four bundled Style Presets, accepted from the Style Preset spike's look check. Each holds its
 * own copy of a bundled Palette and font pairing, so a Preset never changes when they do. They are
 * read-only: a creator duplicates one to make their own.
 */
const BUNDLED: readonly StylePreset[] = [
  {
    id: "blueprint",
    name: "Blueprint",
    palette: structuredClone(BLUEPRINT_NAVY),
    typography: structuredClone(INTER_JETBRAINS),
    treatments: {
      surface: "elevated",
      radius: 22,
      background: "dot-grid",
      connector: { style: "straight", weight: 4 },
      line: "clean",
      texture: "none",
      icons: "outline",
    },
    motion: { energy: "balanced", character: "smooth" },
    direction:
      "System-design explainer: clean dark diagrams, icon and label nodes on cards, thin connectors that light up when data flows, one orange highlight for the key thing.",
    transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"],
    canvas: "where-it-helps",
    captions: "highlight",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    palette: structuredClone(WHITEBOARD),
    typography: structuredClone(MANROPE_PLEX),
    treatments: {
      surface: "outlined",
      radius: 14,
      background: "line-grid",
      connector: { style: "curved", weight: 3 },
      line: "clean",
      texture: "none",
      icons: "outline-chip",
    },
    motion: { energy: "calm", character: "smooth" },
    direction:
      "Clean whiteboard explainer: dark ink on white, lots of whitespace, thin outlined boxes, one blue highlight. Calm and precise, like a senior engineer drawing on a board.",
    transitions: ["crossfade", "push", "carry-over", "camera"],
    canvas: "whenever-possible",
    captions: "plain",
  },
  {
    id: "sketchbook",
    name: "Sketchbook",
    palette: structuredClone(SKETCH_PAPER),
    typography: structuredClone(FREDOKA_NUNITO),
    treatments: {
      surface: "outlined",
      radius: 20,
      background: "solid",
      connector: { style: "curved", weight: 5 },
      line: "sketchy",
      texture: "paper",
      icons: "filled-chip",
    },
    motion: { energy: "punchy", character: "springy" },
    direction:
      "Cartoon sketchbook: bold dark hand-drawn outlines, flat bright fills, a comic-panel feel, playful and friendly. Things pop in with a little bounce.",
    transitions: ["cut", "push", "zoom-through", "camera"],
    canvas: "where-it-helps",
    captions: "pop",
  },
  {
    id: "terminal",
    name: "Terminal",
    palette: structuredClone(PHOSPHOR),
    typography: structuredClone(VT323_PLEX),
    treatments: {
      surface: "outlined",
      radius: 0,
      background: "solid",
      connector: { style: "straight", weight: 3 },
      line: "clean",
      texture: "scanlines",
      icons: "outline",
    },
    motion: { energy: "balanced", character: "stepped" },
    direction:
      "Old-school terminal: green phosphor text on black, boxes drawn like text-mode windows with square corners, a blinking-cursor feel, amber for the key thing. Things snap on rather than glide.",
    transitions: ["cut", "crossfade"],
    canvas: "never",
    captions: "plain",
  },
];

/** The Style Presets to choose from, Blueprint (the default) first; each a copy, so no caller can change a bundled one. */
export function listPresets(): ListedPreset[] {
  return BUNDLED.map((preset) => ({ ...structuredClone(preset), readOnly: true }));
}

/** A copy of the bundled Preset with this id. */
export function bundledPreset(id: "blueprint" | "whiteboard" | "sketchbook" | "terminal"): StylePreset {
  const preset = BUNDLED.find((candidate) => candidate.id === id);

  if (!preset) {
    throw new Error(`No bundled Style Preset ${id}`);
  }

  return structuredClone(preset);
}
