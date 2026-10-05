import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import type { CoreClient, GenerationStatus, Project, UnitCode, VideoRef } from "../../contract";
import type { AgentEvent, ConnectionStatus, Connector } from "../../modules/connector";
import { createCore } from "../composition-root";
import { createReplayConnector, type ReplayScript } from "../fixtures/replay-connector";
import { voiceover } from "./media";
import { fakeWhisper, whisperFixture, type FakeWhisper } from "./whisper";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "generation");

/** The Storyboard the replayed agent writes for the `stacked` Transcript: five lone Scenes, s01 to s05. */
export const storyboard = JSON.parse(await readFile(join(FIXTURES, "storyboard.json"), "utf8")) as { scenes: { id: string }[] };

/** Committed Scene code: `good` and `repaired` pass every check, the other variants each fail one. */
export async function unitCode(variant: "good" | "repaired" | "raw-color" | "missing-element" | "page-error", unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(FIXTURES, variant, `${unit}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

/** A turn in which the agent hands in a Storyboard through its host tool. */
export function submitsStoryboard(submitted: unknown, ...events: AgentEvent[]): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_storyboard", name: "mcp__motionbrief__submit_storyboard", input: { storyboard: submitted } },
    ...events,
    { type: "turn-completed", status: "completed", text: "Submitted the Storyboard." },
  ];
}

/** A turn in which a Scene-code subagent hands in its unit's code through its host tool. */
export function submitsCode(code: UnitCode): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_code", name: "mcp__motionbrief__submit_scene_code", input: code },
    { type: "turn-completed", status: "completed", text: "Submitted the Scene code." },
  ];
}

/** A turn in which the visual reviewer hands in its verdict through its host tool. */
export function submitsReview(review: { looksRight: boolean; problems: string[]; note: string }): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_review", name: "mcp__motionbrief__submit_review", input: review },
    { type: "turn-completed", status: "completed", text: "Submitted the review." },
  ];
}

/** A turn the connector ends with an error, such as a plan limit or a failed login. */
export function failsWith(error: Extract<AgentEvent, { type: "turn-completed" }>["error"]): AgentEvent[] {
  return [{ type: "turn-completed", status: "failed", error }];
}

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

type Setup = {
  root: string;
  script: ReplayScript;
  status?: ConnectionStatus;
  whisper?: FakeWhisper;
  /** Changes how the replaying connector behaves, such as making some sessions throw. */
  wrap?: (connector: Connector) => Connector;
  /** The folders of an earlier core, to stand in for the app started again. */
  dir?: string;
  /** App data shared with another core, such as Settings and usage. */
  appDataDir?: string;
};

/**
 * A core on its own folders under `root` (or `dir`'s) with the transcription model installed, an agent replaying
 * `script` and the `stacked` Transcript.
 */
export async function connect({ root, script, status, whisper, wrap = (connector) => connector, dir, appDataDir }: Setup) {
  const coreDir = dir ?? (await mkdtemp(join(root, "core-")));
  const replay = createReplayConnector(script, status);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: sha256(MODEL), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: appDataDir ?? join(coreDir, "app-data"),
    projectsDir: join(coreDir, "Projects"),
    cacheDir: join(coreDir, "cache"),
    modelPin,
    adapters: { connector: wrap(replay.connector), whisper: whisper ?? fakeWhisper(await whisperFixture("stacked", 1)) },
  });
  const core = createRouterClient(router);
  const model = join(coreDir, "model.bin");
  await writeFile(model, MODEL);
  await core.transcriptionModel.import({ path: model });

  for await (const { state } of await core.transcriptionModel.watch()) {
    if (state === "ready") {
      break;
    }
  }

  return { core, replay, dir: coreDir };
}

/** A transcribed Project of the 33.6 s Voiceover the `stacked` fixture was transcribed from, in Blueprint and 16:9. */
export async function newProject(core: CoreClient, dir: string): Promise<Project> {
  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return project;
    }
  }

  throw new Error("The transcription stream ended");
}

/** Generates the video and resolves with its last status once it is done or failed. */
export async function generate(core: CoreClient, video: VideoRef): Promise<GenerationStatus> {
  const stop = new AbortController();
  const statuses = await core.video.generation(video, { signal: stop.signal });
  await statuses.next();
  // The replay connector is an API key, where a first generation waits for approval by default.
  await core.video.generate({ ...video, approved: true });

  try {
    for await (const status of statuses) {
      if (status.state === "done" || status.state === "failed") {
        return status;
      }
    }
  } finally {
    stop.abort();
  }

  throw new Error("The generation stream ended");
}

/** Every status a video's generation streams, and a way to wait for one; resolves once the first has come. */
export async function watch(core: CoreClient, video: VideoRef) {
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
  /** Like `until`, but only for statuses still to come. */
  const next = (matches: (status: GenerationStatus) => boolean) => new Promise<GenerationStatus>((resolve) => waiters.push({ matches, resolve }));
  await until(() => true);

  return { statuses, until, next, stop: () => stop.abort() };
}

export function unitStatuses(status: GenerationStatus) {
  return Object.fromEntries(status.units.map(({ id, status: unitStatus }) => [id, unitStatus]));
}

export function sha256(data: string | Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

/** Everything a stream yields, and a way to wait for an item; resolves once the first has come. */
export async function follow<T>(open: (signal: AbortSignal) => Promise<AsyncIterable<T>>) {
  const items: T[] = [];
  const waiters: { matches: (item: T) => boolean; resolve: (item: T) => void }[] = [];
  const stop = new AbortController();

  void (async () => {
    for await (const item of await open(stop.signal)) {
      items.push(item);
      waiters.filter(({ matches }) => matches(item)).forEach(({ resolve }) => resolve(item));
    }
  })().catch(() => undefined);

  const until = (matches: (item: T) => boolean) =>
    new Promise<T>((resolve) => {
      const seen = items.find(matches);

      if (seen) {
        resolve(seen);
        return;
      }

      waiters.push({ matches, resolve });
    });
  await until(() => true);

  return { items, until, stop: () => stop.abort() };
}
