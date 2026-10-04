import type { CheckFinding } from "../../contract";
import type { Checker, CheckerError, CheckInput } from "../checker";
import { FRAME_CONTRACT_VERSION } from "../frame";
import { findingLine } from "./prompts";

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/**
 * Whether units written against `version` are checked again before they play: only across a frame major release,
 * since minor and patch releases keep old units passing (the tier-2 replay corpus holds them to it).
 */
export function needsRecheck(version: string): boolean {
  return major(version) !== major(FRAME_CONTRACT_VERSION);
}

function major(version: string): string {
  return version.split(".")[0] ?? version;
}

/**
 * Checks a video's units in the current frame, with no agent, and answers with why each failing unit fails. The
 * whole page is checked once; findings that name no unit and that the page doesn't have without any unit's code
 * are pinned on their unit by checking the units one at a time.
 */
export async function failingUnits(checker: Checker, input: CheckInput): Promise<Result<Map<string, string>, CheckerError>> {
  const { data: report, error } = await checker.check(input);

  if (error) {
    return { data: null, error };
  }

  const units = Object.keys(input.code);
  const failing = new Map<string, CheckFinding[]>();
  const add = (unit: string, finding: CheckFinding) => failing.set(unit, [...(failing.get(unit) ?? []), finding]);
  report.findings.filter(({ unit }) => unit !== undefined && units.includes(unit)).forEach((finding) => add(finding.unit as string, finding));

  const unattributed = report.findings.filter(({ unit }) => unit === undefined);

  if (unattributed.length > 0) {
    const { data: baseline, error: baselineError } = await checker.check({ ...input, code: {} });

    if (baselineError) {
      return { data: null, error: baselineError };
    }

    const known = new Set(baseline.findings.map(findingKey));

    if (unattributed.some((finding) => !known.has(findingKey(finding)))) {
      for (const [unit, code] of Object.entries(input.code).filter(([id]) => !failing.has(id))) {
        const { data: alone, error: aloneError } = await checker.check({ ...input, code: { [unit]: code } });

        if (aloneError) {
          return { data: null, error: aloneError };
        }

        alone.findings.filter((finding) => finding.unit === undefined && !known.has(findingKey(finding))).forEach((finding) => add(unit, finding));
      }
    }
  }

  return { data: new Map([...failing].map(([unit, findings]) => [unit, findings.map(findingLine).join("\n")])), error: null };
}

function findingKey({ source, code, message, selector }: CheckFinding): string {
  return JSON.stringify([source, code, message, selector]);
}
