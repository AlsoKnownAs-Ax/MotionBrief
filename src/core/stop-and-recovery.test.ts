import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, Project, UnitCode, VideoRef } from "../contract";
import type { Checker } from "../modules/checker";
import { createGeneration } from "../modules/generation";
import type { Previews, Stills } from "../modules/preview";
import type { Projects, Version } from "../modules/projects";
import { bundledPreset } from "../modules/style";
import { realClock } from "../modules/system";
import { createReplayConnector } from "./fixtures/replay-connector";
import {
  connect,
  failsWith,
  newProject,
  storyboard,
  submitsCode,
  submitsStoryboard,
  unitCode,
  unitStatuses,
  watch,
} from "./test-support/generation";

const UNITS = ["s01", "s02", "s03", "s04", "s05"];

// Every unit is checked in the pinned chrome-headless-shell, each check taking seconds.
const RUN_TIMEOUT_MS = 300_000;

type SavedVersion = { version: number; origin: string; units: Record<string, string>; flags: { unit: string; kind: string; reason: string }[] };

async function savedVersion(projectPath: string, version: number): Promise<SavedVersion> {
  return JSON.parse(await readFile(join(projectPath, "horizontal", "versions", `${version}.json`), "utf8")) as SavedVersion;
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-stop-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

describe("Stop", { timeout: RUN_TIMEOUT_MS }, () => {
  it("before the Storyboard exists leaves the Project with its Voiceover and Transcript and no video", async () => {
    const { core, replay, dir } = await connect({ root, script: { storyboard: [submitsStoryboard(storyboard)] } });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    replay.hold("storyboard");
    const generation = await watch(core, video);

    await core.video.generate(video);
    await generation.until(({ state }) => state === "planning");
    await core.video.stop(video);
    const stopped = await generation.until(({ stopped }) => stopped !== undefined);
    generation.stop();

    expect(stopped).toMatchObject({ state: "idle", units: [], stopped: { cause: "stopped" } });
    expect(stopped.error).toBeUndefined();
    expect(await readdir(project.path)).not.toContain("horizontal");
    const saved = JSON.parse(await readFile(join(project.path, "project.json"), "utf8")) as { transcript: unknown; voiceover: { file: string } };
    expect(saved.transcript).not.toBeNull();
    expect(await readdir(project.path)).toContain(saved.voiceover.file);
    await core.project.close({ projectId: project.id });
  });

  it("while Scenes are written keeps the finished ones and saves the rest as flagged fallbacks in a complete Version", async () => {
    // Only s01 hands in code: the others are still held when Stop interrupts them.
    const script = { storyboard: [submitsStoryboard(storyboard)], "scene-code s01": [submitsCode(await unitCode("good", "s01"))] };
    const { core, replay, dir } = await connect({ root, script });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);

    await core.video.generate(video);
    await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);
    replay.release("scene-code s01");
    // s01 finishes and frees a subagent for s05, which waits too.
    await generation.until((status) => unitStatuses(status).s01 === "ready" && unitStatuses(status).s05 === "writing");
    const askedBeforeStop = replay.asked.map(({ options }) => options.label);
    await core.video.stop(video);
    const done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();
    const saved = await savedVersion(project.path, 1);

    expect(done).toMatchObject({ state: "done", version: 1, stopped: { cause: "stopped" } });
    expect(unitStatuses(done)).toEqual({ s01: "ready", s02: "fallback", s03: "fallback", s04: "fallback", s05: "fallback" });
    expect(done.preview?.timeline.scenes.map(({ status }) => status)).toEqual(["ready", "fallback", "fallback", "fallback", "fallback"]);
    expect(Object.keys(saved.units)).toEqual(["s01"]);
    expect(saved.flags).toEqual(
      ["s02", "s03", "s04", "s05"].map((unit) => ({ unit, kind: "fallback", reason: "Generation was stopped before this Scene was finished." })),
    );
    // Nothing more is asked of the agent once Stop is pressed, and the generation in progress is gone.
    expect(replay.asked.map(({ options }) => options.label)).toEqual(askedBeforeStop);
    expect((await readdir(join(project.path, "horizontal"))).sort()).toEqual(["units", "versions"]);
    await core.project.close({ projectId: project.id });
  });

  it("while a unit is checked keeps it once it passes, and never starts the queued ones", async () => {
    const script = { storyboard: [submitsStoryboard(storyboard)], "scene-code s01": [submitsCode(await unitCode("good", "s01"))] };
    const { core, replay, dir } = await connect({ root, script });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    ["s02", "s03", "s04"].forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);

    await core.video.generate(video);
    // s01 is in the Checker, the other three subagents are writing, and s05 waits for a free one.
    const checking = await generation.until((status) => unitStatuses(status).s01 === "checking");
    await core.video.stop(video);
    const done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();

    expect(unitStatuses(checking).s05).toBe("queued");
    expect(done).toMatchObject({ state: "done", version: 1, stopped: { cause: "stopped" } });
    expect(Object.keys((await savedVersion(project.path, 1)).units)).toEqual(["s01"]);
    expect(replay.askedOf("scene-code s05")).toEqual([]);
    await core.project.close({ projectId: project.id });
  });

  it("happens when the Project is closed mid-run, so its Version is saved before the lock is released", async () => {
    const { core, replay, dir } = await connect({ root, script: { storyboard: [submitsStoryboard(storyboard)] } });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);

    await core.video.generate(video);
    await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);
    await core.project.close({ projectId: project.id });
    generation.stop();
    const saved = await savedVersion(project.path, 1);

    expect(saved.units).toEqual({});
    expect(saved.flags.map(({ unit, reason }) => [unit, reason])).toEqual(UNITS.map((unit) => [unit, "The Project was closed before this Scene was finished."]));
    expect(await readdir(project.path)).not.toContain(".lock");
  });
});

describe("a subscription plan limit", { timeout: RUN_TIMEOUT_MS }, () => {
  it("stops the run as Stop does, with when the plan resets", async () => {
    const resetsAt = Date.UTC(2026, 9, 4, 15, 0);
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      "scene-code s01": [submitsCode(await unitCode("good", "s01"))],
      "scene-code s02": [failsWith({ code: "PLAN_LIMIT", message: "The Claude plan's usage limit was reached", resetsAt })],
    };
    const { core, replay, dir } = await connect({ root, script, status: { isConnected: true, method: "subscription" } });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);

    await core.video.generate(video);
    await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);
    replay.release("scene-code s01");
    // s01 finishes and frees a subagent for s05, which waits too.
    await generation.until((status) => unitStatuses(status).s01 === "ready" && unitStatuses(status).s05 === "writing");
    replay.release("scene-code s02");
    const done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();
    const saved = await savedVersion(project.path, 1);

    expect(done).toMatchObject({ state: "done", version: 1, stopped: { cause: "plan-limit", resetsAt } });
    expect(Object.keys(saved.units)).toEqual(["s01"]);
    expect(saved.flags.map(({ unit, reason }) => [unit, reason])).toEqual(
      ["s02", "s03", "s04", "s05"].map((unit) => [unit, "The Claude plan's usage limit was reached before this Scene was finished."]),
    );
    // The held subagents were interrupted, not played on.
    expect(["s03", "s04", "s05"].map((unit) => replay.askedOf(`scene-code ${unit}`).length)).toEqual([1, 1, 1]);
    await core.project.close({ projectId: project.id });
  });
});

describe("a failed login", { timeout: RUN_TIMEOUT_MS }, () => {
  it("while Scenes are written stops the run as Stop does", async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      "scene-code s01": [failsWith({ code: "AUTHENTICATION_FAILED", message: "Log in" })],
    };
    const { core, replay, dir } = await connect({ root, script });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    ["s02", "s03", "s04", "s05"].forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);

    await core.video.generate(video);
    const done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();

    expect(done).toMatchObject({ state: "done", version: 1, stopped: { cause: "authentication" } });
    expect((await savedVersion(project.path, 1)).flags.map(({ reason }) => reason)).toEqual(UNITS.map(() => "Claude's login failed before this Scene was finished."));
    expect(replay.askedOf("scene-code s05")).toEqual([]);
    await core.project.close({ projectId: project.id });
  });
});

describe("after a crash or quit mid-run", { timeout: RUN_TIMEOUT_MS }, () => {
  it("the next open saves the generation by Stop's rules", async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      "scene-code s01": [submitsCode(await unitCode("good", "s01"))],
    };
    const killed = await connect({ root, script });
    const project = await newProject(killed.core, killed.dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    ["s02", "s03", "s04", "s05"].forEach((unit) => killed.replay.hold(`scene-code ${unit}`));
    const generation = await watch(killed.core, video);

    await killed.core.video.generate(video);
    await generation.until((status) => unitStatuses(status).s01 === "ready");
    generation.stop();
    // The app is gone mid-run, leaving its lock and the generation in progress behind.
    await kill(project.path);
    expect(await readdir(join(project.path, "horizontal"))).toContain("generation.json");

    const restarted = await connect({ root, script: {}, dir: killed.dir });
    const opened = await reopen(restarted.core, project.path);
    const saved = await savedVersion(project.path, 1);

    expect(opened.recovered).toEqual([{ format: "horizontal", version: 1 }]);
    expect(saved).toMatchObject({ version: 1, origin: "generation" });
    expect(Object.keys(saved.units)).toEqual(["s01"]);
    expect(saved.flags.map(({ unit, reason }) => [unit, reason])).toEqual(
      ["s02", "s03", "s04", "s05"].map((unit) => [unit, "MotionBrief closed before this Scene was finished."]),
    );
    expect(await readdir(join(project.path, "horizontal"))).not.toContain("generation.json");
    // Recovery spends nothing and the video is there to revise, not to generate again.
    expect(restarted.replay.asked).toEqual([]);
    await expect(restarted.core.video.generate(video)).rejects.toMatchObject({ code: "ALREADY_GENERATED", data: { version: 1 } });
    await restarted.core.project.close({ projectId: project.id });
  });

  it("keeps the units a Retry got to pass, once only, even when the app quit just after saving its Version", async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      // The first generation's turns fail, so every unit is a fallback; Retry's s01 passes and its s02 is held.
      "scene-code s01": [failsWith({ code: "SERVICE_ERROR", message: "Overloaded" }), submitsCode(await unitCode("good", "s01"))],
    };
    const killed = await connect({ root, script });
    const project = await newProject(killed.core, killed.dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    const generation = await watch(killed.core, video);
    await killed.core.video.generate(video);
    await generation.until(({ state }) => state === "done");
    killed.replay.hold("scene-code s02");

    await killed.core.video.retry({ ...video, units: ["s01", "s02"] });
    await generation.until((status) => status.version === undefined && unitStatuses(status).s01 === "ready");
    generation.stop();
    await kill(project.path);
    const record = await readFile(join(project.path, "horizontal", "generation.json"), "utf8");

    const restarted = await connect({ root, script: {}, dir: killed.dir });
    const opened = await reopen(restarted.core, project.path);
    const saved = await savedVersion(project.path, 2);

    expect(opened.recovered).toEqual([{ format: "horizontal", version: 2 }]);
    expect(saved).toMatchObject({ version: 2, origin: "retry" });
    expect(Object.keys(saved.units)).toEqual(["s01"]);
    // s02 was still being retried: it keeps its fallback and its reason from Version 1.
    expect(saved.flags.map(({ unit }) => unit)).toEqual(["s02", "s03", "s04", "s05"]);
    expect(saved.flags[0]?.reason).toBe((await savedVersion(project.path, 1)).flags[1]?.reason);
    await restarted.core.project.close({ projectId: project.id });

    // As if the app had quit after saving that Version but before removing the record: the run is saved once.
    await writeFile(join(project.path, "horizontal", "generation.json"), record);
    const again = await restarted.core.project.open({ path: project.path });

    expect(again.recovered).toBeUndefined();
    expect((await readdir(join(project.path, "horizontal", "versions"))).sort()).toEqual(["1.json", "2.json"]);
    expect(await readdir(join(project.path, "horizontal"))).not.toContain("generation.json");
    await restarted.core.project.close({ projectId: project.id });
  });
});

/** Leaves the Project as a killed app does: locked by a process that is gone. */
async function kill(projectPath: string) {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  await writeFile(join(projectPath, ".lock"), JSON.stringify({ host: hostname(), pid }));
}

/** Opens a Project a killed app left locked, through the stale lock's "Open anyway". */
async function reopen(core: CoreClient, path: string) {
  await expect(core.project.open({ path })).rejects.toMatchObject({ code: "PROJECT_LOCKED", data: { isThisComputer: true, isStale: true } });

  return core.project.open({ path, force: true });
}

describe("Retry", { timeout: RUN_TIMEOUT_MS }, () => {
  it("regenerates flagged units only when asked, one or all, saving a Version when one now passes", async () => {
    const script = {
      storyboard: [submitsStoryboard(storyboard)],
      // The first generation's subagent fails; a Retry's hands in passing code. The other units have no recorded turns, so they stay fallbacks.
      "scene-code s02": [failsWith({ code: "SERVICE_ERROR", message: "Overloaded" }), submitsCode(await unitCode("good", "s02"))],
    };
    const { core, replay, dir } = await connect({ root, script });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    const generation = await watch(core, video);
    const asked = () => UNITS.map((unit) => replay.askedOf(`scene-code ${unit}`).length);

    await core.video.generate(video);
    const generated = await generation.until(({ state }) => state === "done" || state === "failed");

    expect(generated).toMatchObject({ state: "done", version: 1 });
    expect(generated.stopped).toBeUndefined();
    expect((await savedVersion(project.path, 1)).flags.map(({ unit }) => unit)).toEqual(UNITS);
    // Fallbacks are never retried on their own.
    expect(asked()).toEqual([1, 1, 1, 1, 1]);

    const retried = generation.next(({ state }) => state === "done" || state === "failed");
    await core.video.retry({ ...video, units: ["s02"] });
    const one = await retried;
    const second = await savedVersion(project.path, 2);

    expect(one).toMatchObject({ state: "done", version: 2 });
    expect(unitStatuses(one)).toEqual({ s01: "fallback", s02: "ready", s03: "fallback", s04: "fallback", s05: "fallback" });
    expect(second).toMatchObject({ version: 2, origin: "retry" });
    expect(Object.keys(second.units)).toEqual(["s02"]);
    expect(second.flags.map(({ unit }) => unit)).toEqual(["s01", "s03", "s04", "s05"]);
    expect(asked()).toEqual([1, 2, 1, 1, 1]);
    expect(replay.askedOf("scene-code s02")[1]?.options.model).toBe("claude-opus-5-5");

    await expect(core.video.retry({ ...video, units: ["s02"] })).rejects.toMatchObject({ code: "NOT_FLAGGED", data: { units: ["s02"] } });

    const retriedAll = generation.next(({ state }) => state === "done" || state === "failed");
    await core.video.retry(video);
    const all = await retriedAll;
    generation.stop();

    // Every flagged unit was asked again; none passes, so the video stays at Version 2.
    expect(asked()).toEqual([2, 2, 2, 2, 2]);
    expect(all).toMatchObject({ state: "done", version: 2 });
    expect((await readdir(join(project.path, "horizontal", "versions"))).sort()).toEqual(["1.json", "2.json"]);
    await core.project.close({ projectId: project.id });
  });
});

/**
 * The Generation module on its own, with the Project store, Checker and previews faked, so a unit can be held
 * mid-write: the core API can't time another unit's failure into that moment.
 */
describe("a unit failing while another is being stored", { timeout: RUN_TIMEOUT_MS }, () => {
  it("keeps the failure's flag and reason", async () => {
    // A real Project for the `stacked` Transcript the fixture Storyboard is written against.
    const connected = await connect({ root, script: {} });
    const project = await newProject(connected.core, connected.dir);
    const { transcript } = JSON.parse(await readFile(join(project.path, "project.json"), "utf8")) as { transcript: unknown };
    await connected.core.project.close({ projectId: project.id });

    const { generation, replay, saved, storing, finishStoring } = await fakedGeneration(project, transcript, {
      "scene-code s01": [submitsCode(await unitCode("good", "s01"))],
      "scene-code s02": [failsWith({ code: "SERVICE_ERROR", message: "Overloaded" })],
    });
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    replay.hold("scene-code s02");

    expect(await generation.retry(video, ["s01", "s02"])).toEqual({ data: null, error: null });
    await storing;
    replay.release("scene-code s02");
    await statusOf(generation, video, (status) => unitStatuses(status).s02 === "fallback");
    finishStoring();
    await statusOf(generation, video, ({ state }) => state === "done");

    expect(saved).toHaveLength(1);
    expect(saved[0]?.units).toEqual({ s01: "a".repeat(64) });
    expect(saved[0]?.flags).toEqual([{ unit: "s02", kind: "fallback", reason: "The agent stopped: Overloaded" }]);
  });
});

/** A Generation whose Retry works on Version 1 with s01 and s02 flagged, and whose unit writes wait for `finishStoring`. */
async function fakedGeneration(project: Project, transcript: unknown, script: Parameters<typeof createReplayConnector>[0]) {
  const replay = createReplayConnector(script);
  const storing = Promise.withResolvers<void>();
  const stored = Promise.withResolvers<void>();
  const saved: Omit<Version, "version">[] = [];
  const version: Version = {
    version: 1,
    origin: "generation",
    createdAt: new Date().toISOString(),
    storyboard,
    preset: bundledPreset("blueprint"),
    captions: false,
    units: {},
    flags: ["s01", "s02"].map((unit) => ({ unit, kind: "fallback", reason: "Before the Retry" })),
    models: {},
    frameContractVersion: "1.0.0",
  };
  const projects = {
    video: async () => ({ data: { project, transcript, voiceoverPath: "", version: 1 }, error: null }),
    storedVideo: async () => ({ data: { version, code: {} as Record<string, UnitCode> }, error: null }),
    writeUnit: async () => {
      storing.resolve();
      await stored.promise;

      return { data: "a".repeat(64), error: null };
    },
    saveGeneration: async () => ({ data: null, error: null }),
    saveVersion: async (_projectId: string, _format: string, content: Omit<Version, "version">) => {
      saved.push(content);

      return { data: 2, error: null };
    },
    whenClosing: () => undefined,
    admits: () => true,
    reserve: () => () => undefined,
  } as unknown as Projects;
  const checker = { check: async () => ({ data: { frameContractVersion: "1.0.0", findings: [] }, error: null }) } as unknown as Checker;
  const previews = { open: async () => ({ data: null, error: { code: "VOICEOVER_MISSING", path: "" } }) } as unknown as Previews;
  // No stills, so passing units aren't reviewed.
  const stills = { frames: async () => ({ data: null, error: { code: "BROWSER_FAILED", message: "No stills here" } }) } as unknown as Stills;
  const workDir = await mkdtemp(join(root, "agents-"));
  const generation = createGeneration({ connector: replay.connector, checker, previews, stills, projects, clock: realClock, workDir });

  return { generation, replay, saved, storing: storing.promise, finishStoring: () => stored.resolve() };
}

async function statusOf(generation: ReturnType<typeof createGeneration>, video: VideoRef, matches: (status: GenerationStatus) => boolean) {
  const stop = new AbortController();
  const { data: statuses } = await generation.watch(video, stop.signal);

  for await (const status of statuses ?? []) {
    if (matches(status)) {
      stop.abort();

      return status;
    }
  }

  throw new Error("The generation stream ended");
}
