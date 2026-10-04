import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, OpenedVideo, UnitCode, VideoRef } from "../contract";
import type { AgentEvent } from "../modules/connector";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { createReplayConnector, type ReplayScript } from "./fixtures/replay-connector";
import { submitsReview } from "./test-support/generation";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

const FIXTURES = join(import.meta.dirname, "fixtures", "generation");

/** A frame contract version one major release before this app's. */
const OLDER_MAJOR = `${Number(FRAME_CONTRACT_VERSION.split(".")[0]) - 1}.9.0`;

/** The Storyboard of the `stacked` Transcript: five lone Scenes, s01 to s05. */
const storyboard = JSON.parse(await readFile(join(FIXTURES, "storyboard.json"), "utf8")) as unknown;

/** Committed Scene code: `good` passes every check; `raw-color` s03 uses a raw color, which the token lint refuses. */
async function unitCode(variant: "good" | "raw-color", unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(FIXTURES, variant, `${unit}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/** A turn in which a Scene-code subagent hands in its unit's code through its host tool. */
function submitsCode(code: UnitCode): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_code", name: "mcp__motionbrief__submit_scene_code", input: code },
    { type: "turn-completed", status: "completed", text: "Submitted the Scene code." },
  ];
}

const MODEL = randomBytes(1024);

/** Opening re-checks in the pinned browser; a Retry also checks the unit it rewrites. */
const TIMEOUT_MS = 180_000;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-frame-update-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** A core with the transcription model installed, the `stacked` Transcript and an agent replaying `script`. */
async function connect(script: ReplayScript = {}) {
  const dir = await mkdtemp(join(root, "core-"));
  const replay = createReplayConnector(script);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: createHash("sha256").update(MODEL).digest("hex"), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: join(dir, "app-data"),
    projectsDir: join(dir, "Projects"),
    cacheDir: join(dir, "cache"),
    modelPin,
    adapters: { connector: replay.connector, whisper: fakeWhisper(await whisperFixture("stacked", 1)) },
  });
  const core = createRouterClient(router);
  const model = join(dir, "model.bin");
  await writeFile(model, MODEL);
  await core.transcriptionModel.import({ path: model });

  for await (const { state } of await core.transcriptionModel.watch()) {
    if (state === "ready") {
      break;
    }
  }

  return { core, replay, dir };
}

type FixtureUnits = Partial<Record<"s01" | "s02" | "s03" | "s04", "good" | "raw-color">>;

/**
 * A closed, transcribed Project whose 16:9 video has Version 1, written against `frameContractVersion`: s01 to s04
 * play the given Scene code with the given review notes, and s05 is already a flagged fallback.
 */
async function fixtureProject(core: CoreClient, dir: string, frameContractVersion: string, variants: FixtureUnits = {}, notes: Record<string, string> = {}) {
  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]), format: "horizontal" });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      break;
    }
  }

  await core.project.close({ projectId: project.id });
  const videoDir = join(project.path, "horizontal");
  await mkdir(join(videoDir, "units"), { recursive: true });
  await mkdir(join(videoDir, "versions"), { recursive: true });
  const units: Record<string, string> = {};

  for (const unit of ["s01", "s02", "s03", "s04"] as const) {
    const text = `${JSON.stringify(await unitCode(variants[unit] ?? "good", unit), null, 2)}\n`;
    units[unit] = sha256(text);
    await writeFile(join(videoDir, "units", `${units[unit]}.json`), text);
  }

  const version = {
    version: 1,
    storyboard,
    preset: bundledPreset("blueprint"),
    captions: false,
    units,
    flags: [
      ...Object.entries(notes).map(([unit, reason]) => ({ unit, kind: "review-note", reason })),
      { unit: "s05", kind: "fallback", reason: "- [contract MISSING_ELEMENT] s05-title never appears" },
    ],
    models: { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5", review: "claude-sonnet-5-5" },
    frameContractVersion,
    createdAt: "2026-01-02T03:04:05.000Z",
    origin: "generation",
  };
  await writeFile(join(videoDir, "versions", "1.json"), `${JSON.stringify(version, null, 2)}\n`);

  return project.path;
}

async function openVideo(core: CoreClient, path: string): Promise<{ opened: OpenedVideo; video: VideoRef }> {
  const { project } = await core.project.open({ path });
  const video = { projectId: project.id, format: "horizontal" as const };

  return { opened: await core.video.open(video), video };
}

async function versionFile(path: string, number: number) {
  return JSON.parse(await readFile(join(path, "horizontal", "versions", `${number}.json`), "utf8")) as {
    origin: string;
    units: Record<string, string>;
    flags: { unit: string; kind: string; reason: string }[];
    frameContractVersion: string;
  };
}

function sceneStatuses(opened: OpenedVideo) {
  return Object.fromEntries((opened.preview?.timeline.scenes ?? []).map(({ id, status }) => [id, status]));
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

describe("opening a Project recorded against an older frame major", { timeout: TIMEOUT_MS }, () => {
  let setup: Awaited<ReturnType<typeof connect>>;
  let path: string;
  let opened: OpenedVideo;
  let video: VideoRef;

  beforeAll(async () => {
    setup = await connect({
      "scene-code s03": [submitsCode(await unitCode("good", "s03"))],
      "review s03": [submitsReview({ looksRight: true, problems: [], note: "" })],
    });
    path = await fixtureProject(setup.core, setup.dir, OLDER_MAJOR, { s03: "raw-color" });
    ({ opened, video } = await openVideo(setup.core, path));
  }, TIMEOUT_MS);

  it("re-checks its units with no agent and flags those that fail as fallbacks in a new Version", async () => {
    expect(opened.frameUpdate).toEqual({ previous: OLDER_MAJOR, frameContractVersion: FRAME_CONTRACT_VERSION, units: ["s03"] });
    expect(opened.version).toBe(2);
    expect(setup.replay.asked).toEqual([]);

    const saved = await versionFile(path, 2);
    expect(saved.origin).toBe("frame-update");
    expect(saved.frameContractVersion).toBe(FRAME_CONTRACT_VERSION);
    expect(Object.keys(saved.units)).toEqual(["s01", "s02", "s04"]);
    expect(saved.flags.map(({ unit }) => unit)).toEqual(["s05", "s03"]);
    expect(saved.flags[1]?.reason).toContain("tokens");
  });

  it("plays the failing units as fallback Scenes, with the usual badges", () => {
    expect(sceneStatuses(opened)).toEqual({ s01: "ready", s02: "ready", s03: "fallback", s04: "ready", s05: "fallback" });
  });

  it("keeps the Version the units were written in", async () => {
    expect((await versionFile(path, 1)).frameContractVersion).toBe(OLDER_MAJOR);
  });

  it("doesn't re-check or announce it again on the next open", async () => {
    await setup.core.project.close({ projectId: video.projectId });
    const again = await openVideo(setup.core, path);

    expect(again.opened.frameUpdate).toBeUndefined();
    expect(again.opened.version).toBe(2);
    expect(await readdir(join(path, "horizontal", "versions"))).toEqual(["1.json", "2.json"]);
    video = again.video;
  });

  it("refuses to retry a unit that isn't flagged", async () => {
    await expect(setup.core.video.retry({ ...video, units: ["s01"] })).rejects.toMatchObject({ code: "NOT_FLAGGED", data: { units: ["s01"] } });
  });

  it("regenerates only the Scenes the creator retries, in a new Version", async () => {
    const statuses: GenerationStatus[] = [];
    const stream = await setup.core.video.generation(video);
    await setup.core.video.retry({ ...video, units: ["s03"] });

    for await (const status of stream) {
      statuses.push(status);

      if (status.state === "done" || status.state === "failed") {
        break;
      }
    }

    expect(statuses.at(-1)).toMatchObject({ state: "done", version: 3 });
    expect(setup.replay.asked.map(({ options }) => options.label)).toEqual(["scene-code s03", "review s03"]);

    const saved = await versionFile(path, 3);
    expect(saved.origin).toBe("retry");
    expect(Object.keys(saved.units)).toEqual(["s01", "s02", "s03", "s04"]);
    expect(saved.flags.map(({ unit }) => unit)).toEqual(["s05"]);
  });

  it("re-opened, streams no finished run's preview over the newest Version's", async () => {
    await setup.core.project.close({ projectId: video.projectId });
    const again = await openVideo(setup.core, path);
    let first: GenerationStatus | undefined;

    for await (const status of await setup.core.video.generation(again.video)) {
      first = status;
      break;
    }

    expect(again.opened.version).toBe(3);
    expect(sceneStatuses(again.opened).s03).toBe("ready");
    expect(first).toMatchObject({ state: "idle" });
    expect(first?.preview).toBeUndefined();
  });
});

describe("review notes across a frame major update and a Retry", { timeout: TIMEOUT_MS }, () => {
  const CROWDED = "The kicker crowds the headline.";
  const TOO_SMALL = "The number is too small to read.";

  it("keeps a passing unit's note, swaps a failing unit's note for its fallback flag, and keeps a note whose Retry fails", async () => {
    const { core, replay, dir } = await connect();
    const path = await fixtureProject(core, dir, OLDER_MAJOR, { s03: "raw-color" }, { s02: CROWDED, s03: TOO_SMALL });
    const { opened, video } = await openVideo(core, path);

    expect(opened.frameUpdate?.units).toEqual(["s03"]);
    expect(sceneStatuses(opened)).toMatchObject({ s02: "flagged", s03: "fallback" });
    expect((await versionFile(path, 2)).flags.filter(({ unit }) => unit !== "s05")).toEqual([
      { unit: "s02", kind: "review-note", reason: CROWDED },
      { unit: "s03", kind: "fallback", reason: expect.stringContaining("tokens") },
    ]);

    // No code is recorded for s02, so its Retry fails: it keeps playing its code, with its note.
    const stream = await core.video.generation(video);
    await core.video.retry({ ...video, units: ["s02"] });
    let last: GenerationStatus | undefined;

    for await (const status of stream) {
      last = status;

      if (status.state === "done" || status.state === "failed") {
        break;
      }
    }

    // Nothing now passes, so the video stays at its Version, s02 still with its code and note.
    expect(last).toMatchObject({ state: "done", version: 2 });
    expect(last?.units.find(({ id }) => id === "s02")?.status).toBe("flagged");
    expect(replay.asked.map(({ options }) => options.label)).toContain("scene-code s02");
    expect(await readdir(join(path, "horizontal", "versions"))).toEqual(["1.json", "2.json"]);

    const saved = await versionFile(path, 2);
    expect(Object.keys(saved.units)).toEqual(["s01", "s02", "s04"]);
    expect(saved.flags).toContainEqual({ unit: "s02", kind: "review-note", reason: CROWDED });
    expect(saved.flags.filter(({ unit }) => unit === "s02")).toHaveLength(1);
  });
});

describe("opening a video twice at once after a frame major update", { timeout: TIMEOUT_MS }, () => {
  it("re-checks it once and saves one Version", async () => {
    const { core, dir } = await connect();
    const path = await fixtureProject(core, dir, OLDER_MAJOR, { s03: "raw-color" });
    const { project } = await core.project.open({ path });
    const video = { projectId: project.id, format: "horizontal" as const };
    const opens = await Promise.all([core.video.open(video), core.video.open(video)]);

    expect(opens.map(({ version }) => version)).toEqual([2, 2]);
    expect(opens.filter(({ frameUpdate }) => frameUpdate !== undefined)).toHaveLength(1);
    expect(await readdir(join(path, "horizontal", "versions"))).toEqual(["1.json", "2.json"]);
  });
});

describe("opening a Project whose units pass the new frame major", { timeout: TIMEOUT_MS }, () => {
  it("saves no Version, announces nothing, and remembers the check", async () => {
    const { core, replay, dir } = await connect();
    const path = await fixtureProject(core, dir, OLDER_MAJOR);
    const { opened } = await openVideo(core, path);

    expect(opened.frameUpdate).toBeUndefined();
    expect(opened.version).toBe(1);
    expect(replay.asked).toEqual([]);
    expect(await readdir(join(path, "horizontal", "versions"))).toEqual(["1.json"]);
    expect(JSON.parse(await readFile(join(path, "horizontal", "video.json"), "utf8"))).toMatchObject({
      frameChecked: { version: 1, frameContractVersion: FRAME_CONTRACT_VERSION },
    });
  });
});

describe("opening a Project recorded against this frame major", { timeout: TIMEOUT_MS }, () => {
  it("plays its units as saved, without re-checking them", async () => {
    const { core, dir } = await connect();
    const path = await fixtureProject(core, dir, FRAME_CONTRACT_VERSION, { s03: "raw-color" });
    const { opened } = await openVideo(core, path);

    expect(opened.frameUpdate).toBeUndefined();
    expect(opened.version).toBe(1);
    expect(sceneStatuses(opened).s03).toBe("ready");
  });
});

describe("opening a Project with no video yet", () => {
  it("answers with no Version", async () => {
    const { core, dir } = await connect();
    await mkdir(join(dir, "user"), { recursive: true });
    const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]), format: "horizontal" });

    for await (const { state } of await core.project.transcription({ projectId: project.id })) {
      if (state === "done") {
        break;
      }
    }

    await expect(core.video.open({ projectId: project.id, format: "horizontal" })).resolves.toEqual({});
  }, TIMEOUT_MS);
});
