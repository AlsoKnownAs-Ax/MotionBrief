import { ORPCError } from "@orpc/client";
import type { CanvasPreference, CaptionStyle, ContrastFinding, Motion, PaletteRole, PresetTransition, Treatments, Typography } from "../../../contract";

export type Option<T extends string> = { value: T; label: string };

export const ROLE_LABELS = {
  bg: "Background",
  bg2: "Background 2",
  surface: "Surface",
  surface2: "Surface 2",
  line: "Lines",
  ink: "Text",
  muted: "Muted text",
  accent: "Accent",
  accent2: "Accent 2",
  accent3: "Accent 3",
  good: "Positive",
  bad: "Negative",
} satisfies Record<PaletteRole, string>;

export const FACE_LABELS = { display: "Display", body: "Body", label: "Labels", mono: "Code" } satisfies Record<keyof Omit<Typography, "name">, string>;

export const SURFACE_OPTIONS: Option<Treatments["surface"]>[] = [
  { value: "flat", label: "Flat" },
  { value: "outlined", label: "Outlined" },
  { value: "elevated", label: "Elevated" },
];

export const BACKGROUND_OPTIONS: Option<Treatments["background"]>[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
  { value: "dot-grid", label: "Dot grid" },
  { value: "line-grid", label: "Line grid" },
];

export const CONNECTOR_OPTIONS: Option<Treatments["connector"]["style"]>[] = [
  { value: "straight", label: "Straight" },
  { value: "curved", label: "Curved" },
];

export const LINE_OPTIONS: Option<Treatments["line"]>[] = [
  { value: "clean", label: "Clean" },
  { value: "sketchy", label: "Hand-drawn" },
];

export const TEXTURE_OPTIONS: Option<Treatments["texture"]>[] = [
  { value: "none", label: "None" },
  { value: "paper", label: "Paper" },
  { value: "film-grain", label: "Film grain" },
  { value: "scanlines", label: "Scanlines" },
];

export const ICON_OPTIONS: Option<Treatments["icons"]>[] = [
  { value: "outline", label: "Outline" },
  { value: "outline-chip", label: "Outline chip" },
  { value: "filled-chip", label: "Filled chip" },
];

export const ENERGY_OPTIONS: Option<Motion["energy"]>[] = [
  { value: "calm", label: "Calm" },
  { value: "balanced", label: "Balanced" },
  { value: "punchy", label: "Punchy" },
];

export const CHARACTER_OPTIONS: Option<Motion["character"]>[] = [
  { value: "smooth", label: "Smooth" },
  { value: "springy", label: "Springy" },
  { value: "snappy", label: "Snappy" },
  { value: "stepped", label: "Stepped" },
];

export const TRANSITION_OPTIONS: Option<PresetTransition>[] = [
  { value: "cut", label: "Cut" },
  { value: "crossfade", label: "Crossfade" },
  { value: "push", label: "Push" },
  { value: "zoom-through", label: "Zoom through" },
  { value: "carry-over", label: "Carry-over" },
  { value: "camera", label: "Camera move" },
];

export const CANVAS_OPTIONS: Option<CanvasPreference>[] = [
  { value: "never", label: "Never" },
  { value: "where-it-helps", label: "Where it helps" },
  { value: "whenever-possible", label: "Whenever possible" },
];

export const CAPTION_OPTIONS: Option<CaptionStyle>[] = [
  { value: "highlight", label: "Highlight the word" },
  { value: "pop", label: "Pop the word" },
  { value: "plain", label: "Plain" },
];

/** What a contrast finding means, in a sentence the creator can act on. */
export function findingMessage({ use, role, against, ratio, minimum }: ContrastFinding): string {
  const measured = `${ratio.toFixed(2)}:1, needs ${minimum}:1`;

  if (use === "text" && role === "ink") {
    return `Text on ${ROLE_LABELS[against]} is hard to read (${measured}).`;
  }

  if (use === "text") {
    return `${ROLE_LABELS[role]} on ${ROLE_LABELS[against]} is hard to read (${measured}).`;
  }

  if (use === "accent") {
    return `${ROLE_LABELS[role]} is too close to ${ROLE_LABELS[against]} for text and lines (${measured}). Make it fill only, or change it.`;
  }

  if (use === "fill") {
    return `${ROLE_LABELS[role]} barely stands out from the background (${measured}).`;
  }

  return `Outlines and connectors barely show on ${ROLE_LABELS[against]} (${measured}).`;
}

type PresetErrorData = { path?: string; message?: string; family?: string; weight?: number; weights?: number[] };

const SAVE_MESSAGES = {
  LOW_CONTRAST: () => "The contrast rule blocks this Palette. Fix the colors listed above.",
  UNBUNDLED_WEIGHT: ({ family, weight, weights }) => `${family ?? "This font"} doesn't come in weight ${weight ?? ""}. Pick ${weights?.join(", ") ?? "another"}.`,
  READ_ONLY: () => "The bundled Style Presets can't change. Duplicate one to make your own.",
  UNKNOWN_PRESET: () => "This Style Preset was deleted.",
  FILE_FAILED: ({ path, message }) => `Couldn't save to ${path ?? "the app data folder"}: ${message ?? "the file system refused"}.`,
} satisfies Record<string, (data: PresetErrorData) => string>;

export function presetErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in SAVE_MESSAGES) {
    return SAVE_MESSAGES[error.code as keyof typeof SAVE_MESSAGES]((error.data ?? {}) as PresetErrorData);
  }

  return "Something went wrong talking to the MotionBrief core. Try again.";
}
