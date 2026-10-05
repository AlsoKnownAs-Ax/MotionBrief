import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, TranscriptionStatus } from "../contract";
import { createCore } from "./composition-root";
import { streamsOf, video, voiceover, type Stretch } from "./test-support/media";
import { fakeWhisper, whisperFixture, type FakeWhisper } from "./test-support/whisper";

/**
 * The shape of the recording the `two-chunks` fixture came from, a 60.2 s Voiceover read by a speech synthesizer:
 * speech, the long pause it is cut into two chunks at, speech.
 */
const SPOKEN: Stretch[] = [{ tone: 31.8 }, { silence: 3.6 }, { tone: 24.8 }];

/** The words of its first chunk, as whisper-cli heard them: VAD joins sentences, so most run on with commas. */
const FIRST_CHUNK_TEXT =
  "Every request starts at the load balancer, it picks a healthy server and forwards the request, " +
  "the server checks the cache before anything else, if the answer is there, it comes back in under 5 milliseconds, " +
  "that is why the page feels instant, most requests never touch the database at all, " +
  "the cache holds the answers people ask for most, each answer expires after a minute, so nothing stays stale for long.";

const SPOKEN_TEXT =
  `${FIRST_CHUNK_TEXT} but when the cache misses, the database does the work, a single query can take 200 milliseconds, ` +
  "so we add an index on the column we search by, now the same query returns in 4 milliseconds, " +
  "and the next request finds the answer in the cache, that is the whole trip, from the balancer to the disk and back.";

/** A stand-in for the transcription model: the fake whisper-cli never reads it. */
const MODEL = randomBytes(1024);

let root: string;
let appDataDir: string;
let projectsDir: string;
let cacheDir: string;
let userDir: string;
let cores: CoreClient[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-new-project-"));
  appDataDir = join(root, "app-data");
  projectsDir = join(root, "Documents", "MotionBrief");
  cacheDir = join(root, "cache");
  userDir = join(root, "user");
  await mkdir(userDir);
  cores = [];
});

afterEach(async () => {
  await Promise.all(cores.map(closeAll));
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

type ConnectOptions = { whisper: FakeWhisper; cacheCapBytes?: number };

/** A core on the shared folders; connecting again is what an app restart looks like. */
function connect({ whisper, cacheCapBytes }: ConnectOptions) {
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: sha256(MODEL), size: MODEL.length };
  const { router } = createCore({
    appVersion: "1.2.3",
    appDataDir,
    projectsDir,
    cacheDir,
    cacheCapBytes,
    modelPin,
    adapters: { whisper },
  });
  const core = createRouterClient(router);
  cores.push(core);

  return core;
}

/** Installs the transcription model the way a user who already has the file would. */
async function installModel(core: CoreClient) {
  const path = join(userDir, "model.bin");
  await writeFile(path, MODEL);
  await core.transcriptionModel.import({ path });

  for await (const status of await core.transcriptionModel.watch()) {
    if (status.state === "ready") {
      return;
    }
  }
}

async function readyCore(options: ConnectOptions) {
  const core = connect(options);
  await installModel(core);

  return core;
}

/** Projects the core still has open, so their locks and transcriptions end with the test. */
const opened = new WeakMap<CoreClient, string[]>();

async function create(core: CoreClient, input: Parameters<CoreClient["project"]["create"]>[0]) {
  const project = await core.project.create(input);
  opened.set(core, [...(opened.get(core) ?? []), project.id]);

  return project;
}

async function open(core: CoreClient, path: string) {
  const { project } = await core.project.open({ path });
  opened.set(core, [...(opened.get(core) ?? []), project.id]);

  return project;
}

async function closeAll(core: CoreClient) {
  await Promise.all((opened.get(core) ?? []).map((projectId) => core.project.close({ projectId })));
}

/** Watches a Project's transcription until its status matches. */
async function until(core: CoreClient, projectId: string, matches: (status: TranscriptionStatus) => boolean) {
  for await (const status of await core.project.transcription({ projectId })) {
    if (matches(status)) {
      return status;
    }
  }

  throw new Error("The transcription stream ended");
}

function transcribed(core: CoreClient, projectId: string) {
  return until(core, projectId, ({ state }) => state === "done" || state === "failed");
}

async function projectDocument(path: string) {
  return JSON.parse(await readFile(join(path, "project.json"), "utf8")) as Record<string, unknown> & {
    transcript: { language: string; duration: number; words: { text: string; start: number; end: number }[] } | null;
  };
}

function sha256(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}

function textOf(words: { text: string }[]) {
  return words.map(({ text }) => text).join(" ");
}

async function twoChunks() {
  return fakeWhisper(await whisperFixture("two-chunks", 2));
}

// FFmpeg makes, probes and resamples real audio in every test, so they take seconds each.
describe("new Project", { timeout: 30_000 }, () => {
  it("creates a Project folder with a schema-versioned Project document, a copy of the Voiceover and a lock", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const source = await voiceover(userDir, "Load balancing.wav", SPOKEN);

    const project = await create(core, { voiceoverPath: source });

    expect(project).toMatchObject({
      name: "Load balancing",
      path: join(projectsDir, "Load balancing"),
      format: "horizontal",
      stylePreset: "blueprint",
      language: "auto",
      voiceover: { fileName: "Load balancing.wav", isVideo: false, isLong: false },
    });
    expect(project.voiceover.duration).toBeCloseTo(60.2, 1);
    // Written atomically: no temporary file is ever left beside them.
    expect((await readdir(project.path)).sort()).toEqual([".lock", "project.json", "voiceover.wav"]);
    expect(await readFile(join(project.path, "voiceover.wav"))).toEqual(await readFile(source));
    expect(await projectDocument(project.path)).toMatchObject({
      schemaVersion: 2,
      appVersion: "1.2.3",
      id: project.id,
      voiceover: { file: "voiceover.wav", fileName: "Load balancing.wav" },
      format: "horizontal",
      stylePreset: "blueprint",
      language: "auto",
    });
    expect(JSON.parse(await readFile(join(project.path, ".lock"), "utf8"))).toEqual({ host: hostname(), pid: process.pid });
  });

  it("never reuses a Project folder: a second Project with the same name gets a number", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const source = await voiceover(userDir, "talk.wav", SPOKEN);

    const first = await create(core, { voiceoverPath: source });
    const second = await create(core, { voiceoverPath: source });

    expect([first.name, second.name]).toEqual(["talk", "talk 2"]);
    expect(second.id).not.toBe(first.id);
  });

  it("releases the lock when the Project is closed", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });

    await core.project.close({ projectId: project.id });

    expect(await readdir(project.path)).not.toContain(".lock");
  });

  it("takes any file FFmpeg can read, using only the audio of a video", async () => {
    const whisper = await twoChunks();
    const core = await readyCore({ whisper });
    const source = await video(userDir, "screen recording.mp4", { stretches: SPOKEN });

    const project = await create(core, { voiceoverPath: source });
    await transcribed(core, project.id);

    expect(project.voiceover).toMatchObject({ fileName: "screen recording.mp4", isVideo: true });
    expect(await readFile(join(project.path, "voiceover.mp4"))).toEqual(await readFile(source));
    // whisper-cli is only ever given 16 kHz mono audio.
    const heard = join(userDir, "heard.wav");
    await writeFile(heard, whisper.runs[0]?.audio ?? "");
    expect(await streamsOf(heard)).toEqual([{ codec_type: "audio", sample_rate: "16000", channels: 1 }]);
  });

  it("refuses a file FFmpeg can't read, creating nothing", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const path = join(userDir, "notes.wav");
    await writeFile(path, "not audio at all");

    await expect(create(core, { voiceoverPath: path })).rejects.toMatchObject({ code: "VOICEOVER_UNREADABLE", data: { path } });
    expect(await readdir(projectsDir).catch(() => [])).toEqual([]);
  });

  it("refuses a video without sound", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const path = await video(userDir, "silent.mp4", { audio: false });

    await expect(create(core, { voiceoverPath: path })).rejects.toMatchObject({ code: "NO_AUDIO", data: { path } });
  });

  it("warns, without refusing, about a Voiceover over 20 minutes", async () => {
    const core = await readyCore({ whisper: await twoChunks() });
    const long = await voiceover(userDir, "long.flac", [{ silence: 20 * 60 + 5 }]);
    const short = await voiceover(userDir, "short.flac", [{ silence: 20 * 60 - 5 }]);

    const longProject = await create(core, { voiceoverPath: long });
    const shortProject = await create(core, { voiceoverPath: short });

    expect(longProject.voiceover.isLong).toBe(true);
    expect(shortProject.voiceover.isLong).toBe(false);
  });

  describe("choices", () => {
    it("defaults Format and Style Preset to the last used: 16:9 and Blueprint at first", async () => {
      const core = await readyCore({ whisper: await twoChunks() });

      expect(await core.project.defaults()).toEqual({ format: "horizontal", stylePreset: "blueprint", folder: projectsDir });

      const project = await create(core, { voiceoverPath: await voiceover(userDir, "a.wav", SPOKEN), format: "vertical" });
      await core.project.update({ projectId: project.id, stylePreset: "sketchbook" });

      const restarted = connect({ whisper: await twoChunks() });
      expect(await restarted.project.defaults()).toEqual({ format: "vertical", stylePreset: "sketchbook", folder: projectsDir });
      expect(await create(restarted, { voiceoverPath: await voiceover(userDir, "b.wav", SPOKEN) })).toMatchObject({
        format: "vertical",
        stylePreset: "sketchbook",
      });
    });

    it("saves the Project's choices as they change", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "a.wav", SPOKEN) });

      const updated = await core.project.update({ projectId: project.id, format: "vertical", stylePreset: "terminal" });

      expect(updated).toMatchObject({ format: "vertical", stylePreset: "terminal" });
      expect(await projectDocument(project.path)).toMatchObject({ format: "vertical", stylePreset: "terminal" });
    });

    it("renames the Project folder with the Project", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "take 3.wav", SPOKEN) });
      await transcribed(core, project.id);

      const renamed = await core.project.update({ projectId: project.id, name: "Caching explained" });

      expect(renamed.path).toBe(join(projectsDir, "Caching explained"));
      expect(await readdir(projectsDir)).toEqual(["Caching explained"]);
      expect((await projectDocument(renamed.path)).id).toBe(project.id);
    });

    it("refuses a name that is taken or can't be a folder name", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const source = await voiceover(userDir, "a.wav", SPOKEN);
      const project = await create(core, { voiceoverPath: source });
      await create(core, { voiceoverPath: source, name: "Taken" });

      await expect(core.project.update({ projectId: project.id, name: "Taken" })).rejects.toMatchObject({ code: "NAME_TAKEN" });
      await expect(core.project.update({ projectId: project.id, name: "a/b" })).rejects.toMatchObject({ code: "INVALID_NAME" });
      await expect(core.project.update({ projectId: project.id, name: "  " })).rejects.toMatchObject({ code: "INVALID_NAME" });
    });
  });

  describe("transcription", () => {
    it("transcribes the Voiceover as soon as it is added and saves the Transcript in the Project", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });

      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      const status = await transcribed(core, project.id);

      expect(status).toMatchObject({ state: "done", language: "en" });
      expect(textOf(status.words)).toBe(SPOKEN_TEXT);
      expect((await projectDocument(project.path)).transcript).toEqual({
        language: "en",
        duration: project.voiceover.duration,
        words: status.words,
      });
    });

    it("fills the Transcript in live, chunk by chunk", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });
      whisper.holdFrom(1);
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });

      // The first chunk ends in the long pause; the second waits for whisper-cli.
      const live = await until(core, project.id, ({ words }) => words.length > 0);
      whisper.release();
      const done = await transcribed(core, project.id);

      expect(live.state).toBe("transcribing");
      expect(live.transcribedSeconds).toBeCloseTo(33.6, 1);
      expect(textOf(live.words)).toBe(FIRST_CHUNK_TEXT);
      expect(done.words.slice(0, live.words.length)).toEqual(live.words);
    });

    it("times words on the Voiceover, through the pauses VAD skipped and across chunks", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });

      const { words } = await transcribed(core, project.id);

      const starts = words.map(({ start }) => start);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(words.every(({ start, end }) => start < end && end <= project.voiceover.duration)).toBe(true);
      // Spoken right after pauses VAD cut out of the audio whisper-cli heard: in the recording, speech resumes at
      // 3.67 s and, in the second chunk, at 35.39 s.
      expect(words[7]).toMatchObject({ text: "it", start: 3.77 });
      expect(words[72]?.text).toBe("but");
      expect(words[72]?.start).toBeCloseTo(35.5, 1);
      // A word lasts until the next one starts, or until the speaker pauses.
      expect(words[0]).toEqual({ text: "Every", start: 0.36, end: words[1]?.start });
      expect(words[6]).toMatchObject({ text: "balancer,", end: 2.46 });
    });

    it("spreads word onsets that DTW stacked after a pause", async () => {
      // The first chunk of `two-chunks`, with "that is why the" all put on the onset of "that".
      const core = await readyCore({ whisper: fakeWhisper(await whisperFixture("stacked", 1)) });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", [{ tone: 33.6 }]) });

      const { words } = await transcribed(core, project.id);

      // They now share the gap up to "page", weighted by length.
      expect(words.slice(36, 41).map(({ text, start }) => [text, start])).toEqual([
        ["that", 16.73],
        ["is", 16.964],
        ["why", 17.12],
        ["the", 17.315],
        ["page", 17.51],
      ]);
    });

    it("detects the language, and transcribes again in the language the creator chooses", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      expect(await transcribed(core, project.id)).toMatchObject({ language: "en" });

      const updated = await core.project.update({ projectId: project.id, language: "de" });
      const status = await transcribed(core, project.id);

      expect(updated.language).toBe("de");
      expect(status).toMatchObject({ state: "done", language: "de" });
      expect(whisper.runs.map(({ language }) => language)).toEqual(["auto", "en", "de", "de"]);
      expect((await projectDocument(project.path)).transcript?.language).toBe("de");
    });

    it("waits for the transcription model, then transcribes", async () => {
      const core = connect({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });

      expect(await until(core, project.id, () => true)).toMatchObject({ state: "waiting-for-model", words: [] });

      await installModel(core);

      expect(await transcribed(core, project.id)).toMatchObject({ state: "done" });
    });

    it("fails with a message when whisper-cli fails, and transcribes again on Retry", async () => {
      const failing = fakeWhisper([{ json: "{ not json", log: "whisper_init: failed to load model" }]);
      const core = await readyCore({ whisper: failing });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", [{ tone: 5 }]) });

      expect(await transcribed(core, project.id)).toMatchObject({ state: "failed", error: { code: "TRANSCRIBER_FAILED" } });

      await core.project.retryTranscription({ projectId: project.id });

      expect(await until(core, project.id, ({ state }) => state !== "transcribing")).toMatchObject({ state: "failed" });
      expect(failing.runs).toHaveLength(2);
    });
  });

  describe("word fixes", () => {
    /** "balancer," in "Every request starts at the load balancer, it picks…". */
    const BALANCER = 6;

    it("change a word's text in the Project's Transcript and keep its timing, without a Version", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      const { words } = await transcribed(core, project.id);

      const fixed = await core.project.fixWord({ projectId: project.id, index: BALANCER, text: "  Balancer, " });

      const heard = words[BALANCER]!;
      expect(heard.text).toBe("balancer,");
      expect(fixed).toEqual({ text: "Balancer,", start: heard.start, end: heard.end, heard: "balancer," });
      const { transcript } = await projectDocument(project.path);
      expect(transcript?.words).toEqual(words.with(BALANCER, fixed));
      expect(await until(core, project.id, ({ words: shown }) => shown[BALANCER]?.text === "Balancer,")).toMatchObject({ state: "done" });
      // The Transcript is Project-level: nothing but the Project document changed.
      expect((await readdir(project.path)).sort()).toEqual([".lock", "project.json", "voiceover.wav"]);
    });

    it("keep the stored Transcript's fixes when the Project is reopened", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      await transcribed(core, project.id);
      await core.project.fixWord({ projectId: project.id, index: BALANCER, text: "Balancer," });
      const stored = (await projectDocument(project.path)).transcript;
      await core.project.close({ projectId: project.id });

      const whisper = await twoChunks();
      const restarted = connect({ whisper });
      const reopened = await open(restarted, project.path);

      expect(reopened).toMatchObject({ id: project.id, name: project.name, path: project.path });
      expect((await projectDocument(project.path)).transcript).toEqual(stored);
      const status = await until(restarted, project.id, () => true);
      expect(status).toMatchObject({ state: "done", language: "en" });
      expect(status.words).toEqual(stored?.words);
      expect(status.words[BALANCER]).toMatchObject({ text: "Balancer,", heard: "balancer," });
      // A saved Transcript is never transcribed again.
      expect(whisper.runs).toHaveLength(0);
    });

    it("drop the fix when a word is set back to what was heard", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      const { words } = await transcribed(core, project.id);
      await core.project.fixWord({ projectId: project.id, index: BALANCER, text: "Balancer," });

      const restored = await core.project.fixWord({ projectId: project.id, index: BALANCER, text: "balancer," });

      expect(restored).toEqual(words[BALANCER]);
      expect((await projectDocument(project.path)).transcript?.words).toEqual(words);
    });

    it("survive a choice changed right after them", async () => {
      const core = await readyCore({ whisper: await twoChunks() });
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      await transcribed(core, project.id);

      await Promise.all([
        core.project.fixWord({ projectId: project.id, index: BALANCER, text: "Balancer," }),
        core.project.update({ projectId: project.id, format: "vertical" }),
      ]);

      const document = await projectDocument(project.path);
      expect(document.format).toBe("vertical");
      expect(document.transcript?.words[BALANCER]?.text).toBe("Balancer,");
    });

    it("are refused before the Transcript is saved, when empty, or for a word that isn't there", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });
      whisper.holdFrom(1);
      const project = await create(core, { voiceoverPath: await voiceover(userDir, "talk.wav", SPOKEN) });
      await until(core, project.id, ({ words }) => words.length > 0);

      await expect(core.project.fixWord({ projectId: project.id, index: 0, text: "Each" })).rejects.toMatchObject({ code: "TRANSCRIPT_NOT_READY" });

      whisper.release();
      const { words } = await transcribed(core, project.id);

      await expect(core.project.fixWord({ projectId: project.id, index: 0, text: " " })).rejects.toMatchObject({ code: "INVALID_WORD" });
      await expect(core.project.fixWord({ projectId: project.id, index: words.length, text: "Each" })).rejects.toMatchObject({
        code: "UNKNOWN_WORD",
        data: { index: words.length, words: words.length },
      });
      expect((await projectDocument(project.path)).transcript?.words).toEqual(words);
    });
  });

  describe("cache", () => {
    it("keeps resampled audio and raw Whisper output by content, so the same Voiceover is never transcribed twice", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });
      const source = await voiceover(userDir, "talk.wav", SPOKEN);
      const first = await create(core, { voiceoverPath: source });
      const transcript = await transcribed(core, first.id);
      const copy = join(userDir, "copy of talk.wav");
      await copyFile(source, copy);

      const second = await create(core, { voiceoverPath: copy });

      expect(await transcribed(core, second.id)).toEqual(transcript);
      expect(whisper.runs).toHaveLength(2);
      expect((await core.cache.status()).usedBytes).toBeGreaterThan(0);
    });

    it("evicts the least recently used entries to stay under its cap", async () => {
      const whisper = await twoChunks();
      // Room for one Voiceover's resampled audio and Whisper output, not two.
      const core = await readyCore({ whisper, cacheCapBytes: 3_000_000 });
      const a = await voiceover(userDir, "a.wav", SPOKEN);
      const b = await voiceover(userDir, "b.wav", [...SPOKEN, { tone: 1 }]);

      await transcribed(core, (await create(core, { voiceoverPath: a })).id);
      await transcribed(core, (await create(core, { voiceoverPath: b })).id);
      await transcribed(core, (await create(core, { voiceoverPath: a })).id);

      expect(whisper.runs).toHaveLength(6);
      expect((await core.cache.status()).usedBytes).toBeLessThanOrEqual(3_000_000);
    });

    it("Clear cache empties it", async () => {
      const whisper = await twoChunks();
      const core = await readyCore({ whisper });
      const source = await voiceover(userDir, "talk.wav", SPOKEN);
      await transcribed(core, (await create(core, { voiceoverPath: source })).id);

      expect(await core.cache.clear()).toMatchObject({ usedBytes: 0 });

      await transcribed(core, (await create(core, { voiceoverPath: source })).id);
      expect(whisper.runs).toHaveLength(4);
    });

    it("leaves preview pages, which keep themselves to the newest few, out of its size and Clear cache", async () => {
      const core = connect({ whisper: await twoChunks() });
      const page = join(cacheDir, "preview", "page", "index.html");
      await mkdir(join(page, ".."), { recursive: true });
      await writeFile(page, "<!doctype html>");

      expect(await core.cache.clear()).toMatchObject({ usedBytes: 0 });
      expect(await readFile(page, "utf8")).toBe("<!doctype html>");
    });
  });
});
