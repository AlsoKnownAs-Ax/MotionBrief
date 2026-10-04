import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Format, StoryboardTranscript, StylePreset } from "../../contract";
import { fallbackCode, FRAME_SIZES, framePage, inlineIcons, wrapUnit, type PageAsset, type UnitCode } from "../frame";
import type { Storyboard } from "../storyboard";
import { planUnits, type Unit } from "./units";

export type AssembleOptions = {
  /** An empty folder the page is written into. */
  dir: string;
  storyboard: Storyboard;
  transcript: StoryboardTranscript;
  /** The video's Style Preset snapshot. */
  preset: StylePreset;
  /** Scene code per unit id. A unit without code is drawn as its fallback Scene. */
  code: Record<string, UnitCode>;
};

export type AssembledPage = {
  format: Format;
  width: number;
  height: number;
  duration: number;
  units: Unit[];
};

/**
 * Builds the root composition from a Storyboard, its Transcript and the units' code: one
 * sub-composition per unit, in Storyboard order and timed from the word anchors, cut together.
 */
export async function assemble({ dir, storyboard, transcript, preset, code }: AssembleOptions): Promise<AssembledPage> {
  const format = storyboard.format;
  const { width, height } = FRAME_SIZES[format];
  const units = planUnits(storyboard, transcript);
  const duration = transcript.duration;
  const page = await framePage({ format, units, style: preset });

  await mkdir(join(dir, "compositions"), { recursive: true });
  await Promise.all(page.assets.map((asset) => writeAsset(dir, asset)));
  await Promise.all(
    units.map(async (unit) => {
      const unitCode = code[unit.id] ?? fallbackCode(unit.scenes, unit);
      const { html } = await inlineIcons(unitCode.html, preset.treatments.icons);

      await writeFile(join(dir, "compositions", `${unit.id}.html`), wrapUnit({ unit, format, style: preset, code: { ...unitCode, html } }));
    }),
  );
  await writeFile(join(dir, "index.html"), rootHtml({ width, height, duration, units, page, background: preset.palette.colors.bg }));

  return { format, width, height, duration, units };
}

async function writeAsset(dir: string, { path, from, content }: PageAsset) {
  const target = join(dir, path);
  await mkdir(dirname(target), { recursive: true });

  if (from) {
    await copyFile(from, target);
    return;
  }

  await writeFile(target, content ?? "");
}

type RootOptions = {
  width: number;
  height: number;
  duration: number;
  units: Unit[];
  /** What the frame puts in the head, before the root composition and at its end. */
  page: { head: string; defs: string; overlay: string };
  background: string;
};

function rootHtml({ width, height, duration, units, page, background }: RootOptions): string {
  const clips = units.map(
    (unit, index) =>
      `<div id="el-${unit.id}" class="scene" data-composition-id="${unit.id}" data-composition-src="compositions/${unit.id}.html" data-start="${unit.start}" data-duration="${unit.duration}" data-track-index="${1 + (index % 2)}"></div>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
${page.head}
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
#root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
.scene { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
${page.defs}
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
${[...clips, page.overlay].filter(Boolean).join("\n")}
</div>
<script>
window.__timelines["main"] = gsap.timeline({ paused: true });
window.__timelines["main"].to({}, { duration: ${duration} }, 0);
</script>
</body>
</html>
`;
}
