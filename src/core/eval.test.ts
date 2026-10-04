import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../modules/connector";
import { applyPatch, type Patch } from "../modules/revision";
import type { Storyboard } from "../modules/storyboard";
import { main } from "./eval/cli";
import { addToCorpus, saveResults } from "./eval/corpus";
import { createRecorder, type Recorder } from "./eval/recorder";
import { SCRIPTED_REVISIONS } from "./eval/release-set";
import { blockReasons, planQuota, type CaseResult, type EvalResult } from "./eval/results";
import { runEval, type CaseOutput } from "./eval/run";
import { corpusEntries, replayRun, writtenUnits, type CorpusEntry, type ReplayedRun } from "./test-support/corpus";
import { connect, storyboard, submitsCode, submitsStoryboard, unitCode } from "./test-support/generation";
import { voiceover } from "./test-support/media";

const RUN_TIMEOUT_MS = 300_000;

const FIXTURES = join(import.meta.dirname, "fixtures", "generation");

const tooLong = JSON.parse(await readFile(join(FIXTURES, "storyboard-too-long.json"), "utf8")) as unknown;

/** What one of the Storyboard agent's turns cost, as Claude reports a session's totals. */
const STORYBOARD_USAGE: AgentEvent = {
  type: "usage",
  usage: [{ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5 }],
  costUsd: 0.5,
};

type Scene = { id: string; transition?: { type: string } };

function withTransition(id: string, type: string): Scene {
  const scene = structuredClone((storyboard.scenes as Scene[]).find((candidate) => candidate.id === id));

  return { ...scene!, transition: { type } };
}

function submitsPatch(scenes: Scene[], summary: string, instructions: { scene: string; text: string }[] = []): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_patch", name: "mcp__motionbrief__submit_patch", input: { scenes, remove: [], instructions, summary } },
    { type: "turn-completed", status: "completed", text: summary },
  ];
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-eval-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/**
 * The paid eval through the core API with the replay connector standing in for Claude: no agent turn is paid for. The
 * replayed agent writes a too-long Storyboard first, s03 with a raw color first, and s05 failing its checks every
 * time; the Scene-scoped Revision's first patch instructs a Scene that doesn't exist, its second touches a Scene
 * outside its scope, and the whole-video one is answered.
 */
describe("the paid eval", () => {
  let result: EvalResult;
  let outputs: CaseOutput[];
  let fixturesDir: string;
  let askedVerdictOf: CaseResult[] = [];

  beforeAll(async () => {
    const good = (unit: string) => unitCode("good", unit);
    const missingElement = await unitCode("missing-element", "s05");
    let recorder: Recorder | undefined;
    const { core, dir } = await connect({
      root,
      script: {
        storyboard: [submitsStoryboard(tooLong), [...submitsStoryboard(storyboard).slice(0, 1), STORYBOARD_USAGE, ...submitsStoryboard(storyboard).slice(1)]],
        "scene-code s01": [submitsCode(await good("s01"))],
        "scene-code s02": [submitsCode(await good("s02"))],
        "scene-code s03": [submitsCode(await unitCode("raw-color", "s03")), submitsCode(await good("s03"))],
        "scene-code s04": [submitsCode(await good("s04"))],
        "scene-code s05": Array.from({ length: 3 }, () => submitsCode(missingElement)),
        revision: [
          submitsPatch([withTransition("s03", "cut")], "Cut out of the stat", [{ scene: "s99", text: "Make the number bigger" }]),
          submitsPatch([withTransition("s01", "cut")], "Cut into the load balancer"),
          submitsPatch([withTransition("s03", "cut")], "Cut out of the stat"),
          [{ type: "turn-completed", status: "completed", text: "Which labels should get shorter?" }],
        ],
      },
      wrap: (connector) => {
        recorder = createRecorder(connector);
        return recorder.connector;
      },
    });
    await mkdir(join(dir, "user"), { recursive: true });

    ({ result, outputs } = await runEval({
      core,
      recorder: recorder!,
      runId: "test-run",
      cases: [
        {
          id: "caching-horizontal-blueprint",
          voiceover: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]),
          format: "horizontal",
          preset: "blueprint",
          revisions: SCRIPTED_REVISIONS,
        },
      ],
      projectsDir: join(dir, "Eval Projects"),
      verdict: async (cases) => {
        askedVerdictOf = cases;
        return { looksRight: true, note: "Reads well" };
      },
    }));
    fixturesDir = join(dir, "fixtures");
  }, RUN_TIMEOUT_MS);

  it("measures the first generation: Storyboard attempts, contract retries, first-try token lint and fallbacks per unit", () => {
    const { generation } = result.cases[0]!;
    const units = Object.fromEntries(generation.units.map(({ id, ...unit }) => [id, unit]));

    expect(generation).toMatchObject({ state: "done", version: 1, storyboardAttempts: 2, storyboardFailed: false });
    expect(units.s01).toMatchObject({ status: "ready", contractRetries: 0, firstTryTokenLint: true });
    expect(units.s03).toMatchObject({ status: "ready", contractRetries: 1, firstTryTokenLint: false });
    expect(units.s05).toMatchObject({ status: "fallback", contractRetries: 2 });
    expect(result.firstTryTokenLintRate).toBeCloseTo(4 / 5);
  });

  it("records the model each role ran on and the cost per Voiceover minute", () => {
    const [evalCase] = result.cases;

    expect(evalCase!.models).toMatchObject({ storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5", revision: "claude-opus-5-5" });
    expect(evalCase!.usage.total).toMatchObject({ costUsd: 0.5, inputTokens: 1000, outputTokens: 200 });
    expect(evalCase!.usage.costUsdPerMinute).toBeCloseTo(0.5 / (33.6 / 60), 1);
  });

  it("says plan use is unavailable where no plan window was reported, as on an API key", () => {
    expect(result.cases[0]!.usage.plan.map(({ utilizationPerMinute }) => utilizationPerMinute)).toEqual(["unavailable", "unavailable"]);
  });

  it("measures each scripted Revision's patch validity and scope violations, as the Revision agent checks a patch", () => {
    const [scoped, wholeVideo] = result.cases[0]!.revisions;

    expect(scoped).toMatchObject({ scope: "scene", sceneIds: ["s03"], state: "done", version: 2, firstPatchValid: false, scopeViolations: 2 });
    // The first patch instructs s99, which no Scene is: unknown, and outside the selected s03 too.
    expect(scoped!.patches.map(({ issues }) => issues.map(({ code }) => code))).toEqual([["REFERENCE", "SCOPE"], ["SCOPE"], []]);
    expect(scoped!.units.every(({ rebuild }) => rebuild === "rerender")).toBe(true);
    expect(wholeVideo).toMatchObject({ scope: "whole-video", sceneIds: [], state: "answered", reply: "Which labels should get shorter?", patches: [] });
  });

  it("asks for the human verdict once every case has run, and records it", () => {
    expect(askedVerdictOf.map(({ id }) => id)).toEqual(["caching-horizontal-blueprint"]);
    expect(result.verdict).toEqual({ looksRight: true, note: "Reads well" });
  });

  it("blocks the release on a fallback rate above 5%", () => {
    expect(result.fallbackRate).toBeCloseTo(1 / 5);
    expect(result.blocked).toBe(true);
    expect(result.blockReasons).toEqual(["The fallback rate is 20.0%, above 5.0%."]);
  });

  it("saves the results as JSON named after the run", async () => {
    const path = await saveResults(result, join(fixturesDir, "..", "results"));

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(result);
  });

  describe("added to the replay corpus", () => {
    let entry: CorpusEntry;
    let run: ReplayedRun;

    beforeAll(async () => {
      await addToCorpus(outputs, { fixturesDir, runId: "test-run" });
      ({ entry } = (await corpusEntries(fixturesDir))[0]!);
      run = await replayRun(entry, root, fixturesDir);
    }, RUN_TIMEOUT_MS);

    it("is one run of the case: the first generation with its fallback marked, then the Revision that saved a Version with its patch", async () => {
      expect(entry).toMatchObject({ preset: "blueprint", fallbacks: ["s05"] });
      expect(Object.keys(entry.units)).toEqual(["s01", "s02", "s03", "s04"]);
      expect(await readFile(join(fixturesDir, `${entry.units.s03}.css`), "utf8")).toBe((await unitCode("good", "s03")).css);
      expect(entry.revisions).toEqual([expect.objectContaining({ request: SCRIPTED_REVISIONS[0]!.message, scope: ["s03"], units: {}, fallbacks: [] })]);
      expect(JSON.parse(await readFile(join(fixturesDir, entry.revisions[0]!.patch), "utf8"))).toMatchObject({ scenes: [withTransition("s03", "cut")], summary: "Cut out of the stat" });
    });

    it("replays through the corpus replay, with its fallback replayed as a fallback", () => {
      const [first, revised] = run.versions;

      expect(run.generation).toMatchObject({ state: "done", version: 1 });
      expect(run.written[0]).toEqual(writtenUnits(run.corpus));
      expect(first).toMatchObject({ storyboard: run.corpus.storyboard, code: run.corpus.code, flags: [expect.objectContaining({ unit: "s05", kind: "fallback" })] });
      expect(run.revisions[0]).toMatchObject({ state: "done", version: 2 });
      expect(revised?.storyboard).toEqual(applyPatch(first!.storyboard as Storyboard, run.corpus.revisions[0]!.patch as Patch));
    });
  });
});

describe("npm run eval", () => {
  it("refuses to run in CI", async () => {
    vi.stubEnv("CI", "true");

    try {
      expect(await main([])).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("plan use per Voiceover minute", () => {
  const HOUR = 3_600_000;

  it("is the window's growth from the baseline through the case's last report", () => {
    const baseline = [{ window: "five-hour" as const, utilization: 0.2, resetsAt: HOUR }];
    const reports = [
      { window: "five-hour" as const, utilization: 0.3, resetsAt: HOUR },
      { window: "five-hour" as const, utilization: 0.5, resetsAt: HOUR },
    ];

    expect(planQuota(baseline, reports, 2)[0]).toEqual({ window: "five-hour", utilizationPerMinute: 0.15, resetsAt: HOUR });
  });

  it("counts a single report against the baseline", () => {
    expect(planQuota([{ window: "seven-day", utilization: 0.1 }], [{ window: "seven-day", utilization: 0.13 }], 1)[1]?.utilizationPerMinute).toBeCloseTo(0.03);
  });

  it("counts the window from zero again once it resets", () => {
    const baseline = [{ window: "five-hour" as const, utilization: 0.9, resetsAt: HOUR }];
    const reports = [
      { window: "five-hour" as const, utilization: 0.95, resetsAt: HOUR },
      { window: "five-hour" as const, utilization: 0.1, resetsAt: 6 * HOUR },
      { window: "five-hour" as const, utilization: 0.2, resetsAt: 6 * HOUR },
    ];

    expect(planQuota(baseline, reports, 1)[0]?.utilizationPerMinute).toBeCloseTo(0.05 + 0.1 + 0.1);
  });

  it("is unavailable without a baseline or a report during the case", () => {
    const report = [{ window: "five-hour" as const, utilization: 0.4, resetsAt: HOUR }];

    expect(planQuota([], report, 1)[0]?.utilizationPerMinute).toBe("unavailable");
    expect(planQuota(report, [], 1)[0]?.utilizationPerMinute).toBe("unavailable");
  });
});

describe("what blocks a release", () => {
  const generation = { state: "done", storyboardAttempts: 1, storyboardFailed: false, units: [], reviewNotes: [], wallSeconds: 1 } as const;
  const passing = { id: "explainer-horizontal-blueprint", generation, revisions: [] } as unknown as CaseResult;

  it("is nothing when the fallback rate is at most 5%, every Storyboard was valid and the human said yes", () => {
    expect(blockReasons({ cases: [passing], fallbackRate: 0.05, verdict: { looksRight: true, note: "" } })).toEqual([]);
  });

  it("is a Storyboard that failed after its retries", () => {
    const failed = { ...passing, generation: { ...generation, state: "failed", storyboardFailed: true } } as unknown as CaseResult;

    expect(blockReasons({ cases: [failed], fallbackRate: 0, verdict: { looksRight: true, note: "" } })).toEqual([
      "The Storyboard failed after its retries in explainer-horizontal-blueprint.",
    ]);
  });

  it("is a human no", () => {
    expect(blockReasons({ cases: [passing], fallbackRate: 0, verdict: { looksRight: false, note: "Sketchbook text is blurry" } })).toEqual([
      "The human verdict is no: Sketchbook text is blurry",
    ]);
  });
});
