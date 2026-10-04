import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, GenerationStatus, Project, UnitCode, VideoRef } from "../contract";
import type { AgentEvent, ConnectionStatus } from "../modules/connector";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { createReplayConnector, type ReplayScript } from "./fixtures/replay-connector";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture, type FakeWhisper } from "./test-support/whisper";

const FIXTURES = join(import.meta.dirname, "fixtures", "generation");

/** The Storyboard the replayed agent writes for the `stacked` Transcript: five lone Scenes. */
const storyboard = JSON.parse(await readFile(join(FIXTURES, "storyboard.json"), "utf8")) as { scenes: { id: string }[] };

/** Its first try, whose last Scene runs past the 10 s a horizontal Scene may last. */
const tooLong = JSON.parse(await readFile(join(FIXTURES, "storyboard-too-long.json"), "utf8")) as unknown;

/** Committed Scene code: `good` passes every check, the other variants each fail one. */
async function unitCode(variant: "good" | "raw-color" | "missing-element" | "page-error", unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(FIXTURES, variant, `${unit}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/** A turn in which the agent hands in a Storyboard through its host tool. */
function submitsStoryboard(submitted: unknown): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_storyboard", name: "mcp__motionbrief__submit_storyboard", input: { storyboard: submitted } },
    { type: "turn-completed", status: "completed", text: "Submitted the Storyboard." },
  ];
}

/** A turn in which a Scene-code subagent hands in its unit's code through its host tool. */
function submitsCode(code: UnitCode): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_code", name: "mcp__motionbrief__submit_scene_code", input: code },
    { type: "turn-completed", status: "completed", text: "Submitted the Scene code." },
  ];
}

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-generation-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

type Setup = { script: ReplayScript; status?: ConnectionStatus; whisper?: FakeWhisper };

/** A core on its own folders with the transcription model installed, an agent replaying `script` and the `stacked` Transcript. */
async function connect({ script, status, whisper }: Setup) {
  const dir = await mkdtemp(join(root, "core-"));
  const replay = createReplayConnector(script, status);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: createHash("sha256").update(MODEL).digest("hex"), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: join(dir, "app-data"),
    projectsDir: join(dir, "Projects"),
    cacheDir: join(dir, "cache"),
    modelPin,
    adapters: { connector: replay.connector, whisper: whisper ?? fakeWhisper(await whisperFixture("stacked", 1)) },
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

/** A Project of the 33.6 s Voiceover the `stacked` fixture was transcribed from, in Blueprint and 16:9. */
async function newProject(core: CoreClient, dir: string, { transcribed = true } = {}): Promise<Project> {
  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  if (!transcribed) {
    return project;
  }

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return project;
    }
  }

  throw new Error("The transcription stream ended");
}

/** Every status a video's generation streams, and a way to wait for one; resolves once the first has come. */
async function watch(core: CoreClient, video: VideoRef) {
  const statuses: GenerationStatus[] = [];
  const waiters: { matches: (status: GenerationStatus) => boolean; resolve: (status: GenerationStatus) => void }[] = [];
  const stop = new AbortController();

  void (async () => {
    for await (const status of await core.video.generation(video, { signal: stop.signal })) {
      statuses.push(status);
      waiters.filter(({ matches }) => matches(status)).forEach(({ resolve }) => resolve(status));
    }
  })().catch(() => undefined);

  const until = (matches: (status: GenerationStatus) => boolean) =>
    new Promise<GenerationStatus>((resolve) => {
      const seen = statuses.find(matches);

      if (seen) {
        resolve(seen);
        return;
      }

      waiters.push({ matches, resolve });
    });
  await until(() => true);

  return { statuses, until, stop: () => stop.abort() };
}

function unitStatuses(status: GenerationStatus) {
  return Object.fromEntries(status.units.map(({ id, status: unitStatus }) => [id, unitStatus]));
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

const UNITS = ["s01", "s02", "s03", "s04", "s05"];

// Every unit is checked in the pinned chrome-headless-shell, each check taking seconds.
const RUN_TIMEOUT_MS = 300_000;

// Making and transcribing a Project takes a few seconds while the other test files run.
const PROJECT_TIMEOUT_MS = 60_000;

describe("first generation", () => {
  let core: CoreClient;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let project: Project;
  let video: VideoRef;
  let askedBeforeGenerate: number;
  let fourAtATime: { status: GenerationStatus; open: number };
  let progressive: { status: GenerationStatus; storedUnits: string[] };
  let done: GenerationStatus;
  let statuses: GenerationStatus[];

  beforeAll(async () => {
    const missingCta = await unitCode("missing-element", "s05");
    const script = {
      storyboard: [submitsStoryboard(tooLong), submitsStoryboard(storyboard)],
      "scene-code s01": [submitsCode(await unitCode("good", "s01"))],
      // Its page error names no unit, but a page without it has none: fixed on its first retry.
      "scene-code s02": [submitsCode(await unitCode("page-error", "s02")), submitsCode(await unitCode("good", "s02"))],
      // Fixed on its first retry.
      "scene-code s03": [submitsCode(await unitCode("raw-color", "s03")), submitsCode(await unitCode("good", "s03"))],
      "scene-code s04": [submitsCode(await unitCode("good", "s04"))],
      // Still failing after both retries.
      "scene-code s05": Array.from({ length: 3 }, () => submitsCode(missingCta)),
    };
    const connected = await connect({ script });
    ({ core, replay } = connected);
    project = await newProject(core, connected.dir);
    video = { projectId: project.id, format: "horizontal" };
    askedBeforeGenerate = replay.asked.length;
    UNITS.forEach((unit) => replay.hold(`scene-code ${unit}`));
    const generation = await watch(core, video);
    statuses = generation.statuses;

    await core.video.generate({ ...video, approved: true });

    // Every subagent is held: four start, the fifth waits for one of them to finish.
    const busy = await generation.until((status) => status.units.filter((unit) => unit.status === "writing").length === 4);
    fourAtATime = { status: busy, open: replay.sessions().open };
    ["s01", "s02", "s03", "s04"].forEach((unit) => replay.release(`scene-code ${unit}`));

    const fifth = await generation.until((status) => {
      const units = unitStatuses(status);

      return ["s01", "s02", "s03", "s04"].every((unit) => units[unit] === "ready") && units.s05 === "writing";
    });
    progressive = { status: fifth, storedUnits: await readdir(join(project.path, "horizontal", "units")) };
    replay.release("scene-code s05");

    done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();
  }, RUN_TIMEOUT_MS);

  afterAll(() => core?.project.close({ projectId: project.id }));

  it("starts only when Generate is pressed", () => {
    expect(askedBeforeGenerate).toBe(0);
    expect(statuses[0]).toMatchObject({ state: "idle", units: [] });
  });

  it("shows how long it will take first, and on an API key what it will cost", async () => {
    // 33.6 s of Voiceover at 7-9 minutes and $3-5 per minute of video.
    expect(await core.video.estimate(video)).toEqual({ minutes: { low: 4, high: 6 }, costUsd: { low: 1.68, high: 2.8 }, needsApproval: true });
  });

  it("plans a Storyboard and retries it with the validator's issues, with no approval before the Scenes are written", () => {
    const turns = replay.askedOf("storyboard");

    expect(turns).toHaveLength(2);
    expect(turns[0]?.options.model).toBe("claude-opus-5-5");
    expect([...new Set(statuses.map(({ state }) => state))]).toEqual(["idle", "planning", "writing", "done"]);
  });

  it("writes each unit's Scene code with its own subagent, 4 at a time", () => {
    expect(unitStatuses(fourAtATime.status)).toEqual({ s01: "writing", s02: "writing", s03: "writing", s04: "writing", s05: "queued" });
    expect(fourAtATime.open).toBe(4);
    expect(replay.sessions().mostOpen).toBe(4);
    expect(UNITS.map((unit) => replay.askedOf(`scene-code ${unit}`)[0]?.options.model)).toEqual(UNITS.map(() => "claude-opus-5-5"));
  });

  it("retries a unit the Checker finds fault with", () => {
    expect(replay.askedOf("scene-code s03")).toHaveLength(2);
    expect(done.units.find(({ id }) => id === "s03")).toEqual({ id: "s03", status: "ready", attempts: 2 });
  });

  it("retries a unit whose code makes the page fail, even when the error names no unit", () => {
    expect(replay.askedOf("scene-code s02")).toHaveLength(2);
    expect(done.units.find(({ id }) => id === "s02")).toEqual({ id: "s02", status: "ready", attempts: 2 });
  });

  it("makes a unit that still fails after 2 retries a fallback Scene", () => {
    expect(replay.askedOf("scene-code s05")).toHaveLength(3);
    expect(done.units.find(({ id }) => id === "s05")).toEqual({ id: "s05", status: "fallback", attempts: 3 });
    expect(done.preview?.timeline.scenes.map(({ id, status }) => [id, status])).toEqual([
      ["s01", "ready"],
      ["s02", "ready"],
      ["s03", "ready"],
      ["s04", "ready"],
      ["s05", "fallback"],
    ]);
  });

  it("plays the video as units finish, with the units still being written as the Storyboard animatic", async () => {
    const preview = progressive.status.preview;
    const animatic = await fetch(new URL("compositions/s05.html", preview?.url)).then((response) => response.text());

    expect(preview?.timeline.scenes.map(({ status }) => status)).toEqual(["ready", "ready", "ready", "ready", "writing"]);
    expect(animatic).toContain('id="s05-headline"');
    expect(animatic).toContain('id="s05-cta"');
  });

  it("writes each unit to the Project's content-addressed store as soon as it finishes", async () => {
    const good = await Promise.all(["s01", "s02", "s03", "s04"].map((unit) => unitCode("good", unit)));
    const stored = await Promise.all(progressive.storedUnits.map(async (file) => readFile(join(project.path, "horizontal", "units", file), "utf8")));

    expect(progressive.storedUnits.sort()).toEqual(stored.map((text) => `${sha256(text)}.json`).sort());
    expect(stored.map((text) => JSON.parse(text) as UnitCode)).toEqual(expect.arrayContaining(good));
    expect(stored).toHaveLength(4);
  });

  it("saves the result as Version 1, with its Storyboard, Style Preset snapshot, unit hashes, flags, models and frame contract version", async () => {
    const saved = JSON.parse(await readFile(join(project.path, "horizontal", "versions", "1.json"), "utf8")) as Record<string, unknown> & {
      units: Record<string, string>;
    };
    const units = await Promise.all(Object.values(saved.units).map((hash) => readFile(join(project.path, "horizontal", "units", `${hash}.json`), "utf8")));

    expect(done).toMatchObject({ state: "done", version: 1 });
    expect(saved).toMatchObject({
      version: 1,
      origin: "generation",
      storyboard,
      preset: bundledPreset("blueprint"),
      captions: false,
      flags: [{ unit: "s05", kind: "fallback", reason: expect.stringContaining("MISSING_ELEMENT") }],
      models: { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5" },
      frameContractVersion: "1.0.0",
    });
    expect(Object.keys(saved.units).sort()).toEqual(["s01", "s02", "s03", "s04"]);
    expect(units.map((text) => JSON.parse(text) as UnitCode)).toEqual(await Promise.all(["s01", "s02", "s03", "s04"].map((unit) => unitCode("good", unit))));
    // The generation in progress is gone once its Version is saved.
    expect((await readdir(join(project.path, "horizontal"))).sort()).toEqual(["units", "versions"]);
  });

  it("refuses to generate a video that exists", async () => {
    await expect(core.video.generate(video)).rejects.toMatchObject({ code: "ALREADY_GENERATED", data: { version: 1 } });
  });
});

describe("a generation", { timeout: PROJECT_TIMEOUT_MS }, () => {
  it(
    "fails with the issues of a Storyboard that is still invalid after 2 retries, leaving no video",
    async () => {
      const { core, replay, dir } = await connect({ script: { storyboard: Array.from({ length: 4 }, () => submitsStoryboard(tooLong)) } });
      const project = await newProject(core, dir);
      const video: VideoRef = { projectId: project.id, format: "horizontal" };
      const generation = await watch(core, video);

      await core.video.generate({ ...video, approved: true });
      const failed = await generation.until(({ state }) => state === "done" || state === "failed");
      generation.stop();

      expect(failed).toMatchObject({ state: "failed", error: { code: "STORYBOARD_INVALID", issues: [expect.objectContaining({ code: "PACING", sceneId: "s04" })] } });
      expect(replay.askedOf("storyboard")).toHaveLength(3);
      expect(replay.asked.filter(({ options }) => options.label !== "storyboard")).toEqual([]);
      expect(await readdir(project.path)).not.toContain("horizontal");
      await core.project.close({ projectId: project.id });
    },
    RUN_TIMEOUT_MS,
  );

  it("fails when the Storyboard agent can't run, such as when Claude isn't connected", async () => {
    const { core, dir } = await connect({ script: { storyboard: [[{ type: "turn-completed", status: "failed", error: { code: "AUTHENTICATION_FAILED", message: "Log in" } }]] } });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    const generation = await watch(core, video);

    await core.video.generate({ ...video, approved: true });
    const failed = await generation.until(({ state }) => state === "failed");
    generation.stop();

    expect(failed.error).toEqual({ code: "AGENT_FAILED", error: { code: "AUTHENTICATION_FAILED", message: "Log in" } });
    await core.project.close({ projectId: project.id });
  });

  it("says why the video so far can't be shown, and still saves it", async () => {
    // No recorded Scene code: every unit becomes a fallback Scene without being checked.
    const { core, dir } = await connect({ script: { storyboard: [submitsStoryboard(storyboard)] } });
    const project = await newProject(core, dir);
    const video: VideoRef = { projectId: project.id, format: "horizontal" };
    const { voiceover: copy } = JSON.parse(await readFile(join(project.path, "project.json"), "utf8")) as { voiceover: { file: string } };
    await rm(join(project.path, copy.file));
    const generation = await watch(core, video);

    await core.video.generate({ ...video, approved: true });
    const done = await generation.until(({ state }) => state === "done" || state === "failed");
    generation.stop();

    expect(done).toMatchObject({ state: "done", version: 1, previewError: { code: "VOICEOVER_MISSING" } });
    expect(done.preview).toBeUndefined();
    await core.project.close({ projectId: project.id });
  });

  it("waits for the Transcript", async () => {
    const whisper = fakeWhisper(await whisperFixture("stacked", 1));
    whisper.holdFrom(0);
    const { core, dir } = await connect({ script: {}, whisper });
    const project = await newProject(core, dir, { transcribed: false });

    await expect(core.video.generate({ projectId: project.id, format: "horizontal" })).rejects.toMatchObject({ code: "TRANSCRIPT_NOT_READY" });
    whisper.release();
    await core.project.close({ projectId: project.id });
  });

  it("estimates no cost on a subscription, which isn't billed per run", async () => {
    const { core, dir } = await connect({ script: {}, status: { isConnected: true, method: "subscription" } });
    const project = await newProject(core, dir);

    expect(await core.video.estimate({ projectId: project.id, format: "horizontal" })).toEqual({ minutes: { low: 4, high: 6 }, needsApproval: false });
    await core.project.close({ projectId: project.id });
  });

  it("needs an open Project", async () => {
    const { core } = await connect({ script: {} });

    await expect(core.video.generate({ projectId: "nope", format: "horizontal" })).rejects.toMatchObject({ code: "UNKNOWN_PROJECT" });
  });
});
