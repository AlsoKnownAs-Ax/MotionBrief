import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, Project, StylePreset, UnitCode, VideoRef } from "../contract";
import type { AgentEvent } from "../modules/connector";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { BUNDLED_PALETTES, bundledPreset, FONT_PAIRINGS } from "../modules/style";
import type { ReplayScript } from "./fixtures/replay-connector";
import { connect, failsWith, newProject, sha256, storyboard, submitsCode, submitsReview, submitsStoryboard, unitCode, watch } from "./test-support/generation";

// A restyle checks every unit it regenerates in the pinned chrome-headless-shell.
const RUN_TIMEOUT_MS = 180_000;

const BLUEPRINT = bundledPreset("blueprint");
const UNITS = ["s01", "s02", "s03", "s04"];

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-style-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** A core with a transcribed Project whose 16:9 video has Version 1 in Blueprint: `good` code in s01-s04, s05 a fallback. */
async function generatedVideo(script: ReplayScript) {
  const { core, replay, dir } = await connect({ root, script });
  const project = await newProject(core, dir);
  const video = { projectId: project.id, format: "horizontal" } satisfies VideoRef;
  const code = Object.fromEntries(await Promise.all(UNITS.map(async (unit) => [unit, await unitCode("good", unit)] as const)));
  const units = await saveVersion1(project, code);

  return { core, replay, dir, project, video, units };
}

async function saveVersion1(project: Project, code: Record<string, UnitCode>) {
  const folder = join(project.path, "horizontal");
  await mkdir(join(folder, "units"), { recursive: true });
  await mkdir(join(folder, "versions"), { recursive: true });
  const hashed = Object.entries(code).map(([unit, unitCodeOf]) => ({ unit, text: `${JSON.stringify(unitCodeOf, null, 2)}\n` }));
  await Promise.all(hashed.map(({ text }) => writeFile(join(folder, "units", `${sha256(text)}.json`), text)));
  const version = {
    storyboard,
    preset: BLUEPRINT,
    captions: false,
    units: Object.fromEntries(hashed.map(({ unit, text }) => [unit, sha256(text)])),
    flags: [{ unit: "s05", kind: "fallback", reason: "[contract MISSING_ELEMENT] It never appears." }],
    models: { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5" },
    frameContractVersion: FRAME_CONTRACT_VERSION,
    version: 1,
    createdAt: "2026-10-04T12:00:00.000Z",
    origin: "generation",
  };
  await writeFile(join(folder, "versions", "1.json"), `${JSON.stringify(version, null, 2)}\n`);

  return version.units;
}

async function readVersion(project: Project, number: number) {
  return JSON.parse(await readFile(join(project.path, "horizontal", "versions", `${number}.json`), "utf8")) as Record<string, unknown> & { preset: StylePreset };
}

/** Leaves a Captions choice in the video's document, as a choice saved before the Version it belongs to would. */
async function leaveCaptionsChoice(project: Project, captions: boolean) {
  const path = join(project.path, "horizontal", "video.json");
  const document = JSON.parse(await readFile(path, "utf8").catch(() => "{}")) as Record<string, unknown>;
  await writeFile(path, `${JSON.stringify({ ...document, captions }, null, 2)}\n`);
}

function generationRecord(project: Project) {
  return readFile(join(project.path, "horizontal", "generation.json"), "utf8").then(
    () => true,
    () => false,
  );
}

/** The Project's saved Transcript, as a Storyboard is checked against it. */
async function transcriptOf(core: CoreClient, project: Project) {
  for await (const { state, duration, words } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return { duration, words: words.map(({ text, start }) => ({ text, start })) };
    }
  }

  throw new Error("The transcription stream ended");
}

/** The fixture Storyboard planned again for Whiteboard, which allows no cuts: crossfades in their place. */
const whiteboardStoryboard = JSON.parse(JSON.stringify(storyboard).replaceAll('"type":"cut"', '"type":"crossfade"')) as unknown;

/**
 * What the agents hand in over `runs` restyles: `good` code for s01-s04, each reviewed as looking right, and s05 never
 * handed in, so it stays a fallback.
 */
async function restyleTurns(runs: number): Promise<Record<string, AgentEvent[][]>> {
  const looksRight = submitsReview({ looksRight: true, problems: [], note: "" });
  const code = await Promise.all(UNITS.map(async (unit) => [unit, submitsCode(await unitCode("good", unit))] as const));

  return {
    ...Object.fromEntries(code.map(([unit, turn]) => [`scene-code ${unit}`, Array.from({ length: runs }, () => turn)])),
    ...Object.fromEntries(UNITS.map((unit) => [`review ${unit}`, Array.from({ length: runs }, () => looksRight)])),
    "scene-code s05": Array.from({ length: runs }, () => failsWith({ code: "SERVICE_ERROR", message: "Overloaded" })),
  };
}

async function newestVersion(core: CoreClient, video: VideoRef) {
  return (await core.video.versions(video))[0]?.version;
}

const OTHER_PALETTE = BUNDLED_PALETTES.find(({ name }) => name !== BLUEPRINT.palette.name)!;
const OTHER_TYPOGRAPHY = FONT_PAIRINGS.find(({ name }) => name !== BLUEPRINT.typography.name)!;

describe("swaps from the Style tab", () => {
  let connected: Awaited<ReturnType<typeof generatedVideo>>;

  beforeAll(async () => {
    connected = await generatedVideo({});
  });

  afterAll(() => connected?.core.project.close({ projectId: connected.project.id }));

  it.each([
    { change: "Palette", preset: { ...BLUEPRINT, palette: OTHER_PALETTE }, style: `Palette: ${OTHER_PALETTE.name}`, version: 2 },
    { change: "typography", preset: { ...BLUEPRINT, palette: OTHER_PALETTE, typography: OTHER_TYPOGRAPHY }, style: `Typography: ${OTHER_TYPOGRAPHY.name}`, version: 3 },
    { change: "caption style", preset: { ...BLUEPRINT, palette: OTHER_PALETTE, typography: OTHER_TYPOGRAPHY, captions: "pop" as const }, style: "Caption style: Pop", version: 4 },
  ])("swaps the $change: a Version with the same Storyboard and units, re-rendered with no agent", async ({ preset, style, version }) => {
    const { core, replay, project, video, units } = connected;

    const changed = await core.video.changeStyle({ ...video, preset });
    const saved = await readVersion(project, version);

    expect(changed).toMatchObject({ change: "swap", video: { version, preset, captions: false } });
    expect(changed.video?.preview).toBeDefined();
    expect(saved).toMatchObject({ origin: "style", style, storyboard, units, preset });
    expect(replay.asked).toEqual([]);
  });

  it("swaps Captions on: a Version that shows them", async () => {
    const { core, replay, project, video, units } = connected;

    const changed = await core.video.changeStyle({ ...video, captions: true });

    expect(changed).toMatchObject({ change: "swap", video: { version: 5, captions: true } });
    expect(await readVersion(project, 5)).toMatchObject({ origin: "style", style: "Captions on", captions: false, showsCaptions: true, units });
    expect(replay.asked).toEqual([]);
  });

  it("changes nothing, and saves no Version, when the look is the same", async () => {
    const { core, video } = connected;
    const { preset } = await core.video.open(video);

    expect(await core.video.changeStyle({ ...video, preset: { ...preset!, name: "Renamed" }, captions: true })).toMatchObject({ change: "none", video: { version: 5 } });
    expect(await newestVersion(core, video)).toBe(5);
  });

  it("lists each swap in Versions with what it changed", async () => {
    const { core, video } = connected;

    const listed = await core.video.versions(video);

    expect(listed.map(({ origin, summary }) => [origin, summary])).toEqual([
      ["style", "Captions on"],
      ["style", "Caption style: Pop"],
      ["style", `Typography: ${OTHER_TYPOGRAPHY.name}`],
      ["style", `Palette: ${OTHER_PALETTE.name}`],
      ["generation", undefined],
    ]);
  });

  it("restores a Version as it looked, its Captions included", async () => {
    const { core, video } = connected;

    const { version } = await core.video.restore({ ...video, version: 1 });
    const opened = await core.video.open(video);

    expect(version).toBe(6);
    expect(opened).toMatchObject({ version: 6, captions: false, preset: BLUEPRINT });
  });

  it("plays Captions as the newest Version says, whatever Captions choice the video's document holds", async () => {
    const { core, project, video } = connected;

    await leaveCaptionsChoice(project, true);

    expect(await core.video.open(video)).toMatchObject({ version: 6, captions: false });
  });

  it("makes the Captions switch of a generated video a Version", async () => {
    const { core, replay, video } = connected;

    expect(await core.video.setCaptions({ ...video, captions: true })).toMatchObject({ version: 7, captions: true });
    expect(await newestVersion(core, video)).toBe(7);
    expect(replay.asked).toEqual([]);
  });
});

describe("classifying a style change", () => {
  let connected: Awaited<ReturnType<typeof generatedVideo>>;

  beforeAll(async () => {
    connected = await generatedVideo({});
  });

  afterAll(() => connected?.core.project.close({ projectId: connected.project.id }));

  // The Storyboard uses cuts and crossfades on no Canvas.
  it.each([
    { change: "another Preset", preset: bundledPreset("whiteboard"), replans: true },
    { change: "another Preset that allows the Storyboard", preset: bundledPreset("terminal"), replans: false },
    { change: "Motion", preset: { ...BLUEPRINT, motion: { energy: "punchy", character: "springy" } }, replans: false },
    { change: "direction", preset: { ...BLUEPRINT, direction: "Slow and warm, like a fireside talk." }, replans: false },
    { change: "treatments", preset: { ...BLUEPRINT, treatments: { ...BLUEPRINT.treatments, texture: "film-grain" } }, replans: false },
    { change: "Transitions", preset: { ...BLUEPRINT, transitions: ["crossfade", "push"] }, replans: true },
    { change: "Canvas preference", preset: { ...BLUEPRINT, canvas: "never" }, replans: false },
  ] satisfies { change: string; preset: StylePreset; replans: boolean }[])(
    "makes $change a restyle that asks to confirm first, priced on an API key",
    async ({ preset, replans }) => {
      const { core, replay, video } = connected;

      await expect(core.video.changeStyle({ ...video, preset })).rejects.toMatchObject({
        code: "RESTYLE_UNCONFIRMED",
        data: { replans, costUsd: { low: expect.any(Number), high: expect.any(Number) } },
      });
      expect(await newestVersion(core, video)).toBe(1);
      expect(replay.asked).toEqual([]);
    },
  );

  it.each([
    { change: "Palette", preset: { ...BLUEPRINT, palette: OTHER_PALETTE } },
    { change: "typography", preset: { ...BLUEPRINT, typography: OTHER_TYPOGRAPHY } },
    { change: "caption style", preset: { ...BLUEPRINT, captions: "plain" as const } },
    { change: "Captions", captions: true },
  ])("makes $change a swap", async ({ preset, captions }) => {
    const { core, video } = connected;
    const before = await newestVersion(core, video);

    const { change } = await core.video.changeStyle({ ...video, preset, captions });

    expect(change).toBe("swap");
    expect(await newestVersion(core, video)).toBe((before ?? 0) + 1);
  });
});

describe("a restyle", () => {
  const direction = "Slow and warm, like a fireside talk.";
  let connected: Awaited<ReturnType<typeof generatedVideo>>;

  beforeAll(async () => {
    // Two runs: each unit's sessions take their turns in order.
    connected = await generatedVideo({ storyboard: [submitsStoryboard(whiteboardStoryboard)], ...(await restyleTurns(2)) });
  });

  afterAll(() => connected?.core.project.close({ projectId: connected.project.id }));

  it(
    "keeps the Storyboard and regenerates every unit once confirmed, holding the video meanwhile",
    async () => {
      const { core, replay, project, video } = connected;
      const preset = { ...BLUEPRINT, direction };
      const generation = await watch(core, video);
      replay.hold("scene-code s01");

      // The replay connector is an API key with approval on: the confirmation approves the cost.
      expect(await core.video.changeStyle({ ...video, preset, confirmed: true })).toEqual({ change: "restyle" });
      await generation.until(({ state }) => state === "writing");
      await expect(core.video.changeStyle({ ...video, captions: true })).rejects.toMatchObject({ code: "BUSY" });
      replay.release("scene-code s01");
      const done = await generation.until(({ state }) => state === "done" || state === "failed");
      generation.stop();
      const saved = await readVersion(project, 2);

      expect(done).toMatchObject({ state: "done", version: 2 });
      expect(replay.askedOf("storyboard")).toEqual([]);
      expect([...new Set(replay.asked.map(({ options }) => options.label).filter((label) => label?.startsWith("scene-code")))].sort()).toEqual(
        ["s01", "s02", "s03", "s04", "s05"].map((unit) => `scene-code ${unit}`),
      );
      expect(saved).toMatchObject({ origin: "restyle", style: "Restyled: direction", storyboard, preset, captions: false });
      expect((saved.flags as { unit: string; kind: string }[]).map(({ unit, kind }) => [unit, kind])).toEqual([["s05", "fallback"]]);
      expect(await core.video.open(video)).toMatchObject({ version: 2, preset });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "plans the Storyboard again when the new Preset rules it out, valid under the new Preset",
    async () => {
      const { core, replay, project, video } = connected;
      const whiteboard = bundledPreset("whiteboard");
      const generation = await watch(core, video);

      expect(await core.video.changeStyle({ ...video, preset: whiteboard, confirmed: true })).toEqual({ change: "restyle" });
      const done = await generation.until(({ state }) => state === "done" || state === "failed");
      generation.stop();
      const saved = await readVersion(project, 3);
      const { issues } = await core.storyboard.validate({
        storyboard: saved.storyboard,
        transcript: await transcriptOf(core, project),
        rules: { format: "horizontal", captions: false, transitions: whiteboard.transitions, canvas: whiteboard.canvas },
      });

      expect(done).toMatchObject({ state: "done", version: 3 });
      expect(replay.askedOf("storyboard")).toHaveLength(1);
      expect(saved).toMatchObject({ origin: "restyle", style: "Restyled to Whiteboard", storyboard: whiteboardStoryboard, preset: whiteboard });
      expect(issues).toEqual([]);
    },
    RUN_TIMEOUT_MS,
  );
});

describe("a regeneration from scratch", () => {
  it(
    "asks to confirm first, priced on an API key, then plans a new Storyboard and every unit while the current Version plays",
    async () => {
      const { core, replay, project, video } = await generatedVideo({ storyboard: [submitsStoryboard(storyboard)], ...(await restyleTurns(1)) });

      await expect(core.video.regenerate(video)).rejects.toMatchObject({
        code: "REGENERATE_UNCONFIRMED",
        data: { costUsd: { low: expect.any(Number), high: expect.any(Number) } },
      });
      expect(replay.asked).toEqual([]);

      const generation = await watch(core, video);
      replay.hold("storyboard");
      await core.video.regenerate({ ...video, confirmed: true });
      await generation.until(({ state }) => state === "planning");
      // The current Version stays the video's until the new one is complete.
      expect(await core.video.open(video)).toMatchObject({ version: 1 });
      await expect(core.video.regenerate({ ...video, confirmed: true })).rejects.toMatchObject({ code: "BUSY" });
      replay.release("storyboard");
      const done = await generation.until(({ state }) => state === "done" || state === "failed");
      generation.stop();
      const saved = await readVersion(project, 2);

      expect(done).toMatchObject({ state: "done", version: 2 });
      expect(replay.askedOf("storyboard")).toHaveLength(1);
      expect(saved).toMatchObject({ origin: "regeneration", storyboard, preset: BLUEPRINT, captions: false });
      expect((await core.video.versions(video)).map(({ origin }) => origin)).toEqual(["regeneration", "generation"]);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "is discarded when cut short, leaving nothing a crash recovery would save",
    async () => {
      const { core, replay, project, video } = await generatedVideo({ storyboard: [submitsStoryboard(storyboard)], ...(await restyleTurns(1)) });
      const generation = await watch(core, video);
      replay.hold("scene-code s01");

      await core.video.regenerate({ ...video, confirmed: true });
      await generation.until(({ units }) => units.some(({ id, status }) => id === "s02" && status === "ready"));
      const hasRecord = await generationRecord(project);
      await core.video.stop(video);
      const ended = await generation.until((status) => status.stopped !== undefined && hasEnded(status));
      generation.stop();

      expect(hasRecord).toBe(false);
      expect(ended).toMatchObject({ state: "idle", stopped: { cause: "stopped" } });
      expect(await newestVersion(core, video)).toBe(1);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );
});

/** Ends once the video's restyle has ended, however it ended. */
const hasEnded = ({ state }: GenerationStatus) => state === "idle" || state === "done" || state === "failed";

describe("a restyle cut short", () => {
  const preset = { ...BLUEPRINT, direction: "Slow and warm, like a fireside talk." };

  it(
    "is discarded on Stop: the video stays at its Version",
    async () => {
      const { core, replay, project, video } = await generatedVideo(await restyleTurns(1));
      const generation = await watch(core, video);
      replay.hold("scene-code s01");

      await core.video.changeStyle({ ...video, preset, confirmed: true });
      await generation.until(({ units }) => units.some(({ id, status }) => id === "s02" && status === "ready"));
      await core.video.stop(video);
      const ended = await generation.until((status) => status.stopped !== undefined && hasEnded(status));
      generation.stop();

      expect(ended).toMatchObject({ state: "idle", stopped: { cause: "stopped" } });
      expect(await newestVersion(core, video)).toBe(1);
      expect(await core.video.open(video)).toMatchObject({ version: 1, preset: BLUEPRINT });
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "is discarded when Claude's login fails mid-run",
    async () => {
      const { core, project, video } = await generatedVideo({
        ...(await restyleTurns(1)),
        "scene-code s01": [failsWith({ code: "AUTHENTICATION_FAILED", message: "Logged out" })],
      });
      const generation = await watch(core, video);

      await core.video.changeStyle({ ...video, preset, confirmed: true });
      const ended = await generation.until((status) => status.stopped !== undefined && hasEnded(status));
      generation.stop();

      expect(ended).toMatchObject({ state: "idle", stopped: { cause: "authentication" } });
      expect(await newestVersion(core, video)).toBe(1);
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "leaves nothing a crash recovery would save",
    async () => {
      const { core, replay, dir, project, video } = await generatedVideo(await restyleTurns(1));
      const generation = await watch(core, video);
      replay.hold("scene-code s01");

      await core.video.changeStyle({ ...video, preset, confirmed: true });
      await generation.until(({ units }) => units.some(({ id, status }) => id === "s02" && status === "ready"));
      const hasRecord = await generationRecord(project);
      // MotionBrief started again on the same folders while the restyle was cut off.
      const { core: restarted } = await connect({ root, script: {}, dir });
      const reopened = await restarted.project.open({ path: project.path, force: true });

      expect(hasRecord).toBe(false);
      expect(reopened.recovered ?? []).toEqual([]);
      expect(await newestVersion(restarted, video)).toBe(1);
      await restarted.project.close({ projectId: project.id });
      await core.video.stop(video);
      generation.stop();
    },
    RUN_TIMEOUT_MS,
  );
});
