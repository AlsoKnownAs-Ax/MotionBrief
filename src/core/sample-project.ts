import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { StoryboardRules, UnitCode } from "../contract";
import type { SampleProject } from "../modules/core-api";
import { bundledPreset } from "../modules/style";

/** A Blueprint-like horizontal video: every Transition allowed, Canvases where they help, no Captions. */
const RULES: StoryboardRules = {
  format: "horizontal",
  captions: false,
  transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"],
  canvas: "where-it-helps",
};

/**
 * The fixture Project a development build opens from Home: the horizontal fixture Storyboard and
 * Transcript, hand-written Scene code for some units (`editor/<unit>.{css,html,js}`) and fallback
 * Scenes for the rest. Read from the source tree, so it never ships. Goes once Projects open from disk.
 */
export function sampleProject(fixturesDir: string): SampleProject {
  return {
    id: "fixture-project",
    name: "Fixture Project",
    source: async () => ({
      storyboard: await readJson(join(fixturesDir, "storyboard", "horizontal.json")),
      transcript: await readJson(join(fixturesDir, "storyboard", "transcript.json")),
      rules: RULES,
      preset: bundledPreset("blueprint"),
      code: await readUnits(join(fixturesDir, "editor")),
    }),
  };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readUnits(dir: string): Promise<Record<string, UnitCode>> {
  const units = [...new Set((await readdir(dir)).map((file) => basename(file, extname(file))))].sort();
  const read = (unit: string, part: string) => readFile(join(dir, `${unit}.${part}`), "utf8");

  return Object.fromEntries(
    await Promise.all(units.map(async (unit) => [unit, { css: await read(unit, "css"), html: await read(unit, "html"), js: await read(unit, "js") }] as const)),
  );
}
