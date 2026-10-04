import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { CheckFinding, ConnectorError, StoryboardIssue, StoryboardRules, StylePreset, Transcript, UnitCode } from "../../contract";
import type { Unit } from "../assembler";
import type { Checker } from "../checker";
import { defineHostTool, type Connector, type HostTool, type Session } from "../connector";
import { StoryboardSchema, validateStoryboard, type Storyboard } from "../storyboard";
import type { PresetBrief } from "../style";
import {
  findingLine,
  findingsMessage,
  noCodeMessage,
  noStoryboardMessage,
  SCENE_CODE_TOOL,
  sceneCodeSystem,
  STORYBOARD_TOOL,
  storyboardIssuesMessage,
  storyboardMessage,
  storyboardSystem,
  unitMessage,
} from "./prompts";

/** A Storyboard or a unit's code gets its first try and at most this many more. */
export const RETRIES = 2;

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type AgentRun = {
  connector: Connector;
  model: string;
  /** A folder of its own sessions can be given as their workspace. */
  workDir: string;
  /** Aborting interrupts the agent's turn. */
  signal?: AbortSignal;
};

export type StoryboardError = { code: "STORYBOARD_INVALID"; issues: StoryboardIssue[] } | { code: "AGENT_FAILED"; error: ConnectorError };

type StoryboardRun = AgentRun & { transcript: Transcript; rules: StoryboardRules; brief: PresetBrief };

/** The Storyboard agent: plans the Storyboard, retried with the validator's issues until it is valid. */
export async function writeStoryboard({ transcript, rules, brief, ...run }: StoryboardRun): Promise<Result<Storyboard, StoryboardError>> {
  let submitted: unknown;
  const submit = defineHostTool({
    name: STORYBOARD_TOOL,
    description: "Hands in the whole Storyboard. MotionBrief validates it when your turn ends and sends back every issue.",
    input: { storyboard: StoryboardSchema },
    run: async ({ storyboard }) => {
      submitted = storyboard;

      return { text: "Received. MotionBrief validates the Storyboard when your turn ends." };
    },
  });

  const setup = { label: "storyboard", systemPrompt: storyboardSystem(rules, brief), hostTools: [submit] };

  return withSession(run, setup, async (session): Promise<Result<Storyboard, StoryboardError>> => {
    let message = storyboardMessage(transcript);
    let issues: StoryboardIssue[] = [];

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      submitted = undefined;
      const turnError = await runTurn(session, message);

      if (turnError) {
        return { data: null, error: { code: "AGENT_FAILED", error: turnError } };
      }

      if (submitted === undefined) {
        issues = [{ code: "SCHEMA", field: "", message: "No Storyboard was handed in." }];
        message = noStoryboardMessage();
        continue;
      }

      const { data: storyboard, error } = validateStoryboard(submitted, transcript, rules);

      if (!error) {
        return { data: storyboard, error: null };
      }

      issues = error.issues;
      message = storyboardIssuesMessage(issues);
    }

    return { data: null, error: { code: "STORYBOARD_INVALID", issues } };
  });
}

/** How a unit ended: its passing Scene code, or why it plays as its fallback Scene. */
export type UnitOutcome = { code: UnitCode; attempts: number } | { code: null; attempts: number; reason: string };

type UnitRun = AgentRun & {
  checker: Checker;
  storyboard: Storyboard;
  transcript: Transcript;
  rules: StoryboardRules;
  preset: StylePreset;
  brief: PresetBrief;
  unit: Unit;
  /** What the Checker finds on the page with no unit's code, so page-wide findings the unit didn't cause are told apart. */
  baseline: CheckFinding[];
  /** The unit is being written (`attempts` handed in so far) or checked. */
  onProgress: (status: "writing" | "checking", attempts: number) => void;
  /** Said after the unit's brief in the first message, such as what a Revision asks of it. */
  request?: string;
};

/**
 * A Scene-code subagent: writes one unit, which the Checker checks on its own (every other unit drawn
 * as its fallback Scene), and rewrites it with the findings at most twice. A finding that names no unit
 * counts against it unless the page has it without the unit's code too.
 */
export async function writeUnitCode({ checker, storyboard, transcript, rules, preset, brief, unit, baseline, onProgress, request, ...run }: UnitRun): Promise<UnitOutcome> {
  let submitted: UnitCode | undefined;
  const submit = defineHostTool({
    name: SCENE_CODE_TOOL,
    description: "Hands in the unit's whole Scene code. MotionBrief wraps it into the unit's composition and checks it when your turn ends.",
    input: {
      css: z.string().describe("the unit's CSS"),
      html: z.string().describe("the unit's markup, which goes inside its root"),
      js: z.string().describe("statements that add to tl, the unit's paused GSAP timeline"),
    },
    run: async (code) => {
      submitted = code;

      return { text: "Received. MotionBrief checks the unit when your turn ends." };
    },
  });
  const options = { label: `scene-code ${unit.id}`, systemPrompt: sceneCodeSystem(storyboard.format, brief), hostTools: [submit] };
  let attempts = 0;

  const outcome = await withSession(run, options, async (session): Promise<Result<UnitOutcome, never>> => {
    let message = request ? `${unitMessage({ storyboard, preset, unit, transcript })}\n\n${request}` : unitMessage({ storyboard, preset, unit, transcript });
    let reason = "";

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      submitted = undefined;
      onProgress("writing", attempts);
      const turnError = await runTurn(session, message);

      if (turnError) {
        return { data: { code: null, attempts, reason: `The agent stopped: ${turnError.message}` }, error: null };
      }

      if (!submitted) {
        reason = "No code was handed in.";
        message = noCodeMessage();
        continue;
      }

      attempts += 1;
      onProgress("checking", attempts);
      const code = submitted;
      const { data: report, error } = await checker.check({ storyboard, transcript, rules, preset, code: { [unit.id]: code } });

      if (error) {
        return { data: { code: null, attempts, reason: `The checks couldn't run: ${error.code}` }, error: null };
      }

      const known = new Set(baseline.map(findingKey));
      const findings = report.findings.filter((finding) => finding.unit === unit.id || (finding.unit === undefined && !known.has(findingKey(finding))));

      if (findings.length === 0) {
        return { data: { code, attempts }, error: null };
      }

      reason = summary(findings);
      message = findingsMessage(findings);
    }

    return { data: { code: null, attempts, reason }, error: null };
  });

  if (outcome.error) {
    return { code: null, attempts, reason: `The agent couldn't start: ${outcome.error.error.message}` };
  }

  return outcome.data;
}

function findingKey({ source, code, message, selector }: CheckFinding): string {
  return JSON.stringify([source, code, message, selector]);
}

/** The findings a fallback is flagged with. */
function summary(findings: CheckFinding[]): string {
  return findings.map(findingLine).join("\n");
}

export type SessionSetup = { label: string; systemPrompt: string; hostTools: HostTool[] };

/** Runs `work` in a fresh session with a workspace folder of its own, closing both afterwards. */
export async function withSession<T, E>(
  { connector, model, workDir, signal }: AgentRun,
  setup: SessionSetup,
  work: (session: Session) => Promise<Result<T, E>>,
): Promise<Result<T, E | { code: "AGENT_FAILED"; error: ConnectorError }>> {
  const workspaceDir = join(workDir, randomUUID());
  await mkdir(workspaceDir, { recursive: true });

  try {
    const { data: session, error } = await connector.startSession({ ...setup, workspaceDir, model, sandbox: { allowShell: false } });

    if (error) {
      return { data: null, error: { code: "AGENT_FAILED", error } };
    }

    const interrupt = () => void session.interrupt();
    signal?.addEventListener("abort", interrupt);

    try {
      return await work(session);
    } finally {
      signal?.removeEventListener("abort", interrupt);
      session.close();
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

/** Sends one message and waits for the agent's turn to end; a turn that doesn't complete answers with its error. */
async function runTurn(session: Session, message: string): Promise<ConnectorError | undefined> {
  const { error } = await sendTurn(session, message);

  return error ?? undefined;
}

/** Sends one message and resolves with the text the agent's turn ended on, or the error it ended with. */
export async function sendTurn(session: Session, message: string): Promise<Result<string, ConnectorError>> {
  for await (const event of session.sendTurn(message)) {
    if (event.type !== "turn-completed") {
      continue;
    }

    if (event.status === "completed") {
      return { data: event.text ?? "", error: null };
    }

    return { data: null, error: event.error ?? { code: "SERVICE_ERROR", message: `The agent's turn ended ${event.status}` } };
  }

  return { data: null, error: { code: "AGENT_UNAVAILABLE", message: "The agent's turn ended without completing" } };
}
