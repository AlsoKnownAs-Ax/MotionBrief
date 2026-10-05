import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StylePreset } from "../contract";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { applyPatch, type Patch } from "../modules/revision";
import type { Storyboard } from "../modules/storyboard";
import { bundledPreset, storyboardRules } from "../modules/style";
import { BROWSER_TIMEOUT_MS } from "./test-support/checker";
import { corpusEntries, frameMajor, PRESETS, replayRun, type ReplayedRun, type SavedVersion } from "./test-support/corpus";

const entries = await corpusEntries();
const current = entries.filter(({ entry }) => frameMajor(entry.frameContractVersion) === frameMajor(FRAME_CONTRACT_VERSION));

// A run checks every unit in the pinned chrome-headless-shell and draws its review stills, each taking seconds.
const RUN_TIMEOUT_MS = 600_000;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-replay-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** The saved Preset with another bundled Preset's Palette and typography: its Motion, treatments and Transitions stay. */
function swapped(preset: StylePreset, into: (typeof PRESETS)[number]): StylePreset {
  const { palette, typography } = bundledPreset(into);

  return { ...preset, palette, typography };
}

/**
 * The tier-2 replay: committed agent outputs and hand-written fixtures re-run at zero cost through the core API with the
 * replay connector. Frame minor and patch releases must keep old units passing lint, check and the contract (ADR
 * 0004): every run written against this frame major still generates with no retries and no fallbacks, and each of its
 * Revisions rebuilds exactly the units it rebuilt then. Runs from older majors are re-checked when their Project opens.
 */
describe("the replay corpus", () => {
  it("has entries written against this frame major", () => {
    expect(current).not.toEqual([]);
  });

  describe.each(current)("$name", ({ entry }) => {
    let run: ReplayedRun;
    let last: SavedVersion;

    beforeAll(async () => {
      run = await replayRun(entry, root);
      last = run.versions.at(-1)!;
    }, RUN_TIMEOUT_MS);

    it("generates every unit from its recorded code, each passing the Checker on the first try", () => {
      const [first] = run.versions;

      expect(run.generation).toMatchObject({ state: "done", version: 1 });
      expect(run.written[0]).toEqual(Object.keys(run.corpus.code).sort());
      expect(run.generation.units.filter(({ attempts }) => attempts !== 1)).toEqual([]);
      expect(first).toMatchObject({ number: 1, origin: "generation", flags: [], storyboard: run.corpus.storyboard, code: run.corpus.code });
    });

    it.each(entry.revisions.map((revision, index) => ({ ...revision, index })))("applies Revision $index: $request", ({ index, units }) => {
      const before = run.versions[index]!;
      const after = run.versions[index + 1];
      const recorded = run.corpus.revisions[index]!;

      expect(run.revisions[index]).toMatchObject({ state: "done", version: index + 2 });
      expect(run.written[index + 1]).toEqual(Object.keys(units).sort());
      expect(after).toMatchObject({ origin: "revision", flags: [], storyboard: applyPatch(before.storyboard as Storyboard, recorded.patch as Patch) });
      expect(after?.code).toEqual(Object.fromEntries(Object.keys(after?.code ?? {}).map((unit) => [unit, recorded.code[unit] ?? before.code[unit]])));
    });

    // Scene code uses the frame's tokens only, so a Palette and typography swap re-renders the same code, which still passes.
    it.each(PRESETS.filter((preset) => preset !== entry.preset))(
      "swaps to %s's Palette and typography with no agent, keeping every unit, which still passes every check",
      async (into) => {
        const asked = run.asked();
        const preset = swapped(last.preset, into);

        const { change, video } = await run.core.video.changeStyle({ ...run.video, preset });
        const saved = (await run.saved()).at(-1)!;
        const rules = storyboardRules(preset, { format: run.video.format, captions: saved.captions });
        const report = await run.core.checker.check({ storyboard: saved.storyboard, transcript: run.corpus.transcript, rules, preset, code: saved.code });

        expect(change).toBe("swap");
        expect(video).toMatchObject({ version: saved.number, preset });
        expect(saved).toMatchObject({ origin: "style", storyboard: last.storyboard, units: last.units, code: last.code, preset });
        expect(run.asked()).toBe(asked);
        expect(report.findings).toEqual([]);
      },
      BROWSER_TIMEOUT_MS,
    );
  });
});
