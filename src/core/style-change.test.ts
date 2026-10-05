import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, Project, StylePreset, UnitCode, VideoRef } from "../contract";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { BUNDLED_PALETTES, bundledPreset, FONT_PAIRINGS } from "../modules/style";
import type { ReplayScript } from "./fixtures/replay-connector";
import { connect, failsWith, newProject, sha256, storyboard, submitsCode, submitsReview, unitCode, watch } from "./test-support/generation";

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

  return { core, replay, project, video, units };
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

async function captionsChoice(project: Project) {
  return (JSON.parse(await readFile(join(project.path, "horizontal", "video.json"), "utf8")) as { captions?: boolean }).captions;
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

  it("swaps Captions on: a Version, the video's choice, and Captions drawn", async () => {
    const { core, replay, project, video, units } = connected;

    const changed = await core.video.changeStyle({ ...video, captions: true });

    expect(changed).toMatchObject({ change: "swap", video: { version: 5, captions: true } });
    expect(await readVersion(project, 5)).toMatchObject({ origin: "style", style: "Captions on", captions: false, showsCaptions: true, units });
    expect(await captionsChoice(project)).toBe(true);
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
    const { core, project, video } = connected;

    const { version } = await core.video.restore({ ...video, version: 1 });
    const opened = await core.video.open(video);

    expect(version).toBe(6);
    expect(opened).toMatchObject({ version: 6, captions: false, preset: BLUEPRINT });
    expect(await captionsChoice(project)).toBe(false);
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
    const looksRight = submitsReview({ looksRight: true, problems: [], note: "" });
    connected = await generatedVideo({
      storyboard: [failsWith({ code: "SERVICE_ERROR", message: "Overloaded" })],
      ...Object.fromEntries(await Promise.all(UNITS.map(async (unit) => [`scene-code ${unit}`, [submitsCode(await unitCode("good", unit))]] as const))),
      ...Object.fromEntries(UNITS.map((unit) => [`review ${unit}`, [looksRight]])),
      "scene-code s05": [failsWith({ code: "SERVICE_ERROR", message: "Overloaded" })],
    });
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

  it("plans the Storyboard again when the new Preset rules it out, and saves nothing when that fails", async () => {
    const { core, replay, video } = connected;
    const generation = await watch(core, video);

    expect(await core.video.changeStyle({ ...video, preset: bundledPreset("whiteboard"), confirmed: true })).toEqual({ change: "restyle" });
    const ended = await generation.until(({ state }) => state === "failed");
    generation.stop();

    expect(ended.error).toMatchObject({ code: "AGENT_FAILED" });
    expect(replay.askedOf("storyboard")).toHaveLength(1);
    expect(JSON.stringify(replay.askedOf("storyboard")[0])).toContain(bundledPreset("whiteboard").direction);
    expect(await newestVersion(core, video)).toBe(2);
  });
});
