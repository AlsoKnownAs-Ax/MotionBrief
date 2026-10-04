import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VideoRef } from "../contract";
import {
  connect,
  failsWith,
  newProject,
  storyboardFixture,
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
let storyboard: unknown;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-stop-"));
  storyboard = await storyboardFixture();
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
    // The run never ends: the app is gone mid-run, with its lock and the generation in progress left behind.
    expect(await readdir(join(project.path, "horizontal"))).toContain("generation.json");

    const restarted = await connect({ root, script: {}, dir: killed.dir });
    const opened = await restarted.core.project.open({ path: project.path });
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
});

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
