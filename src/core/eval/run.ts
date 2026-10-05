import { join } from "node:path";
import { z } from "zod";
import {
  UnitCodeSchema,
  type CoreClient,
  type GenerationStatus,
  type PlanWindow,
  type Project,
  type RevisionStatus,
  type StoryboardIssue,
  type StoryboardTranscript,
  type Transcript,
  type UnitCode,
  type UsageStatus,
  type VideoRef,
} from "../../contract";
import type { PlanUsage } from "../../modules/connector";
import { FRAME_CONTRACT_VERSION } from "../../modules/frame";
import { readVersion, type StoredVersion } from "../../modules/projects";
import { PatchSchema, validatePatch } from "../../modules/revision";
import { StoryboardSchema, type Storyboard } from "../../modules/storyboard";
import { storyboardRules } from "../../modules/style";
import { handedIn, sessionsOf, SUBMIT_TOOLS, type RecordedSession, type Recorder } from "./recorder";
import type { BundledPresetId, EvalCase, ScriptedRevision } from "./release-set";
import {
  blockReasons,
  fallbackRate,
  firstTryTokenLintRate,
  planQuota,
  type CaseResult,
  type EvalResult,
  type GenerationResult,
  type RevisionResult,
  type UsageResult,
  type Verdict,
} from "./results";

export type EvalOptions = {
  /** The core API, on a core whose connector is the recorder's. */
  core: CoreClient;
  recorder: Recorder;
  runId: string;
  cases: EvalCase[];
  /** Where the eval's Projects are created. */
  projectsDir: string;
  /** Where each case's video is exported as an MP4 for the human verdict; nothing is exported when absent. */
  exportDir?: string;
  /** Asked once every case has run: whether the videos are good enough to release, and why. */
  verdict: (cases: CaseResult[]) => Promise<Verdict>;
  log?: (line: string) => void;
  now?: () => number;
};

/**
 * A case's agent outputs, as the replay corpus takes them: the first generation's Storyboard and Scene code, then each
 * Revision that saved a Version with the patch it was saved from. A unit whose agent ended without passing code (a
 * fallback, or an instruction that couldn't be applied) is listed in `fallbacks` and has no code.
 */
export type CaseOutput = {
  caseId: string;
  preset: BundledPresetId;
  frameContractVersion: string;
  /** The Transcript every Version of the case was written from. */
  transcript: StoryboardTranscript;
  storyboard: unknown;
  code: Record<string, UnitCode>;
  fallbacks: string[];
  revisions: RevisionOutput[];
};

export type RevisionOutput = {
  request: string;
  scope: string[];
  /** The patch the Revision was saved from: the agent's last, valid one. */
  patch: unknown;
  /** Scene code of each unit it regenerated that passed. */
  code: Record<string, UnitCode>;
  fallbacks: string[];
};

/**
 * Runs a release set through the core API, as the app would: each case's Voiceover becomes a Project, is transcribed
 * and generated, then revised by the scripted Revisions; the human judges the result. Measures each step from the
 * core's statuses, the saved Versions and the recorded agent sessions.
 */
export async function runEval(options: EvalOptions): Promise<{ result: EvalResult; outputs: CaseOutput[] }> {
  const { core, runId, cases: evalCases, verdict: askVerdict, now = Date.now } = options;
  const started = now();
  const [{ appVersion }, connection] = await Promise.all([core.system.info(), core.connection.status()]);
  const runs: { result: CaseResult; output?: CaseOutput }[] = [];

  for (const evalCase of evalCases) {
    runs.push(await runCase(options, evalCase));
  }

  const cases = runs.map(({ result }) => result);
  const verdict = await askVerdict(cases);
  const measured = { cases, fallbackRate: fallbackRate(cases), verdict };
  const reasons = blockReasons(measured);

  return {
    result: {
      runId,
      appVersion,
      frameContractVersion: FRAME_CONTRACT_VERSION,
      connection: { method: connection.method, plan: connection.login?.plan },
      startedAt: new Date(started).toISOString(),
      wallSeconds: seconds(now() - started),
      ...measured,
      firstTryTokenLintRate: firstTryTokenLintRate(cases),
      blocked: reasons.length > 0,
      blockReasons: reasons,
    },
    // A case whose generation saved nothing has no outputs to replay.
    outputs: runs.flatMap(({ output }) => optional(output)),
  };
}

type CaseRun = {
  options: EvalOptions;
  evalCase: EvalCase;
  project: Project;
  ref: VideoRef;
  transcript: Transcript;
};

async function runCase(options: EvalOptions, evalCase: EvalCase): Promise<{ result: CaseResult; output?: CaseOutput }> {
  const { core, recorder, projectsDir, log = () => undefined, now = Date.now } = options;
  const started = now();
  const mark = recorder.mark();
  const baseline = await planWindows(core);
  log(`${evalCase.id}: transcribing ${evalCase.voiceover}`);
  const project = await core.project.create({
    voiceoverPath: evalCase.voiceover,
    name: evalCase.id,
    format: evalCase.format,
    stylePreset: evalCase.preset,
    folder: projectsDir,
  });
  const run: CaseRun = { options, evalCase, project, ref: { projectId: project.id, format: evalCase.format }, transcript: await transcribed(core, project.id) };

  try {
    log(`${evalCase.id}: generating`);
    const { generation, stored } = await generated(run);
    const { revisions, versions, outputs } = await revised(run, stored);
    const exportPath = await exported(run);
    const usage = await usageOf(run, baseline, recorder.planSince(mark));

    return {
      result: {
        id: evalCase.id,
        voiceover: evalCase.voiceover,
        voiceoverSeconds: project.voiceover.duration,
        format: evalCase.format,
        preset: evalCase.preset,
        models: versions.at(-1)?.version.models ?? {},
        generation,
        revisions,
        usage,
        exportPath,
        wallSeconds: seconds(now() - started),
      },
      output: caseOutput(run, stored, outputs),
    };
  } finally {
    await core.project.close({ projectId: project.id });
  }
}

/** Waits for the Project's Voiceover to be transcribed and answers with its Transcript. */
async function transcribed(core: CoreClient, projectId: string): Promise<Transcript> {
  for await (const status of await core.project.transcription({ projectId })) {
    if (status.state === "failed") {
      throw new Error(`Transcribing failed: ${status.error?.message ?? "no reason given"}`);
    }

    if (status.state === "done") {
      return { language: status.language ?? "auto", duration: status.duration, words: status.words };
    }
  }

  throw new Error("The transcription stream ended");
}

/** Reads statuses until one is settled, then stops listening. */
async function settled<T>(statuses: AsyncIterable<T>, isSettled: (status: T) => boolean, listening: AbortController): Promise<T> {
  try {
    for await (const status of statuses) {
      if (isSettled(status)) {
        return status;
      }
    }
  } finally {
    listening.abort();
  }

  throw new Error("The status stream ended");
}

async function generated(run: CaseRun): Promise<{ generation: GenerationResult; stored?: StoredVersion }> {
  const { options, ref, project } = run;
  const { core, recorder, now = Date.now } = options;
  const started = now();
  const mark = recorder.mark();
  const listening = new AbortController();
  const statuses = await core.video.generation(ref, { signal: listening.signal });
  await statuses.next();
  // The maintainer approved the whole eval's cost before it started.
  await core.video.generate({ ...ref, approved: true });
  const status = await settled(statuses, ({ state }) => state === "done" || state === "failed", listening);
  const sessions = recorder.since(mark);
  const stored = await storedVersion(project, ref, status.version);
  const lint = await firstTryTokenLint(run, sessions, stored, unitIds(status));

  return {
    generation: {
      state: settledState(status),
      error: status.error,
      version: status.version,
      storyboardAttempts: sum(sessionsOf(sessions, "storyboard").map(({ turns }) => turns.length)),
      storyboardFailed: status.error?.code === "STORYBOARD_INVALID",
      units: status.units.map((unit) => ({ ...unit, contractRetries: contractRetries(sessions, unit.id), firstTryTokenLint: lint.get(unit.id) })),
      reviewNotes: (stored?.version.flags ?? []).filter(({ kind }) => kind === "review-note").map(({ unit, reason }) => ({ unit, note: reason })),
      wallSeconds: seconds(now() - started),
    },
    stored,
  };
}

function settledState({ state }: GenerationStatus): "done" | "failed" {
  if (state === "done") {
    return "done";
  }

  return "failed";
}

function unitIds({ units }: GenerationStatus | RevisionStatus): string[] {
  return units.map(({ id }) => id);
}

const REVISION_SETTLED = new Set<RevisionStatus["state"]>(["answered", "done", "failed", "stopped"]);

/** Runs the case's scripted Revisions one after another, each on the newest Version; none when generating saved nothing. */
async function revised(
  run: CaseRun,
  generated: StoredVersion | undefined,
): Promise<{ revisions: RevisionResult[]; versions: StoredVersion[]; outputs: RevisionOutput[] }> {
  const { options, evalCase } = run;
  const { log = () => undefined } = options;
  const revisions: RevisionResult[] = [];
  const outputs: RevisionOutput[] = [];
  const versions = optional(generated);

  for (const scripted of evalCase.revisions) {
    const current = versions.at(-1);

    if (!current) {
      break;
    }

    log(`${evalCase.id}: revising (${scripted.scope})`);
    const { revision, stored, output } = await revisedBy(run, current, scripted);
    revisions.push(revision);
    versions.push(...optional(stored));
    outputs.push(...optional(output));
  }

  return { revisions, versions, outputs };
}

/** The first generation's outputs and those of each Revision that saved a Version; none when generating saved nothing. */
function caseOutput({ evalCase, transcript }: CaseRun, generated: StoredVersion | undefined, revisions: RevisionOutput[]): CaseOutput | undefined {
  if (!generated) {
    return undefined;
  }

  const { version, code } = generated;

  return {
    caseId: evalCase.id,
    preset: evalCase.preset,
    frameContractVersion: version.frameContractVersion,
    transcript: { duration: transcript.duration, words: transcript.words.map(({ text, start }) => ({ text, start })) },
    storyboard: version.storyboard,
    code,
    fallbacks: version.flags.filter(({ kind }) => kind === "fallback").map(({ unit }) => unit),
    revisions,
  };
}

/**
 * What a Revision that saved a Version leaves for the replay: its request, the patch it was saved from, and each
 * regenerated unit's code, or a fallback marker for a unit whose agent ended without passing code. An instruction-only
 * unit like that kept its previous code, so the Revision reports its Scenes as not applied rather than as a fallback.
 */
function revisionOutput(scripted: ScriptedRevision, sceneIds: string[], status: RevisionStatus, patches: unknown[], stored: StoredVersion | undefined): RevisionOutput | undefined {
  const patch = patches.at(-1);

  if (status.state !== "done" || !stored || patch === undefined) {
    return undefined;
  }

  const { data: storyboard } = StoryboardSchema.safeParse(stored.version.storyboard);
  const notApplied = new Set(status.notApplied ?? []);
  const isNotApplied = (unit: string) => (storyboard?.scenes ?? []).some(({ id, canvas }) => (canvas ?? id) === unit && notApplied.has(id));
  const regenerated = status.units.filter(({ rebuild }) => rebuild === "regenerate").map(({ id }) => id);
  const failed = regenerated.filter((unit) => isNotApplied(unit) || stored.code[unit] === undefined);

  return {
    request: scripted.message,
    scope: sceneIds,
    patch,
    code: Object.fromEntries(regenerated.filter((unit) => !failed.includes(unit)).flatMap((unit) => optional(stored.code[unit]).map((code) => [unit, code] as const))),
    fallbacks: failed,
  };
}

async function revisedBy(
  run: CaseRun,
  current: StoredVersion,
  scripted: ScriptedRevision,
): Promise<{ revision: RevisionResult; stored?: StoredVersion; output?: RevisionOutput }> {
  const { options, ref, project } = run;
  const { core, recorder, now = Date.now } = options;
  const started = now();
  const mark = recorder.mark();
  const { data: storyboard } = StoryboardSchema.safeParse(current.version.storyboard);
  const sceneIds = scopeOf(scripted, storyboard);
  const listening = new AbortController();
  const statuses = await core.video.revision(ref, { signal: listening.signal });
  await statuses.next();
  await core.video.revise({ ...ref, message: scripted.message, scope: sceneIds });
  const status = await revisionSettled(core, ref, statuses, listening);
  const sessions = recorder.since(mark);
  const handedInPatches = sessionsOf(sessions, "revision")
    .flatMap((session) => handedIn(session, SUBMIT_TOOLS.patch))
    .filter((patch) => patch !== undefined);
  const patches = handedInPatches.map((patch) => ({ issues: patchIssues(run, current, storyboard, patch, sceneIds) }));
  const stored = await storedVersion(project, ref, status.version);
  const regenerated = status.units.filter(({ rebuild }) => rebuild === "regenerate").map(({ id }) => id);
  const lint = await firstTryTokenLint(run, sessions, stored, regenerated);

  return {
    revision: {
      ...scripted,
      sceneIds,
      state: status.state,
      error: status.error,
      summary: status.summary,
      reply: status.reply,
      version: status.version,
      patches,
      firstPatchValid: patches[0]?.issues.length === 0,
      scopeViolations: patches.flatMap(({ issues }) => issues).filter(({ code }) => code === "SCOPE").length,
      units: status.units.map((unit) => ({ ...unit, contractRetries: contractRetries(sessions, unit.id), firstTryTokenLint: lint.get(unit.id) })),
      notApplied: status.notApplied ?? [],
      wallSeconds: seconds(now() - started),
    },
    stored,
    output: revisionOutput(scripted, sceneIds, status, handedInPatches, stored),
  };
}

/**
 * Reads a Revision's statuses until it settles, approving its regenerated Scenes' cost when it waits for that: the
 * maintainer approved the whole eval's cost before it started.
 */
async function revisionSettled(core: CoreClient, ref: VideoRef, statuses: AsyncIterable<RevisionStatus>, listening: AbortController): Promise<RevisionStatus> {
  try {
    for await (const status of statuses) {
      if (status.state === "approval") {
        await core.video.approveRevision(ref);
      }

      if (REVISION_SETTLED.has(status.state)) {
        return status;
      }
    }
  } finally {
    listening.abort();
  }

  throw new Error("The Revision's status stream ended");
}

/** A Scene-scoped Revision selects the middle Scene of the current Version; a whole-video one selects none. */
function scopeOf({ scope }: ScriptedRevision, storyboard: Storyboard | undefined): string[] {
  if (scope === "whole-video" || !storyboard) {
    return [];
  }

  return optional(storyboard.scenes[Math.floor(storyboard.scenes.length / 2)]?.id);
}

/** What the Revision agent's patch had wrong as handed in, checked as the Revision agent checks it. */
function patchIssues({ evalCase, transcript }: CaseRun, { version }: StoredVersion, storyboard: Storyboard | undefined, raw: unknown, scope: string[]): StoryboardIssue[] {
  const { success, data: patch, error } = z.object(PatchSchema).safeParse(raw);

  if (!success) {
    return [{ code: "SCHEMA", field: "", message: error.message }];
  }

  if (!storyboard) {
    return [];
  }

  const rulesFor = (captions: boolean) => storyboardRules(version.preset, { format: evalCase.format, captions });
  const { error: issues } = validatePatch({ current: storyboard, patch, transcript, rulesFor, writtenFor: version.captions, scope });

  return issues ?? [];
}

async function storedVersion(project: Project, { format }: VideoRef, version: number | undefined): Promise<StoredVersion | undefined> {
  if (version === undefined) {
    return undefined;
  }

  const { data: stored, error } = await readVersion(project.path, format, version);

  if (error) {
    throw new Error(`Version ${version} of ${project.name} can't be read: ${error.code}`);
  }

  return stored;
}

/**
 * Turns that sent a unit back to its agent: every turn of its Scene-code sessions after each session's first, less
 * the repair turns its visual reviews asked for.
 */
function contractRetries(sessions: RecordedSession[], unit: string): number {
  const writing = sessionsOf(sessions, `scene-code ${unit}`);
  const repairs = sessionsOf(sessions, `review ${unit}`).filter(asksForRepair).length;

  return Math.max(0, sum(writing.map(({ turns }) => turns.length)) - writing.length - repairs);
}

const VerdictSchema = z.object({ looksRight: z.boolean(), problems: z.array(z.string()) });

/** A review that found problems, which the Scene-code agent then gets one repair turn for. */
function asksForRepair(session: RecordedSession): boolean {
  return handedIn(session, SUBMIT_TOOLS.review).some((raw) => {
    const { success, data: verdict } = VerdictSchema.safeParse(raw);

    return success && !verdict.looksRight && verdict.problems.some((problem) => problem.trim() !== "");
  });
}

/**
 * Whether each unit's first code passed the token lint: the first code its agent handed in, checked in the Version's
 * Storyboard and Preset with every other unit drawn as its fallback Scene. Units that handed in nothing, or whose
 * code couldn't be checked, are left out.
 */
async function firstTryTokenLint({ options, evalCase, transcript }: CaseRun, sessions: RecordedSession[], stored: StoredVersion | undefined, units: string[]) {
  const firsts = Object.fromEntries(units.flatMap((unit) => optional(firstCode(sessions, unit)).map((code) => [unit, code] as const)));
  const checked = Object.keys(firsts);

  if (!stored || checked.length === 0) {
    return new Map<string, boolean>();
  }

  const { version } = stored;
  const rules = storyboardRules(version.preset, { format: evalCase.format, captions: version.captions });
  // The Checker being unavailable leaves the rate unmeasured rather than failing the eval.
  const report = await options.core.checker
    .check({ storyboard: version.storyboard, transcript, rules, preset: version.preset, code: firsts })
    .catch(() => undefined);

  if (!report) {
    return new Map<string, boolean>();
  }

  const failing = new Set(report.findings.filter(({ source }) => source === "tokens").map(({ unit }) => unit));

  return new Map(checked.map((unit) => [unit, !failing.has(unit)]));
}

function firstCode(sessions: RecordedSession[], unit: string): UnitCode | undefined {
  const [first] = sessionsOf(sessions, `scene-code ${unit}`);

  if (!first) {
    return undefined;
  }

  return UnitCodeSchema.safeParse(handedIn(first, SUBMIT_TOOLS.sceneCode).find((input) => input !== undefined)).data;
}

/** Exports the video as it now is, for the maintainer to watch before giving a verdict. */
async function exported({ options, evalCase, ref }: CaseRun): Promise<string | undefined> {
  const { core, exportDir, log = () => undefined } = options;

  if (!exportDir) {
    return undefined;
  }

  const { preview } = await core.video.open(ref);

  if (!preview) {
    return undefined;
  }

  const path = join(exportDir, `${evalCase.id}.mp4`);
  log(`${evalCase.id}: exporting ${path}`);

  for await (const status of await core.export.mp4({ previewId: preview.id, path, video: ref })) {
    if (status.state === "failed") {
      log(`${evalCase.id}: export failed (${status.error.code})`);
      return undefined;
    }

    if (status.state === "done") {
      return status.path;
    }
  }

  return undefined;
}

/** The usage module's first answer for `video`, or for no video. */
async function usageNow(core: CoreClient, video?: VideoRef): Promise<UsageStatus> {
  const listening = new AbortController();

  return settled(await core.usage.watch({ video }, { signal: listening.signal }), () => true, listening);
}

/** The plan windows as last reported before a case: the baseline its plan use is measured from. */
async function planWindows(core: CoreClient): Promise<PlanWindow[]> {
  return (await usageNow(core)).plan;
}

/**
 * A case's usage per minute of its Voiceover: dollars from the usage module's totals for the video on an API key, and
 * on a subscription each plan window's use from the baseline through every report during the case.
 */
async function usageOf({ options, ref, project }: CaseRun, baseline: PlanWindow[], reports: PlanUsage[]): Promise<UsageResult> {
  const { method, video } = await usageNow(options.core, ref);
  const minutes = Math.max(project.voiceover.duration, 1) / 60;
  const plan = planQuota(baseline, reports, minutes);

  if (method !== "api-key" || video?.costUsd === undefined) {
    return { total: video, plan };
  }

  return { total: video, costUsdPerMinute: video.costUsd / minutes, plan };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function optional<T>(value: T | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return [value];
}
