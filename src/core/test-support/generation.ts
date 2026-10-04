import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import type { CoreClient, Project } from "../../contract";
import type { AgentEvent, ConnectionStatus } from "../../modules/connector";
import { createCore } from "../composition-root";
import { createReplayConnector, type ReplayScript } from "../fixtures/replay-connector";
import { voiceover } from "./media";
import { fakeWhisper, whisperFixture } from "./whisper";

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

/** A turn in which the agent hands in a Storyboard through its host tool. */
export function submitsStoryboard(submitted: unknown, ...events: AgentEvent[]): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_storyboard", name: "mcp__motionbrief__submit_storyboard", input: { storyboard: submitted } },
    ...events,
    { type: "turn-completed", status: "completed", text: "Submitted the Storyboard." },
  ];
}

type CoreSetup = { root: string; script: ReplayScript; status?: ConnectionStatus; appDataDir?: string };

/** A core on its own folders with the transcription model installed, an agent replaying `script` and the `stacked` Transcript. */
export async function connectCore({ root, script, status, appDataDir }: CoreSetup) {
  const dir = await mkdtemp(join(root, "core-"));
  const replay = createReplayConnector(script, status);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: createHash("sha256").update(MODEL).digest("hex"), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir: appDataDir ?? join(dir, "app-data"),
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

/** A transcribed Project of the 33.6 s Voiceover the `stacked` fixture was transcribed from, in Blueprint and 16:9. */
export async function transcribedProject(core: CoreClient, dir: string): Promise<Project> {
  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return project;
    }
  }

  throw new Error("The transcription stream ended");
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
