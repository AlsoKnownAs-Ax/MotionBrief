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
export function submitsStoryboard(submitted: unknown): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_storyboard", name: "mcp__motionbrief__submit_storyboard", input: { storyboard: submitted } },
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

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

type Setup = {
  root: string;
  script: ReplayScript;
  status?: ConnectionStatus;
  whisper?: FakeWhisper;
  /** Changes how the replaying connector behaves, such as making some sessions throw. */
  wrap?: (connector: Connector) => Connector;
};

/** A core on its own folders under `root` with the transcription model installed, an agent replaying `script` and the `stacked` Transcript. */
export async function connect({ root, script, status, whisper, wrap = (connector) => connector }: Setup) {
  const dir = await mkdtemp(join(root, "core-"));
  const replay = createReplayConnector(script, status);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: sha256(MODEL), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: join(dir, "app-data"),
    projectsDir: join(dir, "Projects"),
    cacheDir: join(dir, "cache"),
    modelPin,
    adapters: { connector: wrap(replay.connector), whisper: whisper ?? fakeWhisper(await whisperFixture("stacked", 1)) },
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
  await core.video.generate(video);

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

export function sha256(data: string | Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}
