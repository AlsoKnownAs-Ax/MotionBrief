import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StoryboardRulesSchema, StoryboardTranscriptSchema, type UnitCode } from "../contract";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { bundledPreset } from "../modules/style";
import { BROWSER_TIMEOUT_MS, connect } from "./test-support/checker";

const FIXTURES = join(import.meta.dirname, "fixtures");

/**
 * The tier-2 replay corpus: committed agent outputs and hand-written fixtures, each recording the frame contract its
 * units were written against. Paths are relative to `fixtures/`; a unit's path names its `.css`, `.html` and `.js`.
 */
const CorpusEntrySchema = z.object({
  description: z.string(),
  frameContractVersion: z.string(),
  preset: z.enum(["blueprint", "whiteboard", "sketchbook", "terminal"]),
  rules: StoryboardRulesSchema,
  storyboard: z.string(),
  transcript: z.string(),
  units: z.record(z.string(), z.string()),
});

const names = (await readdir(join(FIXTURES, "corpus"))).filter((name) => name.endsWith(".json"));
const entries = await Promise.all(
  names.map(async (name) => ({ name, entry: CorpusEntrySchema.parse(JSON.parse(await readFile(join(FIXTURES, "corpus", name), "utf8"))) })),
);

function major(version: string) {
  return version.split(".")[0];
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, path), "utf8"));
}

async function unitCode(path: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(FIXTURES, `${path}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/**
 * Frame minor and patch releases must keep old units passing lint, check and the contract (ADR 0004): every unit
 * written against this frame major still passes. Units from older majors are re-checked when their Project opens.
 */
describe("the replay corpus", () => {
  it("has entries written against this frame major", () => {
    expect(entries.filter(({ entry }) => major(entry.frameContractVersion) === major(FRAME_CONTRACT_VERSION))).not.toEqual([]);
  });

  describe.each(entries.filter(({ entry }) => major(entry.frameContractVersion) === major(FRAME_CONTRACT_VERSION)))("$name", ({ entry }) => {
    it(
      "still passes every check in this frame",
      async () => {
        const code = Object.fromEntries(await Promise.all(Object.entries(entry.units).map(async ([unit, path]) => [unit, await unitCode(path)] as const)));
        const report = await connect().checker.check({
          storyboard: await json(entry.storyboard),
          transcript: StoryboardTranscriptSchema.parse(await json(entry.transcript)),
          rules: entry.rules,
          preset: bundledPreset(entry.preset),
          code,
        });

        expect(report.findings).toEqual([]);
      },
      BROWSER_TIMEOUT_MS,
    );
  });
});
