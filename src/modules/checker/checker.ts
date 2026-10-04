import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckFinding, StoryboardIssue, StoryboardRules, StoryboardTranscript, StylePreset, UnitCode } from "../../contract";
import { assemble, planUnits, type AssembledPage } from "../assembler";
import { FRAME_CONTRACT_VERSION, inlineIcons } from "../frame";
import { validateStoryboard } from "../storyboard";
import { checkContract } from "./contract";
import { runHyperframesCheck, type HyperframesError } from "./hyperframes";
import { openFramePage, type FramePageError } from "./page";
import { tokenLint } from "./token-lint";

export type CheckerOptions = {
  /** The pinned chrome-headless-shell binary. */
  chromePath: string;
};

export type CheckInput = {
  storyboard: unknown;
  transcript: StoryboardTranscript;
  rules: StoryboardRules;
  /** The video's Style Preset snapshot, which the frame draws the units in. */
  preset: StylePreset;
  /** Scene code per unit id; a unit without code is drawn as its fallback Scene. */
  code: Record<string, UnitCode>;
};

export type CheckReport = {
  frameContractVersion: string;
  /** Every finding, each mapped to its unit where it has one. None means every unit passes. */
  findings: CheckFinding[];
};

export type CheckerError =
  | { code: "INVALID_STORYBOARD"; issues: StoryboardIssue[] }
  | { code: "UNKNOWN_UNIT"; unit: string; units: string[] }
  | { code: "CHROME_MISSING"; path: string }
  | { code: "PAGE_FAILED"; message: string }
  | FramePageError
  | HyperframesError;

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type CheckResult = Result<CheckReport, CheckerError>;

export type Checker = ReturnType<typeof createChecker>;

/**
 * Checks Scene code inside the frame: it assembles the Storyboard's units into a page in a
 * temporary folder, runs `hyperframes lint` and `check`, the token lint, icon lookup and the anchor
 * contract, and reports every finding against the unit it belongs to.
 */
export function createChecker({ chromePath }: CheckerOptions) {
  async function check({ storyboard: raw, transcript, rules, preset, code }: CheckInput): Promise<CheckResult> {
    const { data: storyboard, error } = validateStoryboard(raw, transcript, rules);

    if (error) {
      return { data: null, error: { code: "INVALID_STORYBOARD", issues: error.issues } };
    }

    const unitIds = planUnits(storyboard, transcript).map(({ id }) => id);
    const unknown = Object.keys(code).find((unit) => !unitIds.includes(unit));

    if (unknown) {
      return { data: null, error: { code: "UNKNOWN_UNIT", unit: unknown, units: unitIds } };
    }

    if (!(await exists(chromePath))) {
      return { data: null, error: { code: "CHROME_MISSING", path: chromePath } };
    }

    const dir = await mkdtemp(join(tmpdir(), "motionbrief-check-"));

    try {
      const { data: assembled, error: assembleError } = await assembleIn(dir, { storyboard, transcript, preset, code });

      if (assembleError) {
        return { data: null, error: assembleError };
      }

      const { data: pageFindings, error: pageError } = await checkPage(dir, assembled);

      if (pageError) {
        return { data: null, error: pageError };
      }

      const codeFindings = await Promise.all(Object.entries(code).map(([unit, unitCode]) => checkCode(unit, unitCode)));

      return { data: { frameContractVersion: FRAME_CONTRACT_VERSION, findings: [...codeFindings.flat(), ...pageFindings] }, error: null };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** `hyperframes check` and the contract each play the page in their own browser, side by side. */
  async function checkPage(dir: string, assembled: AssembledPage): Promise<Result<CheckFinding[], CheckerError>> {
    const [hyperframes, contract] = await Promise.all([
      runHyperframesCheck({ dir, chromePath, units: assembled.units }),
      probeContract(dir, assembled),
    ]);

    if (hyperframes.error) {
      return { data: null, error: hyperframes.error };
    }

    if (contract.error) {
      return { data: null, error: contract.error };
    }

    return { data: [...hyperframes.data, ...contract.data], error: null };
  }

  async function probeContract(dir: string, assembled: AssembledPage): Promise<Result<CheckFinding[], FramePageError>> {
    const { data: page, error } = await openFramePage({ dir, chromePath, width: assembled.width, height: assembled.height });

    if (error) {
      return { data: null, error };
    }

    try {
      return { data: await checkContract(page, assembled), error: null };
    } finally {
      await page.close();
    }
  }

  return { check };
}

/** What can be checked in the code alone: tokens and icon names. */
async function checkCode(unit: string, code: UnitCode): Promise<CheckFinding[]> {
  const { unknownIcons } = await inlineIcons(code.html);

  return [
    ...tokenLint(unit, code),
    ...unknownIcons.map((name) => ({
      unit,
      source: "icons" as const,
      code: "UNKNOWN_ICON",
      message: `There is no icon "${name}". Use "lucide:<name>" from Lucide or "brand:<slug>" from Simple Icons.`,
    })),
  ];
}

async function assembleIn(dir: string, options: Omit<Parameters<typeof assemble>[0], "dir">) {
  try {
    return { data: await assemble({ dir, ...options }), error: null };
  } catch (error) {
    return { data: null, error: { code: "PAGE_FAILED", message: String((error as Error).message ?? error) } satisfies CheckerError };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
