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
    sceneCode: [...shared, motionLine(preset.motion), treatmentsLine(preset.treatments), ...fillsLine(preset)].join("\n"),
    review: [
      ...shared,
      motionLine(preset.motion),
      treatmentsLine(preset.treatments),
      ...fillsLine(preset),
      "Judge each still against this direction: a Scene that reads well but ignores it still needs a note.",
    ].join("\n"),
  };
}

/** Accents the Palette keeps to fills are too faint on bg to be read, so they carry ink rather than being it. */
function fillsLine({ palette: { fills = [] } }: StylePreset): string[] {
  if (fills.length === 0) {
    return [];
  }

  const roles = fills.map((role) => `var(--${role})`).join(" and ");
  const [fill, it] = fillWords(fills.length);

  return [`Palette: use ${roles} only as ${fill} behind var(--ink) text, never as text, icons or lines; ${it} too faint on the background to read.`];
}

function fillWords(count: number): [string, string] {
  if (count === 1) {
    return ["a fill", "it is"];
  }

  return ["fills", "they are"];
}

const TRANSITION_NOTES: Partial<Record<TransitionType, string>> = {
  camera: "only between Scenes on the same Canvas",
  "carry-over": "names an element both Scenes have, which morphs from one into the next",
};

function transitionsLine({ transitions }: StylePreset): string {
  const allowed = transitionTypesFor(transitions).map((type) => {
    const note = TRANSITION_NOTES[type];

    if (!note) {
      return `"${type}"`;
    }

    return `"${type}" (${note})`;
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
    LINES[line],
    textureWords(texture),
  ];

  return `Treatments, all drawn by the frame (never restyle them): ${parts.join(", ")}.`;
}

const LINES = { sketchy: "hand-drawn outlines", clean: "clean lines" } satisfies Record<Treatments["line"], string>;

function textureWords(texture: Treatments["texture"]) {
  if (texture === "none") {
    return "no texture";
  }

  return `a ${texture.replace("-", " ")} texture`;
}

function range([low, high]: [number, number]): string {
  return `${low}–${high} s`;
}
