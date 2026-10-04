import type {
  CheckFinding,
  Format,
  FrameUpdate,
  GenerationEstimate,
  GenerationPreviewError,
  GenerationStatus,
  GenerationUnit,
  OpenedVideo,
  StylePreset,
  Transcript,
  UnitCode,
  UnitWork,
  VideoRef,
} from "../../contract";
import { StylePresetSchema } from "../../contract";
import { planUnits, type Unit } from "../assembler";
import type { Checker } from "../checker";
import type { Connector } from "../connector";
import { FRAME_CONTRACT_VERSION } from "../frame";
import type { PreviewError, Previews, Stills } from "../preview";
import {
  createStatusStore,
  type Flag,
  type Projects,
  type ProjectsError,
  type StoredVideo,
  type Version,
  type VersionError,
  type VideoContent,
} from "../projects";
import { StoryboardSchema, type Storyboard } from "../storyboard";
import { listPresets, presetBrief, storyboardRules } from "../style";
import type { Clock } from "../system";
import { writeStoryboard, writeUnitCode, type UnitOutcome } from "./agents";
import { failingUnits, needsRecheck } from "./frame-update";
import { reviewUnit } from "./review";

/** The model each agent role runs on until Settings choose others (Storyboard and Scene code: Opus; visual review: Sonnet). */
export const DEFAULT_MODELS = { storyboard: "claude-opus-5-5", sceneCode: "claude-opus-5-5", review: "claude-sonnet-5-5" };

export type Models = typeof DEFAULT_MODELS;

/** Scene-code subagents running at once. */
const PARALLEL_UNITS = 4;

/** Spike numbers per minute of Voiceover with the default models (#7): 7-9 minutes of work, $3-5. */
const MINUTES_PER_MINUTE = { low: 7, high: 9 };
const COST_PER_MINUTE = { low: 3, high: 5 };

export type GenerationOptions = {
  connector: Connector;
  checker: Checker;
  previews: Previews;
  /** The Renderer's stills of a unit, for its visual review. */
  stills: Stills;
  projects: Projects;
  clock: Clock;
  /** Where agent sessions get their workspace folders. */
  workDir: string;
  models?: Models;
};

export type GenerateError =
  | Extract<ProjectsError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }>
  | { code: "TRANSCRIPT_NOT_READY"; projectId: string }
  | { code: "GENERATING"; projectId: string }
  | { code: "ALREADY_GENERATED"; version: number }
  | { code: "UNKNOWN_STYLE_PRESET"; stylePreset: string };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type Generation = ReturnType<typeof createGeneration>;

const IDLE: GenerationStatus = { state: "idle", units: [] };

/**
 * Generation: a video's first generation, from the Project's Transcript to Version 1. The Storyboard
 * agent plans it; once the Storyboard is valid, parallel subagents write each unit's Scene code, the
 * Checker drives their retries, and a unit that keeps failing plays as its flagged fallback Scene.
 * Every finished unit is stored at once and the video plays as they finish. There is no approval
 * between the Storyboard and the Scenes, and nothing starts until Generate is pressed.
 */
export function createGeneration({ connector, checker, previews, stills, projects, clock, workDir, models = DEFAULT_MODELS }: GenerationOptions) {
  const videos = new Map<string, ReturnType<typeof createStatusStore<GenerationStatus>>>();
  const running = new Set<string>();
  /** The last open or Retry start queued on each video. */
  const steps = new Map<string, Promise<unknown>>();

  function storeOf({ projectId, format }: VideoRef) {
    const key = `${projectId} ${format}`;
    const store = videos.get(key) ?? createStatusStore<GenerationStatus>(IDLE);
    videos.set(key, store);

    return { key, store };
  }

  async function estimate({ projectId, format }: VideoRef): Promise<Result<GenerationEstimate, GenerateError>> {
    const { data: video, error } = await projects.video(projectId, format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    const minutes = video.project.voiceover.duration / 60;
    const low = Math.max(1, Math.round(minutes * MINUTES_PER_MINUTE.low));
    const span = { low, high: Math.max(low, Math.ceil(minutes * MINUTES_PER_MINUTE.high)) };

    if ((await connector.status()).method !== "api-key") {
      return { data: { minutes: span }, error: null };
    }

    return { data: { minutes: span, costUsd: { low: cents(minutes * COST_PER_MINUTE.low), high: cents(minutes * COST_PER_MINUTE.high) } }, error: null };
  }

  /** Starts generating the video; its progress streams through `watch`. */
  async function start(ref: VideoRef): Promise<Result<null, GenerateError>> {
    const { projectId, format } = ref;
    const { data: video, error } = await projects.video(projectId, format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    const { key, store } = storeOf(ref);

    if (running.has(key)) {
      return { data: null, error: { code: "GENERATING", projectId } };
    }

    if (video.version !== undefined) {
      return { data: null, error: { code: "ALREADY_GENERATED", version: video.version } };
    }

    if (!video.transcript) {
      return { data: null, error: { code: "TRANSCRIPT_NOT_READY", projectId } };
    }

    const listed = listPresets().find(({ id }) => id === video.project.stylePreset);

    if (!listed) {
      return { data: null, error: { code: "UNKNOWN_STYLE_PRESET", stylePreset: video.project.stylePreset } };
    }

    running.add(key);
    store.set({ state: "planning", units: [] });
    const transcript = video.transcript;
    void generate({ ref, transcript, preset: StylePresetSchema.parse(listed), store })
      .catch((cause: unknown) => store.update({ state: "failed", error: { code: "FILE_FAILED", path: workDir, message: String(cause) } }))
      .finally(() => running.delete(key));

    return { data: null, error: null };
  }

  type Run = { ref: VideoRef; transcript: Transcript; preset: StylePreset; store: ReturnType<typeof createStatusStore<GenerationStatus>> };

  async function generate({ ref, transcript, preset, store }: Run) {
    const { projectId, format } = ref;
    const captions = format === "vertical";
    const rules = storyboardRules(preset, { format, captions });
    const brief = presetBrief(preset, format);
    const agent = { connector, workDir };
    const { data: storyboard, error } = await writeStoryboard({ ...agent, model: models.storyboard, transcript, rules, brief });

    if (error) {
      store.set({ state: "failed", units: [], error });
      return;
    }

    const units = planUnits(storyboard, transcript);
    const startedAt = new Date(clock.now()).toISOString();
    const content: VideoContent = { storyboard, preset, captions, units: {}, flags: [], models, frameContractVersion: FRAME_CONTRACT_VERSION };
    const saveRecord = () => projects.saveGeneration(projectId, format, { ...inUnitOrder(content, units), startedAt });
    const progress = new Map<string, GenerationUnit>(units.map(({ id }) => [id, { id, status: "queued", attempts: 0 }]));
    const code: Record<string, UnitCode> = {};
    const notes: Record<string, string> = {};
    const publish = publisher({ ref, storyboard, transcript, rules, preset, code, notes, progress, store });
    const failed = (fileError: { path: string; message: string }) =>
      publish({ state: "failed", error: { code: "FILE_FAILED", path: fileError.path, message: fileError.message } });

    const { error: recordError } = await saveRecord();

    if (recordError) {
      return failed(fileErrorOf(recordError));
    }

    const baseline = await pageFindings(storyboard, transcript, rules, preset);
    await publish({ state: "writing" });

    const results = await inParallel(units, PARALLEL_UNITS, async (unit): Promise<FileFailure | undefined> => {
      const outcome = await writeUnitCode({
        ...agent,
        model: models.sceneCode,
        checker,
        storyboard,
        transcript,
        rules,
        preset,
        brief,
        unit,
        baseline,
        review: (passing) => reviewUnit({ ...agent, model: models.review, stills, storyboard, transcript, rules, preset, brief, unit, code: passing }),
        onProgress: (status, attempts) => void publish({}, { id: unit.id, status, attempts }),
      });

      if (outcome.code) {
        const { data: hash, error: unitError } = await projects.writeUnit(projectId, format, outcome.code);

        if (unitError) {
          return fileErrorOf(unitError);
        }

        code[unit.id] = outcome.code;
        content.units[unit.id] = hash;

        if (outcome.note) {
          notes[unit.id] = outcome.note;
          content.flags.push({ unit: unit.id, kind: "review-note", reason: outcome.note });
        }
      } else {
        content.flags.push(flagOf(unit, outcome.reason));
      }

      const { error: saveError } = await saveRecord();
      await publish({}, { id: unit.id, status: statusOf(outcome), attempts: outcome.attempts });

      return saveError ? fileErrorOf(saveError) : undefined;
    });
    const fileError = results.find((result) => result !== undefined);

    if (fileError) {
      return failed(fileError);
    }

    const { data: version, error: versionError } = await projects.saveVersion(projectId, format, {
      ...inUnitOrder(content, units),
      origin: "generation",
      createdAt: new Date(clock.now()).toISOString(),
    });

    if (versionError) {
      return failed(fileErrorOf(versionError));
    }

    await publish({ state: "done", version });
  }

  /**
   * Publishes the video's status with a preview of it so far: units with code play it, the rest play
   * as the Storyboard animatic, or as fallback Scenes once they've failed. One at a time, in order.
   */
  function publisher({ ref, storyboard, transcript, rules, preset, code, notes, progress, store }: PublishContext) {
    let last = Promise.resolve();

    return (change: Partial<GenerationStatus>, unit?: GenerationUnit) => {
      if (unit) {
        progress.set(unit.id, unit);
      }

      last = last.then(async () => {
        const units = [...progress.values()];
        const pending = Object.fromEntries(units.filter(({ status }) => isWork(status)).map(({ id, status }) => [id, status as UnitWork]));
        const { data: video } = await projects.video(ref.projectId, ref.format);
        const source = { storyboard, transcript, rules, preset, code: { ...code }, pending, notes: { ...notes }, voiceover: video?.voiceoverPath };
        const { preview, previewError } = await previews.open(source).then(
          ({ data, error }) => ({ preview: data, previewError: error ? previewErrorOf(error) : undefined }),
          (cause: unknown) => ({ preview: null, previewError: thrown(cause) }),
        );

        store.set({ ...store.get(), ...change, units, preview: preview ?? store.get().preview, previewError });
      });

      return last;
    };
  }

  /** The Checker's findings on the page with every unit as its fallback Scene; none when it can't run, so every page-wide finding counts. */
  async function pageFindings(storyboard: Storyboard, transcript: Transcript, rules: ReturnType<typeof storyboardRules>, preset: StylePreset): Promise<CheckFinding[]> {
    const { data: report } = await checker.check({ storyboard, transcript, rules, preset, code: {} });

    return report?.findings ?? [];
  }

  /** Streams the generation of a video of an open Project: `idle` until Generate is pressed. */
  async function watch(ref: VideoRef, signal?: AbortSignal): Promise<Result<AsyncGenerator<GenerationStatus>, GenerateError>> {
    const { error } = await projects.video(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    return { data: storeOf(ref).store.watch(signal), error: null };
  }

  /**
   * Opens a saved video at its newest Version. Units written against an older frame major are checked again first,
   * with no agent: those that fail become flagged fallbacks in a new Version, and none is regenerated.
   */
  async function open(ref: VideoRef): Promise<Result<OpenedVideo, OpenVideoError>> {
    const { data: checked, error } = await exclusive(storeOf(ref).key, () => openChecked(ref));

    if (error) {
      return { data: null, error };
    }

    const { transcript, voiceoverPath, version, code, frameUpdate } = checked;
    const rules = storyboardRules(version.preset, { format: ref.format, captions: version.captions });
    const source = { storyboard: version.storyboard, transcript, rules, preset: version.preset, code, voiceover: voiceoverPath };
    const { data: preview, error: previewError } = await previews.open(source);

    if (previewError) {
      return { data: null, error: previewError };
    }

    return { data: { version: version.version, preview, frameUpdate }, error: null };
  }

  /**
   * The newest Version, read and re-checked one open at a time per video, so two opens can't both re-check it and
   * each save a Version. A finished generation's status is reset, so the window following it gets this Version's
   * preview instead of the generation's last one; a Retry still running keeps streaming.
   */
  async function openChecked(ref: VideoRef): Promise<Result<SavedVideo & Rechecked, OpenVideoError>> {
    const { data: saved, error } = await savedVideo(ref);

    if (error) {
      return { data: null, error };
    }

    const { data: checked, error: checkError } = await recheck(ref, saved.transcript, saved.stored);

    if (checkError) {
      return { data: null, error: checkError };
    }

    const { key, store } = storeOf(ref);

    if (!running.has(key)) {
      store.set(IDLE);
    }

    return { data: { ...saved, ...checked }, error: null };
  }

  /** Runs one open or Retry start of a video at a time, each after the one before. */
  function exclusive<T>(key: string, step: () => Promise<T>): Promise<T> {
    const done = (steps.get(key) ?? Promise.resolve()).then(step);
    const settled = done.catch(() => undefined);
    steps.set(key, settled);
    void settled.then(() => {
      if (steps.get(key) === settled) {
        steps.delete(key);
      }
    });

    return done;
  }

  /** The video's newest Version with what it plays from; one with no Version yet has no video. */
  async function savedVideo({ projectId, format }: VideoRef): Promise<Result<SavedVideo, OpenVideoError>> {
    const { data: video, error } = await projects.video(projectId, format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    if (!video.transcript) {
      return { data: null, error: { code: "TRANSCRIPT_NOT_READY", projectId } };
    }

    const { data: stored, error: storedError } = await projects.storedVideo(projectId, format);

    if (storedError) {
      return { data: null, error: versionError(storedError) };
    }

    if (!stored) {
      return { data: null, error: { code: "NO_VIDEO", format } };
    }

    return { data: { transcript: video.transcript, voiceoverPath: video.voiceoverPath, stored }, error: null };
  }

  /**
   * Checks again units written against another frame major, unless they already passed this one. When the Checker
   * can't run, the video opens as saved and is checked on a later open.
   */
  async function recheck(ref: VideoRef, transcript: Transcript, { version, code, frameChecked }: StoredVideo): Promise<Result<Rechecked, OpenVideoError>> {
    const { projectId, format } = ref;
    const isChecked = frameChecked?.version === version.version && !needsRecheck(frameChecked.frameContractVersion);

    if (!needsRecheck(version.frameContractVersion) || isChecked || running.has(storeOf(ref).key)) {
      return { data: { version, code }, error: null };
    }

    const rules = storyboardRules(version.preset, { format, captions: version.captions });
    const { data: failing, error } = await failingUnits(checker, { storyboard: version.storyboard, transcript, rules, preset: version.preset, code });

    if (error) {
      return { data: { version, code }, error: null };
    }

    if (failing.size === 0) {
      const { error: rememberError } = await projects.rememberFrameCheck(projectId, format, { version: version.version, frameContractVersion: FRAME_CONTRACT_VERSION });

      if (rememberError) {
        return { data: null, error: versionError(rememberError) };
      }

      return { data: { version, code }, error: null };
    }

    const kept = Object.fromEntries(Object.entries(version.units).filter(([unit]) => !failing.has(unit)));
    const flags = [...version.flags, ...[...failing].map(([unit, reason]): Flag => ({ unit, kind: "fallback", reason }))];
    const content: VideoContent = { ...contentOf(version), units: kept, flags, frameContractVersion: FRAME_CONTRACT_VERSION };
    const createdAt = new Date(clock.now()).toISOString();
    const { data: number, error: saveError } = await projects.saveVersion(projectId, format, { ...content, origin: "frame-update", createdAt });

    if (saveError) {
      return { data: null, error: projectError(saveError) };
    }

    return {
      data: {
        version: { ...content, version: number, origin: "frame-update", createdAt },
        code: Object.fromEntries(Object.entries(code).filter(([unit]) => !failing.has(unit))),
        frameUpdate: { previous: version.frameContractVersion, frameContractVersion: FRAME_CONTRACT_VERSION, units: [...failing.keys()] },
      },
      error: null,
    };
  }

  /**
   * Regenerates flagged units of the newest Version with the Scene-code model, each checked and retried as in a first
   * generation, and saves the outcome as a new Version. Progress streams through `watch`.
   */
  function retry(ref: VideoRef, units: string[]): Promise<Result<null, OpenVideoError | RetryError>> {
    // In turn with opens, so a re-check never saves a Version under a Retry starting from the one before it.
    return exclusive(storeOf(ref).key, () => startRetry(ref, units));
  }

  async function startRetry(ref: VideoRef, units: string[]): Promise<Result<null, OpenVideoError | RetryError>> {
    const { data: saved, error } = await savedVideo(ref);

    if (error) {
      return { data: null, error };
    }

    const { key, store } = storeOf(ref);

    if (running.has(key)) {
      return { data: null, error: { code: "GENERATING", projectId: ref.projectId } };
    }

    const { version } = saved.stored;
    const unflagged = units.find((unit) => !version.flags.some((flag) => flag.unit === unit));

    if (unflagged !== undefined) {
      return { data: null, error: { code: "NOT_FLAGGED", unit: unflagged } };
    }

    const { success, data: storyboard } = StoryboardSchema.safeParse(version.storyboard);

    if (!success) {
      return { data: null, error: { code: "INVALID_VERSION", path: ref.format, message: `Version ${version.version} has no valid Storyboard` } };
    }

    running.add(key);
    store.set({ state: "writing", units: [] });
    void retryUnits({ ref, saved, storyboard, units: new Set(units), store })
      .catch((cause: unknown) => store.update({ state: "failed", error: { code: "FILE_FAILED", path: workDir, message: String(cause) } }))
      .finally(() => running.delete(key));

    return { data: null, error: null };
  }

  type RetryRun = { ref: VideoRef; saved: SavedVideo; storyboard: Storyboard; units: Set<string>; store: ReturnType<typeof createStatusStore<GenerationStatus>> };

  async function retryUnits({ ref, saved, storyboard, units: retrying, store }: RetryRun) {
    const { projectId, format } = ref;
    const { transcript, stored } = saved;
    const { version } = stored;
    const { preset, captions } = version;
    const rules = storyboardRules(preset, { format, captions });
    const brief = presetBrief(preset, format);
    const units = planUnits(storyboard, transcript);
    const content: VideoContent = {
      ...contentOf(version),
      units: { ...version.units },
      flags: version.flags.filter((flag) => !retrying.has(flag.unit)),
      models: { ...version.models, sceneCode: models.sceneCode },
    };
    const code = { ...stored.code };
    const progress = new Map<string, GenerationUnit>(units.map(({ id }) => [id, { id, status: retryStatus(id, retrying, code), attempts: 0 }]));
    const publish = publisher({ ref, storyboard, transcript, rules, preset, code, progress, store });
    const failed = (fileError: FileFailure) => publish({ state: "failed", error: { code: "FILE_FAILED", path: fileError.path, message: fileError.message } });

    await publish({ state: "writing" });
    const baseline = await pageFindings(storyboard, transcript, rules, preset);
    const results = await inParallel(
      units.filter(({ id }) => retrying.has(id)),
      PARALLEL_UNITS,
      async (unit): Promise<FileFailure | undefined> => {
        const outcome = await writeUnitCode({
          connector,
          workDir,
          model: models.sceneCode,
          checker,
          storyboard,
          transcript,
          rules,
          preset,
          brief,
          unit,
          baseline,
          onProgress: (status, attempts) => void publish({}, { id: unit.id, status, attempts }),
        });

        if (outcome.code) {
          const { data: hash, error: unitError } = await projects.writeUnit(projectId, format, outcome.code);

          if (unitError) {
            return fileErrorOf(unitError);
          }

          code[unit.id] = outcome.code;
          content.units[unit.id] = hash;
        } else {
          content.flags.push(flagOf(unit, outcome.reason));
        }

        await publish({}, { id: unit.id, status: outcomeStatus(outcome), attempts: outcome.attempts });

        return undefined;
      },
    );
    const fileError = results.find((result) => result !== undefined);

    if (fileError) {
      return failed(fileError);
    }

    const { data: number, error: versionError } = await projects.saveVersion(projectId, format, {
      ...inUnitOrder(content, units),
      origin: "retry",
      createdAt: new Date(clock.now()).toISOString(),
    });

    if (versionError) {
      return failed(fileErrorOf(versionError));
    }

    await publish({ state: "done", version: number });
  }

  return { estimate, start, watch, open, retry };
}

type SavedVideo = { transcript: Transcript; voiceoverPath: string; stored: StoredVideo };

type Rechecked = { version: Version; code: Record<string, UnitCode>; frameUpdate?: FrameUpdate };

export type OpenVideoError =
  | Extract<GenerateError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" | "TRANSCRIPT_NOT_READY" }>
  | { code: "NO_VIDEO"; format: Format }
  | { code: "INVALID_VERSION"; path: string; message: string }
  | PreviewError;

export type RetryError = { code: "GENERATING"; projectId: string } | { code: "NOT_FLAGGED"; unit: string };

/** How a unit starts a Retry: waiting to be rewritten, playing its code, or still a fallback Scene. */
function retryStatus(id: string, retrying: Set<string>, code: Record<string, UnitCode>): GenerationUnit["status"] {
  if (retrying.has(id)) {
    return "queued";
  }

  if (code[id]) {
    return "ready";
  }

  return "fallback";
}

function outcomeStatus(outcome: UnitOutcome): GenerationUnit["status"] {
  if (outcome.code) {
    return "ready";
  }

  return "fallback";
}

/** What a Version plays and how it was made, without what makes it a Version. */
function contentOf({ storyboard, preset, captions, units, flags, models, frameContractVersion }: Version): VideoContent {
  return { storyboard, preset, captions, units, flags, models, frameContractVersion };
}

function versionError(error: ProjectsError | VersionError): OpenVideoError {
  if (error.code === "INVALID_DOCUMENT") {
    return { code: "INVALID_VERSION", path: error.path, message: error.message };
  }

  return projectError(error);
}

type PublishContext = {
  ref: VideoRef;
  storyboard: Storyboard;
  transcript: Transcript;
  rules: ReturnType<typeof storyboardRules>;
  preset: StylePreset;
  code: Record<string, UnitCode>;
  notes: Record<string, string>;
  progress: Map<string, GenerationUnit>;
  store: ReturnType<typeof createStatusStore<GenerationStatus>>;
};

type FileFailure = { path: string; message: string };

function isWork(status: GenerationUnit["status"]): boolean {
  return status === "queued" || status === "writing" || status === "checking";
}

/** A unit plays its code, flagged when its repair was reverted, or its fallback Scene. */
function statusOf(outcome: UnitOutcome): GenerationUnit["status"] {
  if (!outcome.code) {
    return "fallback";
  }

  if (outcome.note) {
    return "flagged";
  }

  return "ready";
}

function flagOf(unit: Unit, reason: string): Flag {
  return { unit: unit.id, kind: "fallback", reason };
}

/** Units finish in any order; the files list them in the Storyboard's, so the same video always saves the same. */
function inUnitOrder(content: VideoContent, units: Unit[]): VideoContent {
  const order = (id: string) => units.findIndex((unit) => unit.id === id);
  const hashes = units.flatMap(({ id }) => (content.units[id] ? [[id, content.units[id]] as const] : []));

  return { ...content, units: Object.fromEntries(hashes), flags: [...content.flags].sort((a, b) => order(a.unit) - order(b.unit)) };
}

function fileErrorOf(error: ProjectsError): FileFailure {
  if (error.code === "FILE_FAILED") {
    return { path: error.path, message: error.message };
  }

  return { path: "", message: error.code };
}

function projectError(error: ProjectsError): Extract<GenerateError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }> {
  if (error.code === "UNKNOWN_PROJECT" || error.code === "FILE_FAILED") {
    return error;
  }

  return { code: "FILE_FAILED", path: "", message: error.code };
}

function thrown(cause: unknown): GenerationPreviewError {
  return { code: "PREVIEW_FAILED", message: cause instanceof Error ? cause.message : String(cause) };
}

function previewErrorOf(error: PreviewError): GenerationPreviewError {
  switch (error.code) {
    case "VOICEOVER_MISSING":
      return { code: error.code, message: `The Voiceover isn't at ${error.path} any more.` };
    case "INVALID_STORYBOARD":
      return { code: error.code, message: error.issues.map((issue) => issue.message).join(" ") };
    case "UNKNOWN_UNIT":
      return { code: error.code, message: `The Storyboard has no unit ${error.unit}.` };
  }
}

function cents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}


/** Runs `work` on every item, at most `limit` at once, and resolves with the results in order. */
export async function inParallel<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

