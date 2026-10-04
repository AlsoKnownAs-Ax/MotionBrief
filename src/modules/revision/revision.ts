import type {
  CheckFinding,
  GenerationPreviewError,
  Preview,
  RevisionRequest,
  RevisionStatus,
  RevisionUnit,
  SceneStatus,
  StylePreset,
  Transcript,
  UnitCode,
  VideoRef,
  WordFixOffer,
} from "../../contract";
import type { Checker } from "../checker";
import type { Connector } from "../connector";
import { inParallel, reviewUnit, writeUnitCode, type UnitOutcome } from "../generation";
import type { PreviewError, Previews, Stills } from "../preview";
import { createStatusStore, type Flag, type Projects, type ProjectsError, type RevisionRecord, type Version, type VersionError } from "../projects";
import { StoryboardSchema, type Storyboard } from "../storyboard";
import { presetBrief, storyboardRules } from "../style";
import type { Clock } from "../system";
import { runRevisionAgent } from "./agent";
import { regenerateRequest } from "./prompts";
import { planRebuild, type UnitRebuild } from "./rebuild";
import { wordFixOffer } from "./word-fix";

/**
 * The model each role of a Revision runs on until Settings choose others: the Revision agent and Scene code on Opus,
 * the visual review of regenerated units on Sonnet.
 */
export const DEFAULT_REVISION_MODELS = { revision: "claude-opus-5-5", sceneCode: "claude-opus-5-5", review: "claude-sonnet-5-5" };

export type RevisionModels = typeof DEFAULT_REVISION_MODELS;

/** Scene-code subagents running at once, as in a first generation. */
const PARALLEL_UNITS = 4;

/** How many earlier Revisions the agent reads, newest last. */
const HISTORY = 5;

export type RevisionsOptions = {
  connector: Connector;
  checker: Checker;
  previews: Previews;
  /** The Renderer's stills of a unit, for the visual review of regenerated units. */
  stills: Stills;
  projects: Projects;
  clock: Clock;
  /** Where agent sessions get their workspace folders. */
  workDir: string;
  models?: RevisionModels;
};

export type ReviseError =
  | Extract<ProjectsError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }>
  | { code: "NOT_GENERATED"; projectId: string }
  | { code: "REVISING"; projectId: string }
  | { code: "UNKNOWN_SCENE"; sceneId: string };

export type WordFixOfferError = Extract<ProjectsError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }> | { code: "UNKNOWN_WORD"; index: number; words: number };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

type FileFailed = { code: "FILE_FAILED"; path: string; message: string };

export type Revisions = ReturnType<typeof createRevisions>;

const IDLE: RevisionStatus = { state: "idle", affected: [], units: [] };

/**
 * The current Version with its units' code, as a Revision starts from it, and whether the video shows Captions: the
 * creator's choice, else what its Storyboard was written for.
 */
type Current = { version: Version; storyboard: Storyboard; code: Record<string, UnitCode>; captions: boolean };

type Store = ReturnType<typeof createStatusStore<RevisionStatus>>;

/**
 * A video's running Revision. Once it starts saving its Version it is committing: Stop is too late from then on,
 * and the Revision ends `done`.
 */
type Job = { controller: AbortController; isCommitting: boolean };

/** What a regenerated unit ended with: new code, or none; and the flag it carries in the new Version, if any. */
type Regenerated = { code?: UnitCode; flag?: Flag };

/**
 * Revisions: a change to a generated video asked for in chat. Each is a fresh run of the Revision agent, which
 * answers, asks one clarifying question, or hands in a Storyboard patch. Our code then decides what every unit needs
 * (the rebuild rule), re-renders and checks what only moved in time, regenerates what changed, and saves the result
 * as the next Version. The current Version plays on meanwhile; Stop, or any failure, leaves it as it was.
 */
export function createRevisions({ connector, checker, previews, stills, projects, clock, workDir, models = DEFAULT_REVISION_MODELS }: RevisionsOptions) {
  const videos = new Map<string, Store>();
  const running = new Map<string, Job>();

  function storeOf({ projectId, format }: VideoRef) {
    const key = `${projectId} ${format}`;
    const store = videos.get(key) ?? createStatusStore<RevisionStatus>(IDLE);
    videos.set(key, store);

    return { key, store };
  }

  /**
   * Starts a Revision of the video's current Version; its progress streams through `watch`. The video is reserved
   * before anything is read, so two requests at once can't both start.
   */
  async function start(ref: VideoRef, request: RevisionRequest): Promise<Result<null, ReviseError>> {
    const { key, store } = storeOf(ref);

    if (running.has(key)) {
      return { data: null, error: { code: "REVISING", projectId: ref.projectId } };
    }

    const job: Job = { controller: new AbortController(), isCommitting: false };
    running.set(key, job);
    const { data: run, error } = await prepare(ref, request, store, job);

    if (error) {
      running.delete(key);

      return { data: null, error };
    }

    store.set({ state: "revising", request, affected: request.scope, units: [] });
    void revise(run)
      .catch((cause: unknown) => publish(run, { state: "failed", error: { code: "FILE_FAILED", path: workDir, message: String(cause) } }))
      .finally(() => {
        if (running.get(key) === job) {
          running.delete(key);
        }
      });

    return { data: null, error: null };
  }

  /** Everything a Revision starts from: the video's Transcript, Voiceover and current Version, and a scope it has. */
  async function prepare(ref: VideoRef, request: RevisionRequest, store: Store, job: Job): Promise<Result<Run, ReviseError>> {
    const { projectId, format } = ref;
    const { data: video, error } = await projects.video(projectId, format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    const [{ data: stored, error: storedError }, { data: choice, error: choiceError }] = await Promise.all([
      projects.storedVideo(projectId, format),
      projects.captionsChoice(projectId, format),
    ]);

    if (storedError || choiceError) {
      return { data: null, error: projectError((storedError ?? choiceError)!) };
    }

    if (!stored || !video.transcript) {
      return { data: null, error: { code: "NOT_GENERATED", projectId } };
    }

    const { success, data: storyboard, error: parseError } = StoryboardSchema.safeParse(stored.version.storyboard);

    if (!success) {
      return { data: null, error: { code: "FILE_FAILED", path: `versions/${stored.version.version}.json`, message: parseError.message } };
    }

    const current: Current = { version: stored.version, code: stored.code, storyboard, captions: choice ?? stored.version.captions };

    const unknown = request.scope.find((sceneId) => !current.storyboard.scenes.some(({ id }) => id === sceneId));

    if (unknown !== undefined) {
      return { data: null, error: { code: "UNKNOWN_SCENE", sceneId: unknown } };
    }

    return { data: { ref, request, transcript: video.transcript, voiceover: video.voiceoverPath, current, store, job }, error: null };
  }

  /** Stops the video's running Revision and discards it, unless it is already saving its Version. */
  function stop(ref: VideoRef) {
    const { key, store } = storeOf(ref);
    const job = running.get(key);

    if (!job || job.isCommitting) {
      return;
    }

    running.delete(key);
    job.controller.abort();
    store.update({ state: "stopped", affected: [] });
  }

  /** The video's earlier Revisions, oldest first: what each asked for and what it did. */
  async function history(ref: VideoRef, newest: number): Promise<RevisionRecord[]> {
    const records: RevisionRecord[] = [];
    const numbers = Array.from({ length: newest }, (_, index) => newest - index);

    for (const number of numbers) {
      const { data: stored } = await projects.readVersion(ref.projectId, ref.format, number);
      records.unshift(...[stored?.version.revision].filter((record) => record !== undefined));

      if (records.length === HISTORY) {
        break;
      }
    }

    return records;
  }

  type Run = {
    ref: VideoRef;
    request: RevisionRequest;
    transcript: Transcript;
    voiceover: string;
    current: Current;
    store: Store;
    job: Job;
  };

  /** Updates the Revision's status, unless it was stopped: a stopped Revision says nothing more. */
  function publish({ store, job }: Run, change: Partial<RevisionStatus>) {
    if (!job.controller.signal.aborted) {
      store.update(change);
    }
  }

  async function revise(run: Run) {
    const { ref, request, transcript, current, job } = run;
    const { preset, captions: writtenFor } = current.version;
    const { captions } = current;
    const brief = presetBrief(preset, ref.format);
    const rulesFor = (withCaptions: boolean) => storyboardRules(preset, { format: ref.format, captions: withCaptions });
    const { data: outcome, error } = await runRevisionAgent({
      connector,
      workDir,
      signal: job.controller.signal,
      model: models.revision,
      storyboard: current.storyboard,
      transcript,
      rulesFor,
      preset,
      brief,
      captions,
      writtenFor,
      history: await history(ref, current.version.version),
      request: request.message,
      scope: request.scope,
    });

    if (error) {
      return publish(run, { state: "failed", affected: [], error });
    }

    const { storyboard, patch, reply } = outcome;

    if (!storyboard || !patch) {
      return publish(run, { state: "answered", affected: [], reply });
    }

    // A Captions switch in the patch is the creator's choice from now on, and the Storyboard is written for it.
    const nextCaptions = patch.captions ?? captions;
    const instructions = Object.fromEntries(patch.instructions.map(({ scene, text }) => [scene, text]));
    const plans = planRebuild({ current: current.storyboard, next: storyboard, transcript, instructions, captionsChanged: nextCaptions !== captions });

    // A patch that changes nothing makes no Version: its summary is the reply.
    if (plans.every(({ rebuild }) => rebuild === "keep")) {
      return publish(run, { state: "answered", affected: [], reply: patch.summary });
    }

    await rebuild(run, { storyboard, plans, writtenFor: patch.captions ?? writtenFor, captions: nextCaptions, choice: patch.captions, summary: patch.summary, preset });
  }

  type Rebuilt = {
    storyboard: Storyboard;
    plans: UnitRebuild[];
    /** Whether the revised Storyboard is written for Captions: its rules. */
    writtenFor: boolean;
    /** Whether the revised video shows Captions. */
    captions: boolean;
    /** The Captions choice the patch makes, if it switches them. */
    choice?: boolean;
    summary: string;
    preset: StylePreset;
  };

  /** Re-renders and regenerates what the rebuild rule says, then saves the next Version. */
  async function rebuild(run: Run, { storyboard, plans, writtenFor, captions, choice, summary, preset }: Rebuilt) {
    const { ref, transcript, current, job } = run;
    const signal = job.controller.signal;
    const rules = storyboardRules(preset, { format: ref.format, captions: writtenFor });
    const brief = presetBrief(preset, ref.format);
    const working = plans.filter(({ rebuild: need }) => need !== "keep");
    const progress = new Map<string, RevisionUnit>(working.map(({ unit, rebuild: need }) => [unit.id, { id: unit.id, rebuild: rebuildOf(need), status: "queued", attempts: 0 }]));
    const show = (unit: RevisionUnit) => {
      progress.set(unit.id, unit);
      publish(run, { units: [...progress.values()] });
    };
    // Every unit starts from its previous code; a unit the patch made, or a fallback, has none.
    const code: Record<string, UnitCode> = Object.fromEntries(
      plans.filter(({ previous }) => previous && current.code[previous.id]).map(({ unit, previous }) => [unit.id, current.code[previous!.id]!]),
    );

    publish(run, { state: "rebuilding", affected: affectedScenes(current.storyboard, plans), units: [...progress.values()], summary });

    // Re-rendered units are checked as they now are; any that fail the contract are regenerated.
    const rerendered = working.filter(({ rebuild: need }) => need === "rerender").filter(({ unit }) => code[unit.id]);
    const { data: failing, error: checkError } = await failingUnits(storyboard, transcript, rules, preset, rerendered.map(({ unit }) => unit.id), code);

    if (checkError) {
      return publish(run, { state: "failed", affected: [], error: checkError });
    }

    const regenerating = working.filter(({ unit, rebuild: need }) => need === "regenerate" || failing.has(unit.id));
    working
      .filter((plan) => !regenerating.includes(plan))
      .forEach(({ unit }) => show({ ...progress.get(unit.id)!, status: statusOf(code[unit.id]) }));

    const baseline = await pageFindings(storyboard, transcript, rules, preset, regenerating.length);
    const regenerated = new Map<string, Regenerated>();
    const notApplied: string[] = [];

    await inParallel(regenerating, PARALLEL_UNITS, async ({ unit, previous, instructions, isInstructionOnly }) => {
      const previousCode = previous && current.code[previous.id];
      const outcome = await writeUnitCode({
        connector,
        workDir,
        signal,
        model: models.sceneCode,
        checker,
        storyboard,
        transcript,
        rules,
        preset,
        brief,
        unit,
        baseline,
        review: (passing) => reviewUnit({ connector, workDir, signal, model: models.review, stills, storyboard, transcript, rules, preset, brief, unit, code: passing }),
        request: regenerateRequest(instructions, previousCode || undefined),
        onProgress: (status, attempts) => show({ id: unit.id, rebuild: "regenerate", status, attempts }),
      });

      // A tweak that couldn't be made leaves the Scene as it was, not as a fallback.
      if (!outcome.code && isInstructionOnly) {
        notApplied.push(...unit.scenes.map(({ id }) => id));
        show({ id: unit.id, rebuild: "regenerate", status: statusOf(code[unit.id]), attempts: outcome.attempts });

        return;
      }

      regenerated.set(unit.id, regeneratedOf(unit.id, outcome));
      show({ id: unit.id, rebuild: "regenerate", status: statusOf(outcome.code ?? undefined), attempts: outcome.attempts });
    });

    regenerated.forEach((_, id) => delete code[id]);
    regenerated.forEach(({ code: unitCode }, id) => Object.assign(code, Object.fromEntries([[id, unitCode]].filter(([, value]) => value))));

    if (signal.aborted) {
      return;
    }

    const { data: units, error: unitsError } = await storeUnits(run, plans, code);

    if (unitsError) {
      return publish(run, { state: "failed", affected: [], error: unitsError });
    }

    await commit(run, {
      storyboard,
      preset,
      captions: writtenFor,
      units,
      flags: plans.flatMap(({ unit, previous }) => flagsOf(unit.id, previous?.id, code, regenerated, current.version.flags)),
      models: { ...current.version.models, ...models },
      frameContractVersion: current.version.frameContractVersion,
      createdAt: new Date(clock.now()).toISOString(),
      origin: "revision",
      revision: { request: run.request.message, scope: run.request.scope, summary, notApplied },
    }, { storyboard, transcript, rules, preset, code, voiceover: run.voiceover, captions }, choice);
  }

  /**
   * Saves the Revision's Version: the boundary after which Stop is too late. Checking for Stop and marking the run as
   * committing happen with nothing awaited between them, so a Revision is either discarded or saved and `done`.
   */
  async function commit(run: Run, version: Omit<Version, "version">, source: Parameters<Previews["open"]>[0], captionsChoice?: boolean) {
    const { ref, job } = run;

    if (job.controller.signal.aborted) {
      return;
    }

    job.isCommitting = true;
    publish(run, { state: "saving" });
    const { data: number, error: saveError } = await projects.saveVersion(ref.projectId, ref.format, version);

    if (saveError) {
      return publish(run, { state: "failed", affected: [], error: fileErrorOf(saveError) });
    }

    if (captionsChoice !== undefined) {
      const { error: choiceError } = await projects.chooseCaptions(ref.projectId, ref.format, captionsChoice);

      if (choiceError) {
        return publish(run, { state: "failed", affected: [], error: fileErrorOf(choiceError) });
      }
    }

    const { preview, previewError } = await previewOf(source);
    publish(run, { state: "done", affected: [], version: number, notApplied: version.revision?.notApplied, preview, previewError });
  }

  /** The units among `ids` the Checker finds fault with, each checked in place with the rest of the video as fallbacks. */
  async function failingUnits(
    storyboard: Storyboard,
    transcript: Transcript,
    rules: ReturnType<typeof storyboardRules>,
    preset: StylePreset,
    ids: string[],
    code: Record<string, UnitCode>,
  ): Promise<Result<Set<string>, { code: "CHECKER_UNAVAILABLE"; detail: string }>> {
    if (ids.length === 0) {
      return { data: new Set(), error: null };
    }

    const checked = Object.fromEntries(ids.map((id) => [id, code[id]!]));
    const { data: report, error } = await checker.check({ storyboard, transcript, rules, preset, code: checked });

    if (error) {
      return { data: null, error: { code: "CHECKER_UNAVAILABLE", detail: detailOf(error) } };
    }

    return {
      data: new Set(
        report.findings
          .map(({ unit }) => unit)
          .filter((unit) => unit !== undefined)
          .filter((unit) => ids.includes(unit)),
      ),
      error: null,
    };
  }

  /** The Checker's findings on the page with no unit's code, needed only when some unit is regenerated. */
  async function pageFindings(storyboard: Storyboard, transcript: Transcript, rules: ReturnType<typeof storyboardRules>, preset: StylePreset, regenerating: number): Promise<CheckFinding[]> {
    if (regenerating === 0) {
      return [];
    }

    const { data: report } = await checker.check({ storyboard, transcript, rules, preset, code: {} });

    return report?.findings ?? [];
  }

  /** Stores new code and keeps the hashes of code that didn't change, in the Storyboard's unit order. */
  async function storeUnits({ ref, current }: Run, plans: UnitRebuild[], code: Record<string, UnitCode>): Promise<Result<Record<string, string>, FileFailed>> {
    const units: Record<string, string> = {};

    for (const { unit, previous } of plans.filter(({ unit: { id } }) => code[id])) {
      const previousHash = previous && current.code[previous.id] === code[unit.id] && current.version.units[previous.id];

      if (previousHash) {
        units[unit.id] = previousHash;
        continue;
      }

      const { data: hash, error } = await projects.writeUnit(ref.projectId, ref.format, code[unit.id]!);

      if (error) {
        return { data: null, error: fileErrorOf(error) };
      }

      units[unit.id] = hash;
    }

    return { data: units, error: null };
  }

  async function previewOf(source: Parameters<Previews["open"]>[0]): Promise<{ preview?: Preview; previewError?: GenerationPreviewError }> {
    const { data, error } = await previews.open(source).catch((cause: unknown) => ({ data: null, error: { code: "THROWN" as const, cause } }));

    if (error?.code === "THROWN") {
      return { previewError: { code: "PREVIEW_FAILED", message: String(error.cause) } };
    }

    if (error) {
      return { previewError: { code: error.code, message: previewMessage(error) } };
    }

    return { preview: data };
  }

  /** Streams the video's Revision: `idle` until a request is sent. */
  async function watch(ref: VideoRef, signal?: AbortSignal): Promise<Result<AsyncGenerator<RevisionStatus>, ReviseError>> {
    const { error } = await projects.video(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    return { data: storeOf(ref).store.watch(signal), error: null };
  }

  /**
   * The Revision to offer once the word at `index` was fixed from `previous`: scoped to the current Version's Scenes
   * whose copy still says the word as it was, or what whisper-cli heard. Nothing to offer before the first Version.
   */
  async function offerWordFix(ref: VideoRef, index: number, previous: string): Promise<Result<WordFixOffer | undefined, WordFixOfferError>> {
    const { data: video, error } = await projects.video(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    const words = video.transcript?.words ?? [];
    const word = words[index];

    if (!word) {
      return { data: null, error: { code: "UNKNOWN_WORD", index, words: words.length } };
    }

    const { data: stored, error: storedError } = await projects.storedVideo(ref.projectId, ref.format);

    if (storedError) {
      return { data: null, error: projectError(storedError) };
    }

    if (!stored) {
      return { data: undefined, error: null };
    }

    const { success, data: storyboard, error: parseError } = StoryboardSchema.safeParse(stored.version.storyboard);

    if (!success) {
      return { data: null, error: { code: "FILE_FAILED", path: `versions/${stored.version.version}.json`, message: parseError.message } };
    }

    const spellings = [previous, word.heard].filter((spelling) => spelling !== undefined);

    return { data: wordFixOffer(storyboard, spellings, word.text), error: null };
  }

  return { start, stop, watch, offerWordFix };
}

function rebuildOf(need: UnitRebuild["rebuild"]): RevisionUnit["rebuild"] {
  if (need === "rerender") {
    return "rerender";
  }

  return "regenerate";
}

function statusOf(code: UnitCode | undefined): SceneStatus {
  if (code) {
    return "ready";
  }

  return "fallback";
}

/** A regenerated unit's code, and the flag it carries: a fallback's findings, or the visual review's note. */
function regeneratedOf(id: string, outcome: UnitOutcome): Regenerated {
  if (!outcome.code) {
    return { flag: { unit: id, kind: "fallback", reason: outcome.reason } };
  }

  if (outcome.note) {
    return { code: outcome.code, flag: { unit: id, kind: "review-note", reason: outcome.note } };
  }

  return { code: outcome.code };
}

/** The Scenes of the current Version a Revision changes: those of every unit it rebuilds, and those it removes. */
function affectedScenes(current: Storyboard, plans: UnitRebuild[]): string[] {
  const rebuilt = new Set(
    plans
      .filter(({ rebuild }) => rebuild !== "keep")
      .flatMap(({ previous, unit }) => [...(previous?.scenes ?? []), ...unit.scenes])
      .map(({ id }) => id),
  );
  const kept = new Set(plans.flatMap(({ unit }) => unit.scenes).map(({ id }) => id));

  return current.scenes.map(({ id }) => id).filter((id) => rebuilt.has(id) || !kept.has(id));
}

/**
 * The flags a unit carries in the new Version: a regenerated unit's own, or the ones it had before. A unit left
 * without code is always flagged as a fallback.
 */
function flagsOf(id: string, previousId: string | undefined, code: Record<string, UnitCode>, regenerated: Map<string, Regenerated>, previousFlags: Flag[]): Flag[] {
  const fresh = regenerated.get(id);

  if (fresh) {
    return [fresh.flag].filter((flag) => flag !== undefined);
  }

  const carried = previousFlags.filter(({ unit }) => unit === previousId).map((flag) => ({ ...flag, unit: id }));

  if (!code[id] && !carried.some(({ kind }) => kind === "fallback")) {
    return [{ unit: id, kind: "fallback", reason: "It has no Scene code." }];
  }

  return carried;
}

function detailOf(error: { code: string; message?: string }): string {
  return error.message ?? error.code;
}

function fileErrorOf(error: ProjectsError | VersionError): FileFailed {
  if (error.code === "FILE_FAILED") {
    return error;
  }

  return { code: "FILE_FAILED", path: "", message: error.code };
}

function projectError(error: ProjectsError | VersionError): Extract<ProjectsError, { code: "UNKNOWN_PROJECT" | "FILE_FAILED" }> {
  if (error.code === "UNKNOWN_PROJECT" || error.code === "FILE_FAILED") {
    return error;
  }

  return fileErrorOf(error);
}

const PREVIEW_ERRORS = {
  VOICEOVER_MISSING: (error) => `The Voiceover isn't at ${error.path} any more.`,
  INVALID_STORYBOARD: (error) => error.issues.map((issue) => issue.message).join(" "),
  UNKNOWN_UNIT: (error) => `The Storyboard has no unit ${error.unit}.`,
} satisfies { [Code in PreviewError["code"]]: (error: Extract<PreviewError, { code: Code }>) => string };

function previewMessage(error: PreviewError): string {
  // The table is keyed by code, so each entry receives the error of its own code.
  return (PREVIEW_ERRORS[error.code] as (error: PreviewError) => string)(error);
}
