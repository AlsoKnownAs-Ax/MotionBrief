import type {
  CheckFinding,
  GenerationPreviewError,
  Preview,
  RevisionRequest,
  RevisionStatus,
  RevisionUnit,
  StylePreset,
  Transcript,
  UnitCode,
  VideoRef,
} from "../../contract";
import type { Checker } from "../checker";
import type { Connector } from "../connector";
import { inParallel, writeUnitCode } from "../generation";
import type { PreviewError, Previews } from "../preview";
import { createStatusStore, type Flag, type Projects, type ProjectsError, type RevisionRecord, type Version } from "../projects";
import { StoryboardSchema, type Storyboard } from "../storyboard";
import { presetBrief, storyboardRules } from "../style";
import type { Clock } from "../system";
import { runRevisionAgent } from "./agent";
import { regenerateRequest } from "./prompts";
import { planRebuild, type UnitRebuild } from "./rebuild";

/** The model each role of a Revision runs on until Settings choose others: the Revision agent and Scene code, both Opus. */
export const DEFAULT_REVISION_MODELS = { revision: "claude-opus-5-5", sceneCode: "claude-opus-5-5" };

export type RevisionModels = typeof DEFAULT_REVISION_MODELS;

/** Scene-code subagents running at once, as in a first generation. */
const PARALLEL_UNITS = 4;

/** How many earlier Revisions the agent reads, newest last. */
const HISTORY = 5;

export type RevisionsOptions = {
  connector: Connector;
  checker: Checker;
  previews: Previews;
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

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type Revisions = ReturnType<typeof createRevisions>;

const IDLE: RevisionStatus = { state: "idle", affected: [], units: [] };

/** The current Version with its units' code, as a Revision starts from it. */
type Current = { version: Version; storyboard: Storyboard; code: Record<string, UnitCode> };

type Store = ReturnType<typeof createStatusStore<RevisionStatus>>;

/**
 * Revisions: a change to a generated video asked for in chat. Each is a fresh run of the Revision agent, which
 * answers, asks one clarifying question, or hands in a Storyboard patch. Our code then decides what every unit needs
 * (the rebuild rule), re-renders and checks what only moved in time, regenerates what changed, and saves the result
 * as the next Version. The current Version plays on meanwhile; Stop, or any failure, leaves it as it was.
 */
export function createRevisions({ connector, checker, previews, projects, clock, workDir, models = DEFAULT_REVISION_MODELS }: RevisionsOptions) {
  const videos = new Map<string, Store>();
  const running = new Map<string, AbortController>();

  function storeOf({ projectId, format }: VideoRef) {
    const key = `${projectId} ${format}`;
    const store = videos.get(key) ?? createStatusStore<RevisionStatus>(IDLE);
    videos.set(key, store);

    return { key, store };
  }

  /** Starts a Revision of the video's current Version; its progress streams through `watch`. */
  async function start(ref: VideoRef, request: RevisionRequest): Promise<Result<null, ReviseError>> {
    const { projectId, format } = ref;
    const { data: video, error } = await projects.video(projectId, format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    if (video.version === undefined || !video.transcript) {
      return { data: null, error: { code: "NOT_GENERATED", projectId } };
    }

    const { key, store } = storeOf(ref);

    if (running.has(key)) {
      return { data: null, error: { code: "REVISING", projectId } };
    }

    const { data: current, error: readError } = await readCurrent(ref, video.version);

    if (readError) {
      return { data: null, error: readError };
    }

    const unknown = request.scope.find((sceneId) => !current.storyboard.scenes.some(({ id }) => id === sceneId));

    if (unknown !== undefined) {
      return { data: null, error: { code: "UNKNOWN_SCENE", sceneId: unknown } };
    }

    const job = new AbortController();
    running.set(key, job);
    store.set({ state: "revising", request, affected: request.scope, units: [] });
    const run: Run = { ref, request, transcript: video.transcript, voiceover: video.voiceoverPath, current, store, signal: job.signal };
    void revise(run)
      .catch((cause: unknown) => publish(run, { state: "failed", error: { code: "FILE_FAILED", path: workDir, message: String(cause) } }))
      .finally(() => {
        if (running.get(key) === job) {
          running.delete(key);
        }
      });

    return { data: null, error: null };
  }

  /** Stops the video's running Revision and discards it. */
  function stop(ref: VideoRef) {
    const { key, store } = storeOf(ref);
    const job = running.get(key);

    if (!job) {
      return;
    }

    running.delete(key);
    job.abort();
    store.update({ state: "stopped", affected: [] });
  }

  async function readCurrent(ref: VideoRef, number: number): Promise<Result<Current, ReviseError>> {
    const { data: version, error } = await projects.readVersion(ref.projectId, ref.format, number);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    const storyboard = StoryboardSchema.safeParse(version.storyboard);

    if (!storyboard.success) {
      return { data: null, error: { code: "FILE_FAILED", path: `versions/${number}.json`, message: storyboard.error.message } };
    }

    const code: Record<string, UnitCode> = {};

    for (const [unit, hash] of Object.entries(version.units)) {
      const { data: unitCode, error: unitError } = await projects.readUnit(ref.projectId, ref.format, hash);

      if (unitError) {
        return { data: null, error: projectError(unitError) };
      }

      code[unit] = unitCode;
    }

    return { data: { version, storyboard: storyboard.data, code }, error: null };
  }

  /** The video's earlier Revisions, oldest first: what each asked for and what it did. */
  async function history(ref: VideoRef, newest: number): Promise<RevisionRecord[]> {
    const records: RevisionRecord[] = [];

    for (let number = newest; number >= 1 && records.length < HISTORY; number--) {
      const { data: version } = await projects.readVersion(ref.projectId, ref.format, number);

      if (version?.revision) {
        records.unshift(version.revision);
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
    signal: AbortSignal;
  };

  /** Updates the Revision's status, unless it was stopped: a stopped Revision says nothing more. */
  function publish({ store, signal }: Run, change: Partial<RevisionStatus>) {
    if (!signal.aborted) {
      store.update(change);
    }
  }

  async function revise(run: Run) {
    const { ref, request, transcript, current, signal } = run;
    const { preset, captions } = current.version;
    const brief = presetBrief(preset, ref.format);
    const rulesFor = (withCaptions: boolean) => storyboardRules(preset, { format: ref.format, captions: withCaptions });
    const { data: outcome, error } = await runRevisionAgent({
      connector,
      workDir,
      signal,
      model: models.revision,
      storyboard: current.storyboard,
      transcript,
      rulesFor,
      preset,
      brief,
      captions,
      history: await history(ref, current.version.version),
      request: request.message,
      scope: request.scope,
    });

    if (error) {
      return publish(run, { state: "failed", affected: [], error });
    }

    if (outcome.kind === "reply") {
      return publish(run, { state: "answered", affected: [], reply: outcome.text });
    }

    const { storyboard, patch } = outcome;
    const nextCaptions = patch.captions ?? captions;
    const instructions = Object.fromEntries(patch.instructions.map(({ scene, text }) => [scene, text]));
    const plans = planRebuild({ current: current.storyboard, next: storyboard, transcript, instructions, captionsChanged: nextCaptions !== captions });

    // A patch that changes nothing makes no Version: its summary is the reply.
    if (plans.every(({ rebuild }) => rebuild === "keep")) {
      return publish(run, { state: "answered", affected: [], reply: patch.summary });
    }

    await rebuild(run, { storyboard, plans, captions: nextCaptions, summary: patch.summary, preset });
  }

  type Rebuilt = { storyboard: Storyboard; plans: UnitRebuild[]; captions: boolean; summary: string; preset: StylePreset };

  /** Re-renders and regenerates what the rebuild rule says, then saves the next Version. */
  async function rebuild(run: Run, { storyboard, plans, captions, summary, preset }: Rebuilt) {
    const { ref, request, transcript, current, signal } = run;
    const rules = storyboardRules(preset, { format: ref.format, captions });
    const brief = presetBrief(preset, ref.format);
    const working = plans.filter(({ rebuild: need }) => need !== "keep");
    const progress = new Map<string, RevisionUnit>(working.map(({ unit, rebuild: need }) => [unit.id, { id: unit.id, rebuild: need === "rerender" ? "rerender" : "regenerate", status: "queued", attempts: 0 }]));
    const show = (unit?: RevisionUnit) => {
      if (unit) {
        progress.set(unit.id, unit);
      }

      publish(run, { units: [...progress.values()] });
    };
    // Every unit starts from its previous code; a unit the patch made, or a fallback, has none.
    const code: Record<string, UnitCode> = Object.fromEntries(
      plans.flatMap(({ unit, previous }) => (previous && current.code[previous.id] ? [[unit.id, current.code[previous.id]!]] : [])),
    );
    const flags = new Map<string, Flag>();
    const notApplied: string[] = [];

    publish(run, { state: "rebuilding", affected: affectedScenes(current.storyboard, plans), units: [...progress.values()], summary });

    // Re-rendered units are checked as they now are; any that fail the contract are regenerated.
    const rerendered = working.filter(({ unit, rebuild: need }) => need === "rerender" && code[unit.id]);
    const { data: failing, error: checkError } = await failingUnits(storyboard, transcript, rules, preset, rerendered.map(({ unit }) => unit.id), code);

    if (checkError) {
      return publish(run, { state: "failed", affected: [], error: checkError });
    }

    const regenerated = working.filter(({ unit, rebuild: need }) => need === "regenerate" || failing.has(unit.id));
    working
      .filter((plan) => !regenerated.includes(plan))
      .forEach(({ unit }) => show({ ...progress.get(unit.id)!, status: code[unit.id] ? "ready" : "fallback" }));

    const baseline = regenerated.length > 0 ? await pageFindings(storyboard, transcript, rules, preset) : [];
    await inParallel(regenerated, PARALLEL_UNITS, async (plan) => {
      const { unit, previous, instructions, isInstructionOnly } = plan;
      const previousCode = previous ? current.code[previous.id] : undefined;
      const rebuildKind = failing.has(unit.id) ? "regenerate" : progress.get(unit.id)!.rebuild;
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
        request: regenerateRequest(instructions, previousCode),
        onProgress: (status, attempts) => show({ id: unit.id, rebuild: rebuildKind, status, attempts }),
      });

      if (outcome.code) {
        code[unit.id] = outcome.code;
      } else if (isInstructionOnly) {
        // A tweak that couldn't be made leaves the Scene as it was, not as a fallback.
        notApplied.push(...unit.scenes.map(({ id }) => id));
      } else {
        delete code[unit.id];
        flags.set(unit.id, { unit: unit.id, kind: "fallback", reason: outcome.reason });
      }

      show({ id: unit.id, rebuild: rebuildKind, status: code[unit.id] ? "ready" : "fallback", attempts: outcome.attempts });
    });

    if (signal.aborted) {
      return;
    }

    const { data: units, error: unitsError } = await storeUnits(run, plans, code);

    if (unitsError) {
      return publish(run, { state: "failed", affected: [], error: unitsError });
    }

    const record = { request: request.message, scope: request.scope, summary, notApplied };
    const version: Omit<Version, "version"> = {
      storyboard,
      preset,
      captions,
      units,
      flags: plans.flatMap(({ unit, previous }) => flagOf(unit.id, previous?.id, code, flags, current.version.flags)),
      models: { ...current.version.models, ...models },
      frameContractVersion: current.version.frameContractVersion,
      createdAt: new Date(clock.now()).toISOString(),
      origin: "revision",
      revision: record,
    };

    if (signal.aborted) {
      return;
    }

    const { data: number, error: saveError } = await projects.saveVersion(ref.projectId, ref.format, version);

    if (saveError) {
      return publish(run, { state: "failed", affected: [], error: fileErrorOf(saveError) });
    }

    const { preview, previewError } = await previewOf({ storyboard, transcript, rules, preset, code, voiceover: run.voiceover });
    publish(run, { state: "done", affected: [], version: number, notApplied, preview, previewError });
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
      return { data: null, error: { code: "CHECKER_UNAVAILABLE", detail: "message" in error ? error.message : error.code } };
    }

    return { data: new Set(report.findings.flatMap(({ unit }) => (unit && ids.includes(unit) ? [unit] : []))), error: null };
  }

  async function pageFindings(storyboard: Storyboard, transcript: Transcript, rules: ReturnType<typeof storyboardRules>, preset: StylePreset): Promise<CheckFinding[]> {
    const { data: report } = await checker.check({ storyboard, transcript, rules, preset, code: {} });

    return report?.findings ?? [];
  }

  /** Stores new code and keeps the hashes of code that didn't change, in the Storyboard's unit order. */
  async function storeUnits({ ref, current }: Run, plans: UnitRebuild[], code: Record<string, UnitCode>): Promise<Result<Record<string, string>, { code: "FILE_FAILED"; path: string; message: string }>> {
    const units: Record<string, string> = {};

    for (const { unit, previous } of plans) {
      const unitCode = code[unit.id];

      if (!unitCode) {
        continue;
      }

      const previousHash = previous ? current.version.units[previous.id] : undefined;

      if (previousHash && previous && current.code[previous.id] === unitCode) {
        units[unit.id] = previousHash;
        continue;
      }

      const { data: hash, error } = await projects.writeUnit(ref.projectId, ref.format, unitCode);

      if (error) {
        return { data: null, error: fileErrorOf(error) };
      }

      units[unit.id] = hash;
    }

    return { data: units, error: null };
  }

  async function previewOf(source: Parameters<Previews["open"]>[0]): Promise<{ preview?: Preview; previewError?: GenerationPreviewError }> {
    try {
      const { data, error } = await previews.open(source);

      return error ? { previewError: previewErrorOf(error) } : { preview: data };
    } catch (cause) {
      return { previewError: { code: "PREVIEW_FAILED", message: cause instanceof Error ? cause.message : String(cause) } };
    }
  }

  /** Streams the video's Revision: `idle` until a request is sent. */
  async function watch(ref: VideoRef, signal?: AbortSignal): Promise<Result<AsyncGenerator<RevisionStatus>, ReviseError>> {
    const { error } = await projects.video(ref.projectId, ref.format);

    if (error) {
      return { data: null, error: projectError(error) };
    }

    return { data: storeOf(ref).store.watch(signal), error: null };
  }

  return { start, stop, watch };
}

/** The Scenes of the current Version a Revision changes: those of every unit it rebuilds, and those it removes. */
function affectedScenes(current: Storyboard, plans: UnitRebuild[]): string[] {
  const rebuilt = new Set(plans.filter(({ rebuild }) => rebuild !== "keep").flatMap(({ previous, unit }) => [...(previous?.scenes ?? []), ...unit.scenes].map(({ id }) => id)));
  const kept = new Set(plans.flatMap(({ unit }) => unit.scenes.map(({ id }) => id)));

  return current.scenes.map(({ id }) => id).filter((id) => rebuilt.has(id) || !kept.has(id));
}

/** A unit without code plays as its fallback Scene: flagged anew, or still flagged as it was. */
function flagOf(id: string, previousId: string | undefined, code: Record<string, UnitCode>, flags: Map<string, Flag>, previousFlags: Flag[]): Flag[] {
  if (code[id]) {
    return [];
  }

  const flag = flags.get(id) ?? previousFlags.find(({ unit }) => unit === previousId);

  return [{ ...(flag ?? { kind: "fallback", reason: "It has no Scene code." }), unit: id }];
}

function fileErrorOf(error: ProjectsError): { code: "FILE_FAILED"; path: string; message: string } {
  if (error.code === "FILE_FAILED") {
    return error;
  }

  return { code: "FILE_FAILED", path: "", message: error.code };
}

function projectError(error: ProjectsError): ReviseError {
  if (error.code === "UNKNOWN_PROJECT" || error.code === "FILE_FAILED") {
    return error;
  }

  return { code: "FILE_FAILED", path: "", message: error.code };
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
