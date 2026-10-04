import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  StoryboardTranscriptSchema,
  type CoreClient,
  type GenerationStatus,
  type Project,
  type RevisionStatus,
  type StoryboardTranscript,
  type StylePreset,
  type UnitCode,
  type VideoRef,
} from "../../contract";
import type { AgentEvent } from "../../modules/connector";
import type { RawWhisperOutput } from "../../modules/transcriber";
import { connect, generate, submitsCode, submitsReview, submitsStoryboard } from "./generation";
import { voiceover } from "./media";
import { fakeWhisper } from "./whisper";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** The four bundled Style Presets: a Palette/typography swap replays a video in each one's. */
export const PRESETS = ["blueprint", "whiteboard", "sketchbook", "terminal"] as const;

/**
 * One run of the tier-2 replay corpus, in `fixtures/corpus/<name>.json`: a paid eval's committed agent outputs or a
 * hand-written video. The Storyboard, Transcript JSON, each unit's Scene code and each Revision's patch are paths
 * relative to `fixtures/`; a unit's path names its `.css`, `.html` and `.js`. No audio: a synthetic Voiceover as long
 * as the Transcript stands in. `preset` is the Project's Style Preset; the Format is the Storyboard's.
 */
const CorpusEntrySchema = z.object({
  description: z.string(),
  frameContractVersion: z.string(),
  preset: z.enum(PRESETS),
  storyboard: z.string(),
  transcript: z.string(),
  units: z.record(z.string(), z.string()),
  /** Units whose agent ended without passing code, which play as their fallback Scene: they replay as a failed agent turn. */
  fallbacks: z.array(z.string()).default([]),
  /**
   * Revisions in the order they were asked for: the creator's request and scope, the agent's patch, the Scene code of
   * each unit it regenerated, and the regenerated units whose agent ended without passing code.
   */
  revisions: z
    .array(
      z.object({
        request: z.string(),
        scope: z.array(z.string()),
        patch: z.string(),
        units: z.record(z.string(), z.string()),
        fallbacks: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

/** A saved Version of the replayed video, as the Project store wrote it, with its units' code. */
export type SavedVersion = {
  number: number;
  origin: string;
  storyboard: unknown;
  preset: StylePreset;
  captions: boolean;
  flags: { unit: string; kind: string }[];
  code: Record<string, UnitCode>;
};

/** What replaying a run through the core API left behind. */
export type ReplayedRun = {
  core: CoreClient;
  project: Project;
  video: VideoRef;
  generation: GenerationStatus;
  revisions: RevisionStatus[];
  /** Version 1 from the generation, then one per Revision that made one. */
  versions: SavedVersion[];
  /** The units Scene-code subagents were asked to write, for the generation and then each Revision. */
  written: string[][];
  /** Every corpus file this run reads, loaded. */
  corpus: {
    storyboard: unknown;
    transcript: StoryboardTranscript;
    code: Record<string, UnitCode>;
    fallbacks: string[];
    revisions: { patch: unknown; code: Record<string, UnitCode>; fallbacks: string[] }[];
  };
};

/**
 * Every corpus entry in `fixturesDir` (the committed `fixtures/` unless a test writes its own), by file name. A
 * malformed entry throws: the corpus is committed, so that's a broken commit.
 */
export async function corpusEntries(fixturesDir = FIXTURES): Promise<{ name: string; entry: CorpusEntry }[]> {
  const names = (await readdir(join(fixturesDir, "corpus"))).filter((name) => name.endsWith(".json"));

  return Promise.all(names.map(async (name) => ({ name, entry: CorpusEntrySchema.parse(await json(join("corpus", name), fixturesDir)) })));
}

/** The units a step of a run had an agent write, sorted: those with recorded code and those recorded as fallbacks. */
export function writtenUnits({ code, fallbacks }: { code: Record<string, UnitCode>; fallbacks: string[] }): string[] {
  return [...Object.keys(code), ...fallbacks].sort();
}

export function frameMajor(version: string) {
  return version.split(".")[0];
}

/**
 * Replays a corpus run through the core API, the way the paid run made it: a Project of a synthetic Voiceover whose
 * Transcript comes from fixture whisper output, `video.generate` with the replay connector handing in the recorded
 * Storyboard and each unit's Scene code, then `video.send` per recorded Revision with its patch and regenerated
 * units. The visual reviewer finds nothing. Everything else runs for real: validation, the Checker on every unit, the
 * rebuild rule, Versions and the Project store.
 */
export async function replayRun(entry: CorpusEntry, root: string, fixturesDir = FIXTURES): Promise<ReplayedRun> {
  const corpus = await loadCorpus(entry, fixturesDir);
  const { core, replay, dir } = await connect({ root, script: scriptOf(corpus), whisper: fakeWhisper(whisperOutput(corpus.transcript)) });
  // Revisions wait for approval on an API key by default; the replay approves nothing by hand.
  await core.settings.update({ approveCost: false });
  const project = await transcribedProject(core, dir, entry, corpus);
  const video = { projectId: project.id, format: formatOf(corpus.storyboard) } satisfies VideoRef;
  const generation = await generate(core, video);
  const written = [regenerated(0, replay)];
  const revisions: RevisionStatus[] = [];

  for (const [index, revision] of entry.revisions.entries()) {
    const before = replay.asked.length;
    revisions.push(await revise(core, video, revision.request, revision.scope));
    written[index + 1] = regenerated(before, replay);
  }

  return { core, project, video, generation, revisions, versions: await savedVersions(project, video.format), written, corpus };
}

/** The turn a unit recorded as a fallback replays: the agent's turn fails, so the unit ends without code, as it did. */
const ENDS_AS_FALLBACK: AgentEvent[] = [{ type: "turn-completed", status: "failed", error: { code: "SERVICE_ERROR", message: "Recorded as a fallback" } }];

/**
 * Each label's recorded turns, in the order its sessions ask for them: the generation's first, then each Revision's. A
 * unit's code is handed in and reviewed as looking right; a unit recorded as a fallback gets a failed turn and no review.
 */
function scriptOf(corpus: ReplayedRun["corpus"]): Record<string, AgentEvent[][]> {
  const steps = [corpus, ...corpus.revisions];
  const unitTurns = steps.flatMap(({ code, fallbacks }) => [
    ...Object.entries(code).map(([unit, unitCode]) => ({ unit, turn: submitsCode(unitCode), isReviewed: true })),
    ...fallbacks.map((unit) => ({ unit, turn: ENDS_AS_FALLBACK, isReviewed: false })),
  ]);
  const units = Map.groupBy(unitTurns, ({ unit }) => unit);
  const looksRight = submitsReview({ looksRight: true, problems: [], note: "" });

  return {
    storyboard: [submitsStoryboard(corpus.storyboard)],
    revision: corpus.revisions.map(({ patch }) => submitsPatch(patch)),
    ...Object.fromEntries([...units.entries()].map(([unit, turns]) => [`scene-code ${unit}`, turns.map(({ turn }) => turn)])),
    ...Object.fromEntries([...units.entries()].map(([unit, turns]) => [`review ${unit}`, turns.filter(({ isReviewed }) => isReviewed).map(() => looksRight)])),
  };
}

/** A turn in which the Revision agent hands in a recorded patch through its host tool. */
function submitsPatch(patch: unknown): AgentEvent[] {
  return [
    { type: "tool-call", toolUseId: "toolu_patch", name: "mcp__motionbrief__submit_patch", input: patch as Record<string, unknown> },
    { type: "turn-completed", status: "completed", text: "Submitted the patch." },
  ];
}

/** The units Scene-code subagents were asked to write since the `from`th turn, sorted. */
function regenerated(from: number, replay: Awaited<ReturnType<typeof connect>>["replay"]) {
  const labels = replay.asked.slice(from).map(({ options }) => options.label ?? "");

  return [...new Set(labels.filter((label) => label.startsWith("scene-code ")).map((label) => label.slice("scene-code ".length)))].sort();
}

/** A seconds-long tone per Transcript length, shared by every run of that length. */
const voiceovers = new Map<number, Promise<string>>();

async function transcribedProject(core: CoreClient, dir: string, entry: CorpusEntry, { transcript, storyboard }: ReplayedRun["corpus"]) {
  const shared = join(dir, "..", "voiceovers");
  await mkdir(shared, { recursive: true });
  const path = voiceovers.get(transcript.duration) ?? voiceover(shared, `${transcript.duration}s.wav`, [{ tone: transcript.duration }]);
  voiceovers.set(transcript.duration, path);
  const project = await core.project.create({ voiceoverPath: await path, format: formatOf(storyboard), stylePreset: entry.preset });

  for await (const { state } of await core.project.transcription({ projectId: project.id })) {
    if (state === "done") {
      return project;
    }
  }

  throw new Error("The transcription stream ended");
}

/** Whisper-cli cuts a tone with no pause into 60 s chunks; the Transcriber cuts the same way. */
const CHUNK_SECONDS = 60;

/**
 * Raw whisper-cli output that the Transcriber turns back into the corpus Transcript: one token per word on its onset,
 * chunk by chunk, with no VAD log, so no time is remapped.
 */
function whisperOutput({ duration, words }: StoryboardTranscript): RawWhisperOutput[] {
  const starts = Array.from({ length: Math.max(1, Math.ceil(duration / CHUNK_SECONDS)) }, (_, index) => index * CHUNK_SECONDS);

  return starts.map((start) => {
    const tokens = words
      // The Storyboard's Transcript keeps onsets only: a word lasts until the next one starts.
      .map((word, index) => ({ word, end: words[index + 1]?.start ?? duration }))
      .filter(({ word }) => word.start >= start && word.start < start + CHUNK_SECONDS)
      .map(({ word, end }) => ({ text: ` ${word.text}`, offsets: { from: milliseconds(word.start - start), to: milliseconds(end - start) } }));

    return { json: JSON.stringify({ result: { language: "en" }, transcription: [{ tokens }] }), log: "" };
  });
}

/** Sends a Revision through the chat, as the creator does, and resolves with its last status once it has ended. */
async function revise(core: CoreClient, video: VideoRef, message: string, scope: string[]): Promise<RevisionStatus> {
  const stop = new AbortController();
  const statuses = await core.video.revision(video, { signal: stop.signal });
  await statuses.next();
  await core.video.send({ ...video, message, scope });

  try {
    for await (const status of statuses) {
      if (status.request?.message === message && REVISION_ENDS.has(status.state)) {
        return status;
      }
    }
  } finally {
    stop.abort();
  }

  throw new Error("The Revision stream ended");
}

const REVISION_ENDS = new Set<RevisionStatus["state"]>(["answered", "done", "failed", "stopped"]);

async function savedVersions(project: Project, format: VideoRef["format"]): Promise<SavedVersion[]> {
  const dir = join(project.path, format);
  const files = (await readdir(join(dir, "versions"))).toSorted((a, b) => Number.parseInt(a) - Number.parseInt(b));

  return Promise.all(
    files.map(async (file) => {
      const saved = JSON.parse(await readFile(join(dir, "versions", file), "utf8")) as Omit<SavedVersion, "number" | "code"> & { units: Record<string, string> };
      const code = await Promise.all(
        Object.entries(saved.units).map(async ([unit, hash]) => [unit, JSON.parse(await readFile(join(dir, "units", `${hash}.json`), "utf8")) as UnitCode] as const),
      );

      return { ...saved, number: Number.parseInt(file), code: Object.fromEntries(code) };
    }),
  );
}

/** An entry's committed files, loaded: its Storyboard, Transcript, first units' code and each Revision's patch and units. */
export async function loadCorpus(entry: CorpusEntry, fixturesDir = FIXTURES): Promise<ReplayedRun["corpus"]> {
  return {
    storyboard: await json(entry.storyboard, fixturesDir),
    transcript: StoryboardTranscriptSchema.parse(await json(entry.transcript, fixturesDir)),
    code: await codeOf(entry.units, fixturesDir),
    fallbacks: entry.fallbacks,
    revisions: await Promise.all(
      entry.revisions.map(async (revision) => ({
        patch: await json(revision.patch, fixturesDir),
        code: await codeOf(revision.units, fixturesDir),
        fallbacks: revision.fallbacks,
      })),
    ),
  };
}

function formatOf(storyboard: unknown): VideoRef["format"] {
  return z.object({ format: z.enum(["horizontal", "vertical"]) }).parse(storyboard).format;
}

async function codeOf(units: Record<string, string>, fixturesDir: string): Promise<Record<string, UnitCode>> {
  return Object.fromEntries(await Promise.all(Object.entries(units).map(async ([unit, path]) => [unit, await unitCode(path, fixturesDir)] as const)));
}

async function unitCode(path: string, fixturesDir: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(fixturesDir, `${path}.${part}`), "utf8")));

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

async function json(path: string, fixturesDir = FIXTURES): Promise<unknown> {
  return JSON.parse(await readFile(join(fixturesDir, path), "utf8"));
}

function milliseconds(seconds: number) {
  return Math.round(seconds * 1000);
}
