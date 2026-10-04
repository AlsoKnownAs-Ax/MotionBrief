import type {
  CheckFinding,
  GenerationEstimate,
  GenerationPreviewError,
  GenerationStatus,
  GenerationUnit,
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
import { createStatusStore, type Flag, type Projects, type ProjectsError, type VideoContent } from "../projects";
import type { Storyboard } from "../storyboard";
import { listPresets, presetBrief, storyboardRules } from "../style";
import type { Clock } from "../system";
import { writeStoryboard, writeUnitCode, type UnitOutcome } from "./agents";
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

  return { estimate, start, watch };
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

function projectError(error: ProjectsError): GenerateError {
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
async function inParallel<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
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

