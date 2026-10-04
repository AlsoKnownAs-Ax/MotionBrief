import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Format, StylePreset, UnitCode } from "../../contract";
import type { Storyboard } from "../../modules/storyboard";
import storyboardJson from "../fixtures/checker/storyboard.json";

const DEMO_DIR = join(import.meta.dirname, "..", "fixtures", "look-check");

/**
 * The look check's demo: an architecture diagram, a Transition, then a stat, with icons, cards,
 * connectors and every kind of entrance, in hand-written token-only Scene code. Each Format has its
 * own layout CSS; the markup and script are shared.
 */
export async function lookCheckCode(format: Format): Promise<Record<string, UnitCode>> {
  const units = await Promise.all(
    ["s01", "s02"].map(async (unit) => {
      const [css, html, js] = await Promise.all(
        [`${unit}.${format}.css`, `${unit}.html`, `${unit}.js`].map((file) => readFile(join(DEMO_DIR, file), "utf8")),
      );

      return [unit, { css: css ?? "", html: html ?? "", js: js ?? "" }] as const;
    }),
  );

  return Object.fromEntries(units);
}

/** The demo's Storyboard in a Format, moving to the stat with a Transition the Preset allows. */
export function lookCheckStoryboard(preset: StylePreset, format: Format): Storyboard {
  const storyboard = storyboardJson as Storyboard;
  const [diagram, stat] = storyboard.scenes as [Storyboard["scenes"][number], Storyboard["scenes"][number]];

  return { format, scenes: [{ ...diagram, transition: { type: transitionInto(preset) } }, stat] };
}

/** A Transition between two lone Scenes: push when the Preset allows it, else its first other choice. */
function transitionInto({ transitions }: StylePreset) {
  if (transitions.includes("push")) {
    return "push-left" as const;
  }

  const standalone = transitions.find((transition) => transition === "cut" || transition === "crossfade" || transition === "zoom-through");

  if (!standalone) {
    throw new Error("The Preset allows no Transition between two lone Scenes");
  }

  return standalone;
}
