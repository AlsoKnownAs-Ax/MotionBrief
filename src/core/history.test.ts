import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatStatus, CoreClient, Project, UnitCode, VideoRef } from "../contract";
import type { AgentEvent } from "../modules/connector";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { createReplayConnector, type ReplayScript } from "./fixtures/replay-connector";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** The Storyboard of the `stacked` Transcript's first generation: five lone Scenes. */
const storyboard = JSON.parse(await readFile(join(FIXTURES, "generation", "storyboard.json"), "utf8")) as unknown;

async function unitCode(folder: string, variant: string, unit: string): Promise<UnitCode> {
  const dir = join(FIXTURES, folder, variant);
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(dir, `${unit}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/** A turn in which the Revision agent only replies. */
function replies(text: string): AgentEvent[] {
  return [{ type: "turn-completed", status: "completed", text }];
}

const MODEL = randomBytes(1024);

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-history-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** A core replaying `script` in `dir`'s app data and Projects folder; the same `dir` is the same computer after a restart. */
async function startCore(dir: string, script: ReplayScript) {
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

  return { core: createRouterClient(router), replay };
}

/** A core with an open, transcribed Project of the `stacked` Voiceover in 16:9. */
async function connect(script: ReplayScript) {
  const dir = await mkdtemp(join(root, "core-"));
  const { core, replay } = await startCore(dir, script);
  await writeFile(join(dir, "model.bin"), MODEL);
  await core.transcriptionModel.import({ path: join(dir, "model.bin") });

  for await (const { state } of await core.transcriptionModel.watch()) {
    if (state === "ready") {
      break;
    }
  }

  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      break;
    }
  }

  return { dir, core, replay, project, video: { projectId: project.id, format: "horizontal" } satisfies VideoRef };
}

/** Saves a Version of the Project's 16:9 video straight into its folder, as a run would leave it. */
async function saved(project: Project, number: number, code: Record<string, UnitCode>) {
  const video = join(project.path, "horizontal");
  await mkdir(join(video, "units"), { recursive: true });
  await mkdir(join(video, "versions"), { recursive: true });
  const units: Record<string, string> = {};

  for (const [unit, unitCodeOf] of Object.entries(code)) {
    const text = `${JSON.stringify(unitCodeOf, null, 2)}\n`;
    const hash = createHash("sha256").update(text).digest("hex");
    await writeFile(join(video, "units", `${hash}.json`), text);
    units[unit] = hash;
  }

  const version = {
    storyboard,
    preset: bundledPreset("blueprint"),
    captions: false,
    units,
    flags: [{ unit: "s05", kind: "fallback", reason: "[contract MISSING_ELEMENT] It never appears." }],
    models: { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5" },
    frameContractVersion: "1.0.0",
    version: number,
    createdAt: `2026-10-04T12:0${number}:00.000Z`,
    origin: "generation",
  };
  await writeFile(join(video, "versions", `${number}.json`), `${JSON.stringify(version, null, 2)}\n`);

  return units;
}

/** Version 1 with `good` code in s01–s04, and Version 2 with s04's early-definition variant. */
async function twoVersions(project: Project) {
  const good = Object.fromEntries(await Promise.all(["s01", "s02", "s03", "s04"].map(async (unit) => [unit, await unitCode("generation", "good", unit)] as const)));
  const v1 = await saved(project, 1, good);
  const v2 = await saved(project, 2, { ...good, s04: await unitCode("revision", "early-definition", "s04") });

  return { v1, v2 };
}

async function readVersion(project: Project, number: number) {
  return JSON.parse(await readFile(join(project.path, "horizontal", "versions", `${number}.json`), "utf8")) as Record<string, unknown>;
}

/** The video's chat as it streams, and a way to wait for a state of it. */
async function watchChat(core: CoreClient, video: VideoRef) {
  let latest: ChatStatus | undefined;
  const waiters: { matches: (status: ChatStatus) => boolean; resolve: (status: ChatStatus) => void }[] = [];
  const stop = new AbortController();

  void (async () => {
    for await (const status of await core.video.chat(video, { signal: stop.signal })) {
      latest = status;
      waiters.filter(({ matches }) => matches(status)).forEach(({ resolve }) => resolve(status));
    }
  })().catch(() => undefined);

  const until = (matches: (status: ChatStatus) => boolean) =>
    new Promise<ChatStatus>((resolve) => {
      if (latest && matches(latest)) {
        resolve(latest);
        return;
      }

      waiters.push({ matches, resolve });
    });
  await until(() => true);

  return { until, stop: () => stop.abort() };
}

function states({ entries }: ChatStatus) {
  return entries.map(({ message, state }) => [message, state]);
}

const isSettled = (status: ChatStatus) => status.entries.every(({ state }) => state !== "queued" && state !== "running");

describe("Versions", () => {
  it("lists them newest first, and Restore adds the chosen one on top, sharing its units", async () => {
    const { core, project, video } = await connect({});
    const { v1 } = await twoVersions(project);
    const unitFiles = await readdir(join(project.path, "horizontal", "units"));

    expect((await core.video.versions(video)).map(({ version, origin }) => [version, origin])).toEqual([
      [2, "generation"],
      [1, "generation"],
    ]);

    expect(await core.video.restore({ ...video, version: 1 })).toEqual({ version: 3 });
    const restored = await readVersion(project, 3);
    const first = await readVersion(project, 1);

    expect(restored).toMatchObject({ origin: "restore", restoredFrom: 1, units: v1, storyboard: first.storyboard, flags: first.flags });
    expect(await readdir(join(project.path, "horizontal", "units"))).toEqual(unitFiles);
    expect(await core.video.versions(video)).toMatchObject([{ version: 3, origin: "restore", restoredFrom: 1, fallbacks: 1 }, { version: 2 }, { version: 1 }]);
    expect(await core.video.open(video)).toMatchObject({ version: 3 });

    const chat = await watchChat(core, video);
    expect((await chat.until(() => true)).entries).toMatchObject([{ kind: "restore", restoredFrom: 1, version: 3 }]);
    chat.stop();
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("keeps the Transcript's word fixes when restoring", async () => {
    const { core, project, video } = await connect({});
    await twoVersions(project);
    const fixed = await core.project.fixWord({ projectId: project.id, index: 0, text: "Kashing" });

    await core.video.restore({ ...video, version: 1 });
    const opened = await core.video.open(video);

    expect(opened.version).toBe(3);
    expect(opened.preview?.timeline.words[0]?.text).toBe(fixed.text);
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("refuses a Version the video doesn't have", async () => {
    const { core, project, video } = await connect({});
    await twoVersions(project);

    await expect(core.video.restore({ ...video, version: 9 })).rejects.toMatchObject({ code: "UNKNOWN_VERSION", data: { version: 9 } });
    await core.project.close({ projectId: project.id });
  }, 60_000);
});

describe("the chat", () => {
  it("runs one Revision at a time, queueing what is sent meanwhile, in an append-only log", async () => {
    const { core, replay, project, video } = await connect({ revision: [replies("First."), replies("Second.")] });
    await twoVersions(project);
    replay.hold("revision");
    const chat = await watchChat(core, video);

    const first = await core.video.send({ ...video, message: "Which Scene is the cache?", scope: [] });
    const second = await core.video.send({ ...video, message: "And the outro?", scope: ["s05"] });
    const busy = await chat.until(({ entries }) => entries.length === 2);
    const log = await readFile(join(project.path, "horizontal", "chat.jsonl"), "utf8");

    expect(first.state).toBe("running");
    expect(second).toMatchObject({ state: "queued", scope: ["s05"] });
    expect(states(busy)).toEqual([
      ["Which Scene is the cache?", "running"],
      ["And the outro?", "queued"],
    ]);
    await expect(core.video.restore({ ...video, version: 1 })).rejects.toMatchObject({ code: "BUSY" });

    replay.release("revision");
    const settled = await chat.until(isSettled);
    chat.stop();

    expect(settled.entries).toMatchObject([
      { state: "answered", reply: "First." },
      { state: "answered", reply: "Second." },
    ]);
    expect(replay.askedOf("revision")).toHaveLength(2);
    expect((await readFile(join(project.path, "horizontal", "chat.jsonl"), "utf8")).startsWith(log)).toBe(true);
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("queues what is sent during the first generation, and runs it once the generation ends", async () => {
    const { core, replay, project, video } = await connect({ storyboard: [replies("Planning.")], revision: [replies("Sure.")] });
    replay.hold("storyboard");
    await core.video.generate(video);
    const chat = await watchChat(core, video);

    const sent = await core.video.send({ ...video, message: "Make it punchier", scope: [] });
    expect(sent.state).toBe("queued");

    // The generation ends with no video, so the queued request can't run as a Revision.
    const stopped = core.video.stop(video);
    replay.release("storyboard");
    await stopped;
    const settled = await chat.until(isSettled);
    chat.stop();

    expect(settled.entries).toMatchObject([{ message: "Make it punchier", state: "refused", refused: "NOT_GENERATED" }]);
    expect(replay.askedOf("revision")).toHaveLength(0);
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("pauses the queue when a Revision is stopped, until Resume queue", async () => {
    const { core, replay, project, video } = await connect({ revision: [replies("Stopped one."), replies("Second.")] });
    await twoVersions(project);
    replay.hold("revision");
    const chat = await watchChat(core, video);
    await core.video.send({ ...video, message: "One", scope: [] });
    await core.video.send({ ...video, message: "Two", scope: [] });

    await core.video.stopRevision(video);
    const paused = await chat.until(({ entries }) => entries[0]?.state === "stopped");
    replay.release("revision");
    await expect.poll(() => replay.sessions().open).toBe(0);

    expect(paused.isPaused).toBe(true);
    expect(states(paused)).toEqual([
      ["One", "stopped"],
      ["Two", "queued"],
    ]);
    expect(replay.askedOf("revision").filter(({ message }) => message.includes("Two"))).toEqual([]);

    await core.video.resumeQueue(video);
    const settled = await chat.until(isSettled);
    chat.stop();

    expect(settled).toMatchObject({ isPaused: false, entries: [{ state: "stopped" }, { state: "answered" }] });
    await core.project.close({ projectId: project.id });
  }, 60_000);

  it("reopens after a crash with queued requests paused behind Resume queue, and the running one discarded", async () => {
    const { dir, core, replay, project, video } = await connect({ revision: [replies("Never heard.")] });
    await twoVersions(project);
    replay.hold("revision");
    await core.video.send({ ...video, message: "One", scope: [] });
    await core.video.send({ ...video, message: "Two", scope: ["s02"] });

    // The app dies: a new core on the same computer opens the Project with the old lock still in place.
    const restarted = await startCore(dir, { revision: [replies("Done now.")] });
    await restarted.core.project.open({ path: project.path, force: true });
    const chat = await watchChat(restarted.core, video);
    const reopened = await chat.until(() => true);

    expect(reopened.isPaused).toBe(true);
    expect(states(reopened)).toEqual([
      ["One", "closed"],
      ["Two", "queued"],
    ]);
    expect(restarted.replay.askedOf("revision")).toHaveLength(0);
    expect(await restarted.core.video.versions(video)).toHaveLength(2);

    await restarted.core.video.resumeQueue(video);
    const settled = await chat.until(isSettled);
    chat.stop();
    replay.release("revision");

    expect(settled.entries[1]).toMatchObject({ message: "Two", scope: ["s02"], state: "answered", reply: "Done now." });
    await restarted.core.project.close({ projectId: project.id });
  }, 60_000);
});
