import type { CanvasPreference, Format, Motion, StylePreset, Treatments } from "../../contract";
import { transitionTypesFor, type TransitionType } from "../storyboard";
import { pacingFor } from "./rules";

/** The part of each agent role's prompt that comes from the Style Preset. */
export type PresetBrief = { storyboard: string; sceneCode: string; review: string };

/**
 * What the Storyboard, Scene-code and review agents are told about the video's Style Preset in one
 * Format: every role gets the direction, the allowed Transitions and the Canvas preference, plus
 * what its own job needs (pacing to plan with, Motion and treatments to write and judge against).
 */
export function presetBrief(preset: StylePreset, format: Format): PresetBrief {
  const shared = [
    `Style Preset: ${preset.name} (${preset.palette.mode} Palette).`,
    `Direction: ${preset.direction}`,
    transitionsLine(preset),
    CANVAS_LINE[preset.canvas],
  ];
  const { min, max, target } = pacingFor(format, preset.motion.energy);

  return {
    storyboard: [
      ...shared,
      `Pacing: ${preset.motion.energy} Motion, so aim for Scenes of ${range(target)} (a ${format} Scene must last ${range([min, max])}).`,
    ].join("\n"),
    sceneCode: [...shared, motionLine(preset.motion), treatmentsLine(preset.treatments)].join("\n"),
    review: [
      ...shared,
      motionLine(preset.motion),
      treatmentsLine(preset.treatments),
      "Judge each still against this direction: a Scene that reads well but ignores it still needs a note.",
    ].join("\n"),
  };
}

const TRANSITION_NOTES: Partial<Record<TransitionType, string>> = {
  camera: "only between Scenes on the same Canvas",
  "carry-over": "names an element both Scenes have, which morphs from one into the next",
};

function transitionsLine({ transitions }: StylePreset): string {
  const allowed = transitionTypesFor(transitions).map((type) => {
    const note = TRANSITION_NOTES[type];

    return note ? `"${type}" (${note})` : `"${type}"`;
  });

  return `Transitions: use only ${allowed.join(", ")}. The Assembler draws them; Scene code never does.`;
}

const CANVAS_LINE = {
  never: "Canvas: never. Every Scene stands alone.",
  "where-it-helps": "Canvas: where it helps. Put consecutive Scenes on one Canvas when they build one picture together.",
  "whenever-possible":
    "Canvas: whenever possible. Put runs of consecutive Scenes on one Canvas, so the video reads as one big board; stand a Scene alone only when it can't join one.",
} satisfies Record<CanvasPreference, string>;

const CHARACTER_RULES = {
  smooth: "Smooth: long-tail ease-outs. No bounce, no elastic, no back easing.",
  springy:
    "Springy: entrances overshoot a little and settle, and pops and scale-ins are welcome. The MB helpers' default ease is already springy and never overshoots wipes, blurs or draw-ons. No elastic wobble loops, no repeat or yoyo.",
  snappy: "Snappy: short, decisive moves. No bounce, no slow fades.",
  stepped:
    "Stepped: the frame plays each unit at 12 fps, like a retro screen. Prefer things that snap on: fades, wipes, typing (MB.type). Avoid long glides and big scale moves; keep durations short (0.2–0.4 s).",
} satisfies Record<Motion["character"], string>;

const ENERGY_RULES = {
  calm: "Calm energy: unhurried, few moves at once.",
  balanced: "Balanced energy.",
  punchy: "Punchy energy: quick entrances and frequent emphasis.",
} satisfies Record<Motion["energy"], string>;

function motionLine({ energy, character }: Motion): string {
  return `Motion: ${CHARACTER_RULES[character]} ${ENERGY_RULES[energy]} The MB helpers' defaults already follow it.`;
}

const SURFACES = { flat: "flat", outlined: "outlined", elevated: "elevated" } satisfies Record<Treatments["surface"], string>;

const ICONS = {
  outline: "outline icons",
  "outline-chip": "outline icons in chips",
  "filled-chip": "icons in filled chips",
} satisfies Record<Treatments["icons"], string>;

function treatmentsLine({ surface, radius, connector, line, texture, icons }: Treatments): string {
  const parts = [
    `${SURFACES[surface]} cards (.mb-card) with ${radius} px corners`,
    `${connector.style} connectors`,
    ICONS[icons],
    line === "sketchy" ? "hand-drawn outlines" : "clean lines",
    texture === "none" ? "no texture" : `a ${texture.replace("-", " ")} texture`,
  ];

  return `Treatments, all drawn by the frame (never restyle them): ${parts.join(", ")}.`;
}

function range([low, high]: [number, number]): string {
  return `${low}–${high} s`;
}
