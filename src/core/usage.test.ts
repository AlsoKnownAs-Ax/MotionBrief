import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, Project, UsageStatus, VideoRef } from "../contract";
import type { AgentEvent, ModelUsage } from "../modules/connector";
import { connect, follow, submitsStoryboard, newProject } from "./test-support/generation";

const FIXTURES = join(import.meta.dirname, "fixtures", "generation");

/** The Storyboard the replayed agent writes for the `stacked` Transcript: five lone Scenes. */
const storyboard = JSON.parse(await readFile(join(FIXTURES, "storyboard.json"), "utf8")) as unknown;

const UNITS = ["s01", "s02", "s03", "s04", "s05"];

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5-20251001";

// Making and transcribing a Project takes a few seconds while the other test files run, and the Checker checks the page once.
const RUN_TIMEOUT_MS = 120_000;

/** What a model used in a session so far: Claude reports a session's usage as running totals. */
function used(model: string, inputTokens: number, outputTokens: number, costUsd: number): ModelUsage {
  return { model, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd };
}

function usage(...models: ModelUsage[]): AgentEvent {
  return { type: "usage", usage: models, costUsd: models.reduce((sum, { costUsd }) => sum + costUsd, 0) };
}

/** A Scene-code session's turns, each handing in nothing, so the unit ends as its fallback without being checked. */
function unitTurns(perTurn: { input: number; output: number; cost: number }, extra: ModelUsage[] = []): AgentEvent[][] {
  return [1, 2, 3].map((turn) => [
    usage(used(OPUS, perTurn.input * turn, perTurn.output * turn, perTurn.cost * turn), ...extra),
    { type: "turn-completed", status: "completed", text: "Thinking about it." },
  ]);
}

function planUsage(window: "five-hour" | "seven-day", utilization: number, resetsAt: number): AgentEvent {
  return { type: "plan-usage", planUsage: { window, utilization, resetsAt, isRejected: false } };
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-usage-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

async function generationOf(core: CoreClient, video: VideoRef) {
  return follow<GenerationStatus>(async (signal) => core.video.generation(video, { signal }));
}

async function usageOf(core: CoreClient, video: VideoRef) {
  return follow<UsageStatus>(async (signal) => core.usage.watch({ video }, { signal }));
}

describe("usage on an API key", () => {
  let core: CoreClient;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let project: Project;
  let video: VideoRef;
  let estimate: Awaited<ReturnType<CoreClient["video"]["estimate"]>>;
  let unapproved: unknown;
  let askedBeforeApproval: number;
  let statuses: UsageStatus[];
  let finished: UsageStatus;
  let done: GenerationStatus;

  beforeAll(async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard, usage(used(OPUS, 1000, 200, 0.5)))],
      // s01's agent also used Haiku once, which every later report repeats.
      "scene-code s01": unitTurns({ input: 100, output: 50, cost: 0.1 }, [used(HAIKU, 10, 5, 0.01)]),
      ...Object.fromEntries(UNITS.slice(1).map((unit) => [`scene-code ${unit}`, unitTurns({ input: 100, output: 50, cost: 0.1 })])),
    };
    const connected = await connect({ root, script });
    ({ core, replay } = connected);
    project = await newProject(core, connected.dir);
    video = { projectId: project.id, format: "horizontal" };
    await core.settings.update({ models: { sceneCode: SONNET } });

    estimate = await core.video.estimate(video);
    unapproved = await core.video.generate(video).catch((error: unknown) => error);
    askedBeforeApproval = replay.asked.length;

    UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await generationOf(core, video);
    const usageStream = await usageOf(core, video);
    statuses = usageStream.items;
    await core.video.generate({ ...video, approved: true });
    await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);

    // Settings change mid-run: the fifth unit, which starts after it, still runs on the run's models.
    await core.settings.update({ models: { sceneCode: HAIKU } });
    UNITS.forEach((unit) => replay.release(`scene-code ${unit}`));

    done = await generation.until(({ state }) => state === "done" || state === "failed");
    finished = await usageStream.until((status) => status.run?.state === "finished");
    generation.stop();
    usageStream.stop();
  }, RUN_TIMEOUT_MS);

  afterAll(() => core?.project.close({ projectId: project.id }));

  it("asks for approval of the estimate before the first generation, seeded at $3-5 per Voiceover minute", () => {
    // 33.6 s of Voiceover.
    expect(estimate).toEqual({ minutes: { low: 4, high: 6 }, costUsd: { low: 1.68, high: 2.8 }, needsApproval: true });
    expect(unapproved).toMatchObject({ code: "APPROVAL_REQUIRED", data: { costUsd: { low: 1.68, high: 2.8 } } });
    expect(askedBeforeApproval).toBe(0);
    expect(done).toMatchObject({ state: "done", version: 1 });
  });

  it("runs each agent role on the model Settings chose when the run started", () => {
    expect(replay.askedOf("storyboard")[0]?.options.model).toBe(OPUS);
    expect(UNITS.map((unit) => replay.askedOf(`scene-code ${unit}`)[0]?.options.model)).toEqual(UNITS.map(() => SONNET));
  });

  it("sums the run's usage per model role across its parallel agents, live while they run", () => {
    const run = finished.run;
    const storyboardRole = run?.roles.find(({ role }) => role === "storyboard");
    const sceneCode = run?.roles.find(({ role }) => role === "sceneCode");

    expect(statuses.some((status) => status.run?.state === "running" && (status.run.roles.find(({ role }) => role === "sceneCode")?.costUsd ?? 0) > 0)).toBe(true);
    expect(storyboardRole).toMatchObject({ model: OPUS, inputTokens: 1000, outputTokens: 200 });
    expect(storyboardRole?.costUsd).toBeCloseTo(0.5);
    // 5 units × 3 turns of 100 input tokens and $0.10, plus s01's one Haiku call.
    expect(sceneCode).toMatchObject({ model: SONNET, inputTokens: 1510, outputTokens: 755 });
    expect(sceneCode?.costUsd).toBeCloseTo(1.51);
    expect(run?.total).toMatchObject({ inputTokens: 2510, outputTokens: 955 });
    expect(run?.total.costUsd).toBeCloseTo(2.01);
    expect(finished.method).toBe("api-key");
    expect(finished.plan).toEqual([]);
  });

  it("keeps totals for the video, stored with it, and for today", async () => {
    const stored = JSON.parse(await readFile(join(project.path, "horizontal", "video.json"), "utf8")) as { usage: UsageStatus["today"] };

    expect(finished.video).toMatchObject({ inputTokens: 2510, outputTokens: 955 });
    expect(finished.video?.costUsd).toBeCloseTo(2.01);
    expect(stored.usage).toMatchObject({ inputTokens: 2510, outputTokens: 955 });
    expect(stored.usage.costUsd).toBeCloseTo(2.01);
    expect(finished.today).toMatchObject({ inputTokens: 2510, outputTokens: 955 });
  });

  it("prices the next first generation from the running cost per Voiceover minute", async () => {
    // $2.01 for 0.56 minutes averaged with the $4 seed: about $3.79 a minute.
    const next = await core.video.estimate(video);

    expect(next.costUsd?.low).toBeCloseTo(1.59, 1);
    expect(next.costUsd?.high).toBeCloseTo(2.65, 1);
  });
});

describe("a session's usage reports", () => {
  it(
    "count each counter past its highest report, so one that went down doesn't count twice",
    async () => {
      // Claude reports running totals; a crashed run may report zeros before carrying on.
      const reports = [used(OPUS, 100, 40, 0.1), used(OPUS, 0, 0, 0), used(OPUS, 150, 60, 0.15)];
      const script = {
        storyboard: [submitsStoryboard(storyboard)],
        "scene-code s01": reports.map((report): AgentEvent[] => [usage(report), { type: "turn-completed", status: "completed", text: "Thinking about it." }]),
      };
      const { core, dir } = await connect({ root, script });
      const project = await newProject(core, dir);
      const video: VideoRef = { projectId: project.id, format: "horizontal" };
      const usageStream = await usageOf(core, video);

      await core.video.generate({ ...video, approved: true });
      const finished = await usageStream.until((status) => status.run?.state === "finished");
      usageStream.stop();

      expect(finished.run?.roles).toEqual([
        { role: "sceneCode", model: OPUS, inputTokens: 150, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: expect.closeTo(0.15) },
      ]);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );
});

describe("the cost cap on an API key", () => {
  it(
    "stops the run once its parallel agents together reach it, as Stop does",
    async () => {
      const script = {
        storyboard: [submitsStoryboard(storyboard, usage(used(OPUS, 1000, 200, 0.5)))],
        ...Object.fromEntries(UNITS.map((unit) => [`scene-code ${unit}`, unitTurns({ input: 100, output: 50, cost: 0.3 })])),
      };
      const { core, replay, dir } = await connect({ root, script });
      const project = await newProject(core, dir);
      const video: VideoRef = { projectId: project.id, format: "horizontal" };
      await core.settings.update({ costCapUsd: 1, approveCost: false });
      UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
      const generation = await generationOf(core, video);
      const usageStream = await usageOf(core, video);

      // Approval is off, so Generate starts at once.
      await core.video.generate(video);
      await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);
      UNITS.forEach((unit) => replay.release(`scene-code ${unit}`));
      const done = await generation.until(({ state }) => state === "done" || state === "failed");
      const capped = await usageStream.until((status) => status.run?.state === "capped");
      generation.stop();
      usageStream.stop();

      // $0.50 for the Storyboard and $0.30 for the first unit's turn stay under $1; the second unit's turn reaches it.
      expect(capped.run?.capUsd).toBe(1);
      expect(capped.run?.total.costUsd).toBeGreaterThanOrEqual(1);
      // The cap is a Stop: finished work is kept and the rest becomes flagged fallbacks; no agent starts after it.
      expect(done).toMatchObject({ state: "done", version: 1, stopped: { cause: "cost-cap" } });
      expect(done.units.map(({ status }) => status)).toEqual(UNITS.map(() => "fallback"));
      expect(replay.askedOf("scene-code s05")).toEqual([]);
      const saved = JSON.parse(await readFile(join(project.path, "horizontal", "versions", "1.json"), "utf8")) as { flags: { reason: string }[] };
      expect(saved.flags.map(({ reason }) => reason)).toEqual(UNITS.map(() => "The run reached your cost cap before this Scene was finished."));
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );
});

describe("usage on a subscription", () => {
  it(
    "shows the plan's windows and no dollars, never asks for approval and ignores the cap",
    async () => {
      const now = Date.now();
      const fiveHour = planUsage("five-hour", 0.34, now + 3_600_000);
      const sevenDay = planUsage("seven-day", 0.12, now + 3 * 86_400_000);
      // Every unit has no recorded turn, so it ends as its fallback at once.
      const script = { storyboard: [submitsStoryboard(storyboard, fiveHour, sevenDay, usage(used(OPUS, 1000, 200, 5)))] };
      const { core, dir } = await connect({ root, script, status: { isConnected: true, method: "subscription" } });
      const project = await newProject(core, dir);
      const video: VideoRef = { projectId: project.id, format: "horizontal" };
      await core.settings.update({ costCapUsd: 1 });
      const generation = await generationOf(core, video);
      const usageStream = await usageOf(core, video);

      expect(await core.video.estimate(video)).toEqual({ minutes: { low: 4, high: 6 }, needsApproval: false });
      await core.video.generate(video);
      const done = await generation.until(({ state }) => state === "done" || state === "failed");
      const finished = await usageStream.until((status) => status.run?.state === "finished");
      generation.stop();
      usageStream.stop();
      const stored = JSON.parse(await readFile(join(project.path, "horizontal", "video.json"), "utf8")) as { usage: Record<string, number> };

      expect(done).toMatchObject({ state: "done", version: 1 });
      expect(finished).toEqual({
        method: "subscription",
        run: {
          state: "finished",
          roles: [{ role: "storyboard", model: OPUS, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }],
          total: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
        video: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
        today: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
        plan: [
          { window: "five-hour", utilization: 0.34, resetsAt: now + 3_600_000, isRejected: false },
          { window: "seven-day", utilization: 0.12, resetsAt: now + 3 * 86_400_000, isRejected: false },
        ],
      });
      expect(stored.usage).not.toHaveProperty("costUsd");
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );
});

describe("settings", () => {
  it("default to Opus for every role but visual review, with approval on and no cap, and are kept across restarts", async () => {
    const appDataDir = join(root, "settings-app-data");
    const { core } = await connect({ root, script: {}, appDataDir });

    expect(await core.settings.get()).toEqual({
      models: { storyboard: OPUS, sceneCode: OPUS, visualReview: SONNET, revision: OPUS },
      approveCost: true,
    });
    await core.settings.update({ models: { revision: SONNET }, costCapUsd: 12.5, approveCost: false });

    const { core: restarted } = await connect({ root, script: {}, appDataDir });
    expect(await restarted.settings.get()).toEqual({
      models: { storyboard: OPUS, sceneCode: OPUS, visualReview: SONNET, revision: SONNET },
      approveCost: false,
      costCapUsd: 12.5,
    });
    expect(await restarted.settings.update({ costCapUsd: null })).not.toHaveProperty("costCapUsd");
  });

  it("refuse a model they don't offer and a cap that isn't positive", async () => {
    const { core } = await connect({ root, script: {} });

    await expect(core.settings.update({ models: { storyboard: "gpt-4" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(core.settings.update({ costCapUsd: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("the usage stream", () => {
  it("needs an open Project for a video", async () => {
    const { core } = await connect({ root, script: {} });

    await expect(core.usage.watch({ video: { projectId: "nope", format: "horizontal" } })).rejects.toMatchObject({ code: "UNKNOWN_PROJECT" });
  });
});
