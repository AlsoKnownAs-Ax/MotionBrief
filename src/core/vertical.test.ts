import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaptionStyle, CoreClient, GenerationStatus, OpenedVideo, Project, VideoRef, VideoSource } from "../contract";
import type { AgentEvent } from "../modules/connector";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { createReplayConnector, type ReplayScript } from "./fixtures/replay-connector";
import words from "./fixtures/storyboard/transcript.json";
import verticalCaptions from "./fixtures/storyboard/vertical-captions.json";
import { connect as checkerCore, RULES } from "./test-support/checker";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

const FIXTURES = join(import.meta.dirname, "fixtures", "generation");

/** What the replayed agent plans for the `stacked` Transcript: five Scenes in 16:9, eight shorter ones in 9:16 with Captions-length copy. */
const horizontal = JSON.parse(await readFile(join(FIXTURES, "storyboard.json"), "utf8")) as unknown;
const vertical = JSON.parse(await readFile(join(FIXTURES, "storyboard-vertical.json"), "utf8")) as unknown;

function submitsStoryboard(submitted: unknown): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_storyboard", name: "mcp__motionbrief__submit_storyboard", input: { storyboard: submitted } },
    { type: "turn-completed", status: "completed", text: "Submitted the Storyboard." },
  ];
}

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

// Making and transcribing a Project, then generating two videos of fallback Scenes, takes a while beside the other files.
const RUN_TIMEOUT_MS = 180_000;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-vertical-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** A core with the transcription model installed and an agent replaying `script`; no Scene code is recorded, so every unit is a fallback Scene. */
async function connect(script: ReplayScript) {
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

/** A Project of the 33.6 s Voiceover the `stacked` fixture was transcribed from, once its Transcript is done. */
async function newProject(core: CoreClient, dir: string): Promise<Project> {
  await mkdir(join(dir, "user"), { recursive: true });
  const project = await core.project.create({ voiceoverPath: await voiceover(join(dir, "user"), "Caching.wav", [{ tone: 33.6 }]) });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return project;
    }
  }

  throw new Error("The transcription stream ended");
}

/** Presses Generate and waits for the generation to end. */
async function generate(core: CoreClient, video: VideoRef): Promise<GenerationStatus> {
  const stop = new AbortController();
  const statuses = await core.video.generation(video, { signal: stop.signal });
  await core.video.generate({ ...video, approved: true });

  for await (const status of statuses) {
    if (status.state === "done" || status.state === "failed") {
      stop.abort();
      return status;
    }
  }

  throw new Error("The generation stream ended");
}

type SavedVersion = { version: number; preset: unknown; captions: boolean; storyboard: unknown };

async function savedVersions(project: Project, format: string): Promise<SavedVersion[]> {
  const names = (await readdir(join(project.path, format, "versions"))).sort();

  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(project.path, format, "versions", name), "utf8")) as SavedVersion));
}

/** The root composition a preview serves. */
function pageOf({ preview }: OpenedVideo): Promise<string> {
  return fetch(preview!.url).then((response) => response.text());
}

describe("the 9:16 version of a Project", () => {
  let core: CoreClient;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let project: Project;
  const wide: VideoRef = { projectId: "", format: "horizontal" };
  const tall: VideoRef = { projectId: "", format: "vertical" };
  let beforeSibling: OpenedVideo;
  let wideDone: GenerationStatus;
  let tallDone: GenerationStatus;

  beforeAll(async () => {
    const connected = await connect({ storyboard: [submitsStoryboard(horizontal), submitsStoryboard(vertical)] });
    ({ core, replay } = connected);
    project = await newProject(core, connected.dir);
    wide.projectId = project.id;
    tall.projectId = project.id;

    wideDone = await generate(core, wide);
    beforeSibling = await core.video.open(tall);
    // The Project's own choice moves on; the sibling still copies the 16:9 video's snapshot.
    await core.project.update({ projectId: project.id, stylePreset: "whiteboard" });
    tallDone = await generate(core, tall);
  }, RUN_TIMEOUT_MS);

  afterAll(() => core?.project.close({ projectId: project.id }));

  it("doesn't exist until it is generated", () => {
    expect(wideDone).toMatchObject({ state: "done", version: 1 });
    expect(beforeSibling).toEqual({});
  });

  it("is a generation of its own, with its own Storyboard laid out for vertical, not a Revision of the 16:9 video", async () => {
    const [wideVersions, tallVersions] = await Promise.all([savedVersions(project, "horizontal"), savedVersions(project, "vertical")]);

    // A later Storyboard session replays the turns after the earlier one's: the 9:16 one hands in the vertical Storyboard.
    expect(tallDone).toMatchObject({ state: "done", version: 1 });
    expect(replay.askedOf("storyboard")).toHaveLength(2);
    expect(tallVersions).toMatchObject([{ version: 1, origin: "generation", storyboard: vertical }]);
    expect(wideVersions).toMatchObject([{ version: 1, origin: "generation", storyboard: horizontal }]);
    expect(tallDone.preview?.timeline).toMatchObject({ format: "vertical", width: 1080, height: 1920 });
    expect(tallDone.preview?.timeline.scenes).toHaveLength(8);
  });

  it("copies the 16:9 video's Style Preset snapshot", async () => {
    const [[wideVersion], [tallVersion]] = await Promise.all([savedVersions(project, "horizontal"), savedVersions(project, "vertical")]);

    expect(wideVersion?.preset).toEqual(bundledPreset("blueprint"));
    expect(tallVersion?.preset).toEqual(wideVersion?.preset);
  });

  it("has Captions on, where the 16:9 video has them off", async () => {
    const [[wideVersion], [tallVersion]] = await Promise.all([savedVersions(project, "horizontal"), savedVersions(project, "vertical")]);
    const [widePage, tallPage] = await Promise.all([pageOf(await core.video.open(wide)), pageOf(await core.video.open(tall))]);

    expect([wideVersion?.captions, tallVersion?.captions]).toEqual([false, true]);
    expect(widePage).not.toContain("mb-caption");
    expect(tallPage).toContain('class="clip mb-caption mb-caption-highlight"');
  });

  it("shares the Transcript, so a word fix shows in both videos and in the Captions", async () => {
    await core.project.fixWord({ projectId: project.id, index: 34, text: "five" });

    const [wideVideo, tallVideo] = await Promise.all([core.video.open(wide), core.video.open(tall)]);

    expect(wideVideo).toMatchObject({ version: 1, captions: false });
    expect(tallVideo).toMatchObject({ version: 1, captions: true });
    expect([wideVideo.preview?.timeline.words[34]?.text, tallVideo.preview?.timeline.words[34]?.text]).toEqual(["five", "five"]);
    expect(await pageOf(tallVideo)).toMatch(/<span id="mb-caption-\d+-\d+" class="mb-caption-word">five<\/span>/);
  });

  it("turns Captions on or off per video, each a Version saved with the choice and re-rendered with no agent run", async () => {
    const asked = replay.asked.length;

    // The 16:9 Storyboard was written with Captions off; turned on, its longer copy is still drawn.
    const on = await core.video.setCaptions({ ...wide, captions: true });
    const reopened = await core.video.open(wide);
    const saved = JSON.parse(await readFile(join(project.path, "horizontal", "video.json"), "utf8")) as { captions?: boolean };
    const off = await core.video.setCaptions({ ...wide, captions: false });

    expect(on).toMatchObject({ version: 2, captions: true });
    expect(await pageOf(on)).toContain('class="clip mb-caption mb-caption-highlight"');
    expect(reopened).toMatchObject({ captions: true, preview: { id: on.preview?.id } });
    expect(saved.captions).toBe(true);
    expect(off).toMatchObject({ version: 3, captions: false });
    expect(await pageOf(off)).not.toContain("mb-caption");
    expect(replay.asked).toHaveLength(asked);
    expect(await savedVersions(project, "horizontal")).toHaveLength(3);
  });

  it("can't be generated twice", async () => {
    await expect(core.video.generate(tall)).rejects.toMatchObject({ code: "ALREADY_GENERATED", data: { version: 1 } });
  });
});

describe("Captions through the core API", () => {
  /** The vertical fixture video, with Captions on or off, in a caption style. */
  function source(captions: boolean, style: CaptionStyle): VideoSource {
    return {
      storyboard: verticalCaptions,
      transcript: words,
      rules: { ...RULES, format: "vertical", captions },
      preset: { ...bundledPreset("blueprint"), captions: style },
      code: {},
    };
  }

  async function page(source: VideoSource) {
    const { url } = await checkerCore().preview.open(source);

    return fetch(url).then((response) => response.text());
  }

  it.each(["highlight", "pop", "plain"] as const)("draws every Transcript word in caption lines, in the %s style", async (style) => {
    const html = await page(source(true, style));
    const drawn = [...html.matchAll(/<span id="mb-caption-\d+-\d+" class="mb-caption-word">([^<]*)<\/span>/g)].map(([, text]) => text);
    const lines = [...html.matchAll(/<p id="mb-caption-\d+" class="clip mb-caption mb-caption-(\w+)"/g)].map(([, lineStyle]) => lineStyle);

    expect(drawn).toEqual(words.words.map(({ text }) => text));
    expect(new Set(lines)).toEqual(new Set([style]));
  });

  it("draws none while Captions are off, on a page of its own", async () => {
    const core = checkerCore();
    const [off, on] = await Promise.all([core.preview.open(source(false, "highlight")), core.preview.open(source(true, "highlight"))]);

    expect(await fetch(off.url).then((response) => response.text())).not.toContain("mb-caption");
    expect(on.id).not.toBe(off.id);
  });
});
