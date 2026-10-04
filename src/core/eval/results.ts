import type { Format, GenerationError, PlanWindow, RevisionError, RevisionStatus, SceneStatus, StoryboardIssue, UsageTotals } from "../../contract";
import type { PlanUsage } from "../../modules/connector";
import type { BundledPresetId, ScriptedRevision } from "./release-set";

/** A stable release is blocked above this share of units ending as fallback Scenes. */
export const MAX_FALLBACK_RATE = 0.05;

export type UnitResult = {
  id: string;
  status: SceneStatus;
  /** Scene code handed in, the repair pass included. */
  attempts: number;
  /** Turns that sent the unit back to its agent with the checks' findings (or for code it didn't hand in); the repair pass isn't one. */
  contractRetries: number;
  /** The first code handed in had no token-lint finding; absent when no code was handed in or it couldn't be checked. */
  firstTryTokenLint?: boolean;
};

export type GenerationResult = {
  state: "done" | "failed";
  error?: GenerationError;
  version?: number;
  /** Turns the Storyboard agent took: 1 when its first Storyboard was valid. */
  storyboardAttempts: number;
  /** The Storyboard still had issues after its retries. */
  storyboardFailed: boolean;
  units: UnitResult[];
  /** The visual reviewer's complaints that stood after a reverted repair, by unit. */
  reviewNotes: { unit: string; note: string }[];
  wallSeconds: number;
};

export type RevisionResult = ScriptedRevision & {
  /** The Scenes it was scoped to; none for the whole video. */
  sceneIds: string[];
  state: RevisionStatus["state"];
  error?: RevisionError;
  summary?: string;
  reply?: string;
  version?: number;
  /** Patches the agent handed in, and the issues each had: none means the patch was valid as handed in. */
  patches: { issues: StoryboardIssue[] }[];
  /** The first patch was valid and within the scope. */
  firstPatchValid: boolean;
  /** Issues where a patch changed Scenes outside the selected ones, across every patch handed in. */
  scopeViolations: number;
  units: (UnitResult & { rebuild: "rerender" | "regenerate" })[];
  notApplied: string[];
  wallSeconds: number;
};

export type UsageResult = {
  /** Everything the video's runs used, as the usage module stores it with the video: tokens and, on an API key, dollars. */
  total?: UsageTotals;
  /** API key only: dollars per Voiceover minute. */
  costUsdPerMinute?: number;
  /** Subscription only: how much of each plan window the case used. */
  plan: PlanQuota[];
};

/** A plan window's share used per Voiceover minute, or `unavailable` when the reports can't say. */
export type PlanQuota = { window: PlanWindow["window"]; utilizationPerMinute: number | "unavailable"; resetsAt?: number };

/** A plan window's utilization at one moment: the usage module's last report before the case, or a report during it. */
type PlanReport = { window: PlanUsage["window"]; utilization?: number; resetsAt?: number };

const PLAN_WINDOWS: PlanWindow["window"][] = ["five-hour", "seven-day"];

/**
 * How much of each plan window a case used, from the window's last report before the case (the baseline) through
 * every report during it. A window counts from zero again once its reset time changes. Without a baseline or a report
 * during the case, the use can't be told apart from what came before, so it is `unavailable`.
 */
export function planQuota(baseline: PlanReport[], reports: PlanReport[], minutes: number): PlanQuota[] {
  return PLAN_WINDOWS.map((window) => {
    const start = baseline.find((report) => report.window === window && report.utilization !== undefined);
    const during = reports.filter((report) => report.window === window && report.utilization !== undefined);
    const resetsAt = during.at(-1)?.resetsAt ?? start?.resetsAt;

    if (!start || during.length === 0) {
      return { window, utilizationPerMinute: "unavailable", resetsAt };
    }

    const series = [start, ...during];
    const used = sum(series.slice(1).map((report, index) => usedSince(series[index] ?? start, report)));

    return { window, utilizationPerMinute: used / minutes, resetsAt };
  });
}

/** What a window gained from one report to the next: all of the later one's use when the window reset in between. */
function usedSince(previous: PlanReport, report: PlanReport): number {
  const hasReset = previous.resetsAt !== undefined && report.resetsAt !== undefined && report.resetsAt !== previous.resetsAt;

  if (hasReset) {
    return report.utilization ?? 0;
  }

  return Math.max(0, (report.utilization ?? 0) - (previous.utilization ?? 0));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export type CaseResult = {
  id: string;
  voiceover: string;
  voiceoverSeconds: number;
  format: Format;
  preset: BundledPresetId;
  /** The model each agent role ran on, as the video's newest Version records it. */
  models: Record<string, string>;
  generation: GenerationResult;
  revisions: RevisionResult[];
  usage: UsageResult;
  /** The exported MP4 the maintainer judged, outside the repo. */
  exportPath?: string;
  wallSeconds: number;
};

export type Verdict = { looksRight: boolean; note: string };

export type EvalResult = {
  runId: string;
  appVersion: string;
  frameContractVersion: string;
  connection: { method?: string; plan?: string };
  startedAt: string;
  wallSeconds: number;
  cases: CaseResult[];
  /** Across every unit the agent wrote: first generations and units Revisions regenerated. */
  fallbackRate: number;
  /** Units whose first code passed the token lint, of those that were checked. */
  firstTryTokenLintRate?: number;
  verdict: Verdict;
  blocked: boolean;
  blockReasons: string[];
};

/** Every unit an agent wrote in the case: the first generation's and those its Revisions regenerated. */
export function writtenUnits({ generation, revisions }: Pick<CaseResult, "generation" | "revisions">): UnitResult[] {
  return [...generation.units, ...revisions.flatMap(({ units }) => units.filter(({ rebuild }) => rebuild === "regenerate"))];
}

export function fallbackRate(cases: Pick<CaseResult, "generation" | "revisions">[]): number {
  const units = cases.flatMap(writtenUnits);

  if (units.length === 0) {
    return 0;
  }

  return units.filter(({ status }) => status === "fallback").length / units.length;
}

export function firstTryTokenLintRate(cases: Pick<CaseResult, "generation" | "revisions">[]): number | undefined {
  const checked = cases.flatMap(writtenUnits).flatMap(({ firstTryTokenLint }) => firstTryTokenLint ?? []);

  if (checked.length === 0) {
    return undefined;
  }

  return checked.filter(Boolean).length / checked.length;
}

type Measured = Pick<EvalResult, "cases" | "fallbackRate" | "verdict">;

/** What blocks a stable release, each with the reason the report gives. */
const BLOCKS: { blocks: (result: Measured) => boolean; reason: (result: Measured) => string }[] = [
  {
    blocks: ({ fallbackRate }) => fallbackRate > MAX_FALLBACK_RATE,
    reason: ({ fallbackRate }) => `The fallback rate is ${percent(fallbackRate)}, above ${percent(MAX_FALLBACK_RATE)}.`,
  },
  {
    blocks: ({ cases }) => cases.some(({ generation }) => generation.storyboardFailed),
    reason: ({ cases }) => `The Storyboard failed after its retries in ${idsWhere(cases, ({ generation }) => generation.storyboardFailed)}.`,
  },
  {
    blocks: ({ cases }) => cases.some(({ generation }) => generation.state === "failed" && !generation.storyboardFailed),
    reason: ({ cases }) => `The eval is incomplete: generating ${idsWhere(cases, ({ generation }) => generation.state === "failed" && !generation.storyboardFailed)} failed.`,
  },
  {
    blocks: ({ verdict }) => !verdict.looksRight,
    reason: ({ verdict }) => `The human verdict is no: ${verdict.note || "no note"}`,
  },
];

/** Why the release is blocked: a fallback rate above 5%, a Storyboard failing after retries, an incomplete run, or a human no. */
export function blockReasons(result: Measured): string[] {
  return BLOCKS.filter(({ blocks }) => blocks(result)).map(({ reason }) => reason(result));
}

function idsWhere(cases: CaseResult[], matches: (result: CaseResult) => boolean): string {
  return cases
    .filter(matches)
    .map(({ id }) => id)
    .join(", ");
}

function percent(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}
