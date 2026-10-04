import { AccentRoleSchema, type ContrastFinding, type Palette, type PaletteRole } from "../../contract";

/** WCAG AA for text. */
const TEXT_MINIMUM = 4.5;

/** WCAG AA for large text and graphics: what an accent drawn as text, icons or lines needs. */
const ACCENT_MINIMUM = 3;

/** Below this a fill barely stands out from bg. */
const FILL_MINIMUM = 1.5;

/** Below this outlines and connectors barely show. Bundled line colors are deliberately quiet (1.4–1.8:1). */
const LINE_MINIMUM = 1.3;

const TEXT_ROLES = ["ink", "muted"] as const;

const GROUNDS = ["bg", "surface"] as const;

/**
 * The Preset editor's contrast rule. Text must reach WCAG AA on bg and surface, and an accent drawn as text or
 * lines 3:1. An accent the Palette keeps to fills only needs ink on it to reach AA, and to stand out from bg:
 * that is how Sketchbook's mustard accent3 passes at 1.8:1 on its paper.
 */
export function checkContrast({ colors, fills = [] }: Palette): ContrastFinding[] {
  const finding = (level: ContrastFinding["level"], use: ContrastFinding["use"], role: PaletteRole, against: PaletteRole, minimum: number) => {
    const ratio = round(contrastRatio(colors[role], colors[against]));

    return ratio < minimum ? [{ level, use, role, against, ratio, minimum }] : [];
  };

  const text = TEXT_ROLES.flatMap((role) => GROUNDS.flatMap((ground) => finding("block", "text", role, ground, TEXT_MINIMUM)));
  const accents = AccentRoleSchema.options.flatMap((role) => {
    if (fills.includes(role)) {
      return [...finding("block", "text", "ink", role, TEXT_MINIMUM), ...finding("warn", "fill", role, "bg", FILL_MINIMUM)];
    }

    return GROUNDS.flatMap((ground) => finding("block", "accent", role, ground, ACCENT_MINIMUM));
  });
  const lines = GROUNDS.flatMap((ground) => finding("warn", "line", "line", ground, LINE_MINIMUM));

  return [...text, ...accents, ...lines];
}

/** The WCAG contrast ratio of two six-digit hex colors, from 1 to 21. */
function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];

  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map(linear) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linear(channel: number): number {
  const c = channel / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Ratios are shown to two decimals, so they are compared that way: 2.998:1 shows, and passes, as 3.00:1. */
function round(ratio: number): number {
  return Math.round(ratio * 100) / 100;
}
