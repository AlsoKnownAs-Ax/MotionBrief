import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Format, StoryboardTranscript, UnitCode } from "../contract";
import { sceneTimings, type Storyboard } from "../modules/storyboard";
import { bundledPreset } from "../modules/style";
import { corpusEntries, loadCorpus, PRESETS } from "./test-support/corpus";
import { closeFrame, openFrame } from "./test-support/frame";

/** Where the sheet is written; CI attaches this folder to the run. */
const OUT_DIR = join(import.meta.dirname, "..", "..", "out", "contact-sheet");

/** The hand-written corpus runs that hold a sample of every Scene Type, one per Format. */
const SAMPLES = { horizontal: "scene-types-horizontal.json", vertical: "scene-types-vertical.json" } satisfies Record<Format, string>;

/** Stills at this fraction of the frame: 480 × 270 in 16:9, 270 × 480 in 9:16. */
const STILL_SCALE = 0.25;

/** How long before a Scene's end its still is taken: every element is in, and no outgoing Transition has begun. */
const BEFORE_END_SECONDS = 0.6;

const FORMATS = ["horizontal", "vertical"] as const;

/** Captions as a new video of each Format has them: on in vertical, off in horizontal. */
const CAPTIONS = { horizontal: false, vertical: true } satisfies Record<Format, boolean>;

type Sample = { storyboard: Storyboard; transcript: StoryboardTranscript; code: Record<string, UnitCode> };

type Still = { format: Format; preset: (typeof PRESETS)[number]; sceneId: string; sceneType: string; file: string; errors: string[] };

/**
 * The visual-regression contact sheet (spec #23): each Scene Type's sample × the 4 bundled Presets × 2 Formats, as
 * stills in an HTML page for a human to eyeball on PRs that touch the frame or Presets. No pixel gates: it fails only
 * when a sample can't be drawn at all. Run with `pnpm contact-sheet`; never part of `pnpm test`.
 */
describe("the contact sheet", () => {
  it("draws every Scene Type sample in every Preset and Format", async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });
    const entries = await corpusEntries();
    const stills: Still[] = [];

    for (const format of FORMATS) {
      const sample = entries.find(({ name }) => name === SAMPLES[format]);

      expect(sample, `${SAMPLES[format]} is missing from the corpus`).toBeDefined();
      const { storyboard, transcript, code } = await loadCorpus(sample!.entry);
      // Hand-written samples the replay corpus test validates and checks.
      const video = { storyboard: storyboard as Storyboard, transcript, code };

      for (const preset of PRESETS) {
        stills.push(...(await drawStills(video, format, preset)));
      }
    }

    await writeFile(join(OUT_DIR, "index.html"), sheetHtml(stills));

    expect(stills).toHaveLength(FORMATS.length * PRESETS.length * new Set(stills.map(({ sceneId }) => sceneId)).size);
  }, 900_000);
});

/** One page per Format and Preset: a still of each Scene just before it ends. */
async function drawStills(video: Sample, format: Format, preset: (typeof PRESETS)[number]): Promise<Still[]> {
  const frame = await openFrame(video.storyboard, video.transcript, video.code, bundledPreset(preset), { captions: CAPTIONS[format], scale: STILL_SCALE });

  try {
    const stills: Still[] = [];

    for (const { scene, end } of sceneTimings(video.storyboard, video.transcript)) {
      await frame.page.seek(Math.max(0, end - BEFORE_END_SECONDS));
      const file = `${format}-${preset}-${scene.id}.jpg`;
      await writeFile(join(OUT_DIR, file), await frame.page.screenshot());
      stills.push({ format, preset, sceneId: scene.id, sceneType: scene.type, file, errors: [...frame.page.errors] });
    }

    return stills;
  } finally {
    await closeFrame(frame);
  }
}

/** A table: a row per Scene, a column per Format and Preset. Page errors show under their still. */
function sheetHtml(stills: Still[]): string {
  const scenes = [...new Map(stills.map(({ sceneId, sceneType }) => [sceneId, sceneType])).entries()];
  const columns = FORMATS.flatMap((format) => PRESETS.map((preset) => ({ format, preset })));
  const header = columns.map(({ format, preset }) => `<th>${preset}<br><small>${format}</small></th>`).join("");
  const rows = scenes.map(([sceneId, sceneType]) => {
    const cells = columns.map(({ format, preset }) => {
      const still = stills.find((candidate) => candidate.sceneId === sceneId && candidate.format === format && candidate.preset === preset);

      return `<td>${stillHtml(still)}</td>`;
    });

    return `<tr><th>${sceneType}<br><small>${sceneId}</small></th>${cells.join("")}</tr>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MotionBrief contact sheet</title>
<style>
body { margin: 24px; font: 14px/1.4 system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
table { border-collapse: collapse; }
th, td { padding: 6px; vertical-align: top; text-align: left; }
thead th { position: sticky; top: 0; background: #f4f4f5; }
img { display: block; max-width: 270px; max-height: 270px; border: 1px solid #d4d4d8; }
small { color: #71717a; font-weight: normal; }
.errors { max-width: 270px; color: #b91c1c; font-size: 12px; }
</style>
</head>
<body>
<h1>Contact sheet</h1>
<p>Each Scene Type sample in every bundled Preset and Format, just before the Scene ends. No pixel gates: look for anything that reads wrong.</p>
<table>
<thead><tr><th>Scene</th>${header}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</body>
</html>
`;
}

function stillHtml(still: Still | undefined): string {
  if (!still) {
    return "";
  }

  const errors = still.errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");

  return `<img src="${still.file}" alt="${still.sceneType} in ${still.preset}, ${still.format}" loading="lazy"><div class="errors">${errors}</div>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ENTITIES[char as keyof typeof ENTITIES]);
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
