import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StoryboardRulesSchema, StoryboardTranscriptSchema, type StoryboardIssue, type StoryboardRules, type StoryboardTranscript, type UnitCode } from "../../contract";
import { planUnits } from "../../modules/assembler";
import { applyPatch, PatchSchema } from "../../modules/revision";
import { validateStoryboard, type Storyboard } from "../../modules/storyboard";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const CORPUS = join(FIXTURES, "corpus");

/** The four bundled Style Presets: a Palette/typography swap replays a video in each. */
export const PRESETS = ["blueprint", "whiteboard", "sketchbook", "terminal"] as const;

/**
 * One run of the tier-2 replay corpus, in `fixtures/corpus/<name>.json`: a paid eval's committed agent outputs or a
 * hand-written video. The Storyboard, Transcript JSON, each unit's Scene code and each Revision's patch are paths
 * relative to `fixtures/`; a unit's path names its `.css`, `.html` and `.js`. No audio: the Transcript stands in for
 * the Voiceover. `frameContractVersion` is the frame the units were written against.
 */
const CorpusEntrySchema = z.object({
  description: z.string(),
  frameContractVersion: z.string(),
  preset: z.enum(PRESETS),
  rules: StoryboardRulesSchema,
  storyboard: z.string(),
  transcript: z.string(),
  units: z.record(z.string(), z.string()),
  /** Revisions in the order they were made: the agent's patch and the Scene code of each unit it regenerated. */
  revisions: z.array(z.object({ patch: z.string(), units: z.record(z.string(), z.string()) })).default([]),
});

export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

/** A video of the corpus at one point of its run: as first generated, or after a Revision. */
export type Replayed = {
  /** `generation`, or `revision <n>` counting from 1. */
  step: string;
  storyboard: Storyboard;
  transcript: StoryboardTranscript;
  rules: StoryboardRules;
  code: Record<string, UnitCode>;
};

export type ReplayError =
  | { code: "INVALID_STORYBOARD"; step: string; issues: StoryboardIssue[] }
  | { code: "INVALID_PATCH"; step: string; message: string }
  | { code: "MISSING_UNIT"; step: string; unit: string };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** Every corpus entry, by file name. A malformed entry throws: the corpus is committed, so that's a broken commit. */
export async function corpusEntries(): Promise<{ name: string; entry: CorpusEntry }[]> {
  const names = (await readdir(CORPUS)).filter((name) => name.endsWith(".json"));

  return Promise.all(names.map(async (name) => ({ name, entry: CorpusEntrySchema.parse(await json(join("corpus", name))) })));
}

export function frameMajor(version: string) {
  return version.split(".")[0];
}

/**
 * Replays an entry's run: its first Storyboard and units, then each Revision's patch applied the way the Revision
 * module applies it, with the regenerated units replacing their previous code. Each step's Storyboard is validated
 * against the Transcript and rules, and every unit it plans must have Scene code.
 */
export async function replay(entry: CorpusEntry): Promise<Result<Replayed[], ReplayError>> {
  const transcript = StoryboardTranscriptSchema.parse(await json(entry.transcript));
  const { data: first, error } = await step("generation", await json(entry.storyboard), transcript, entry.rules, await codeOf(entry.units));

  if (error) {
    return { data: null, error };
  }

  const steps = [first];

  for (const [index, revision] of entry.revisions.entries()) {
    const label = `revision ${index + 1}`;
    const previous = steps[steps.length - 1] ?? first;
    const { success, data: patch, error: patchError } = z.object(PatchSchema).safeParse(await json(revision.patch));

    if (!success) {
      return { data: null, error: { code: "INVALID_PATCH", step: label, message: patchError.message } };
    }

    const rules = { ...previous.rules, captions: patch.captions ?? previous.rules.captions };
    const code = { ...previous.code, ...(await codeOf(revision.units)) };
    const { data: next, error: stepError } = await step(label, applyPatch(previous.storyboard, patch), transcript, rules, code);

    if (stepError) {
      return { data: null, error: stepError };
    }

    steps.push(next);
  }

  return { data: steps, error: null };
}

async function step(
  label: string,
  raw: unknown,
  transcript: StoryboardTranscript,
  rules: StoryboardRules,
  code: Record<string, UnitCode>,
): Promise<Result<Replayed, ReplayError>> {
  const { data: storyboard, error } = validateStoryboard(raw, transcript, rules);

  if (error) {
    return { data: null, error: { code: "INVALID_STORYBOARD", step: label, issues: error.issues } };
  }

  const units = planUnits(storyboard, transcript).map(({ id }) => id);
  const missing = units.find((unit) => !code[unit]);

  if (missing) {
    return { data: null, error: { code: "MISSING_UNIT", step: label, unit: missing } };
  }

  // A unit a Revision dropped (a Canvas taken apart) is no longer part of the video.
  const kept = Object.fromEntries(Object.entries(code).filter(([unit]) => units.includes(unit)));

  return { data: { step: label, storyboard, transcript, rules, code: kept }, error: null };
}

async function codeOf(units: Record<string, string>): Promise<Record<string, UnitCode>> {
  return Object.fromEntries(await Promise.all(Object.entries(units).map(async ([unit, path]) => [unit, await unitCode(path)] as const)));
}

async function unitCode(path: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(FIXTURES, `${path}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, path), "utf8"));
}
