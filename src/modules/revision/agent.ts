import type { ConnectorError, StoryboardIssue, StoryboardRules, StylePreset, Transcript } from "../../contract";
import { defineHostTool } from "../connector";
import { RETRIES, sendTurn, withSession, type AgentRun } from "../generation";
import type { RevisionRecord } from "../projects";
import { validateStoryboard, type Storyboard } from "../storyboard";
import type { PresetBrief } from "../style";
import { applyPatch, PatchSchema, type Patch } from "./patch";
import { PATCH_TOOL, patchIssuesMessage, revisionMessage, revisionSystem } from "./prompts";
import { scopeIssues } from "./scope";

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** What the Revision agent came back with: a reply that changes nothing, or a valid revised Storyboard. */
export type AgentOutcome = {
  /** The answer or clarifying question, when the agent handed in no patch. */
  reply?: string;
  /** The revised Storyboard, valid and within the scope, and the patch it came from. */
  storyboard?: Storyboard;
  patch?: Patch;
};

export type AgentError = { code: "PATCH_INVALID"; issues: StoryboardIssue[] } | { code: "AGENT_FAILED"; error: ConnectorError };

type RevisionRun = AgentRun & {
  storyboard: Storyboard;
  transcript: Transcript;
  /** The Storyboard rules with Captions on or off. */
  rulesFor: (captions: boolean) => StoryboardRules;
  preset: StylePreset;
  brief: PresetBrief;
  captions: boolean;
  history: RevisionRecord[];
  request: string;
  scope: string[];
};

/**
 * The Revision agent: a fresh session per Revision that reads the request with the current Storyboard, Transcript,
 * Style Preset, scope and earlier Revisions. A patch is applied to the Storyboard and validated, and sent back with
 * its issues at most twice. A turn that hands in no patch is a reply.
 */
export async function runRevisionAgent({ storyboard, transcript, rulesFor, preset, brief, captions, history, request, scope, ...run }: RevisionRun): Promise<Result<AgentOutcome, AgentError>> {
  let submitted: Patch | undefined;
  const submit = defineHostTool({
    name: PATCH_TOOL,
    description: "Hands in the Revision as a Storyboard patch. MotionBrief applies and validates it when your turn ends and sends back every issue.",
    input: PatchSchema,
    run: async (patch) => {
      submitted = patch;

      return { text: "Received. MotionBrief validates the revised Storyboard when your turn ends." };
    },
  });
  const setup = { label: "revision", systemPrompt: revisionSystem(rulesFor(captions), brief), hostTools: [submit] };

  return withSession<AgentOutcome, AgentError>(run, setup, async (session) => {
    let message = revisionMessage({ storyboard, transcript, preset, captions, history, request, scope });
    let issues: StoryboardIssue[] = [];

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      submitted = undefined;
      const { data: text, error: turnError } = await sendTurn(session, message);

      if (turnError) {
        return { data: null, error: { code: "AGENT_FAILED", error: turnError } };
      }

      if (!submitted) {
        // Only a first turn may answer; a retry that hands in nothing leaves the patch invalid.
        if (attempt === 0) {
          return { data: { reply: text.trim() }, error: null };
        }

        message = patchIssuesMessage(issues);
        continue;
      }

      const patch: Patch = submitted;
      const { data: revised, error } = validateStoryboard(applyPatch(storyboard, patch), transcript, rulesFor(patch.captions ?? captions));

      if (error) {
        issues = error.issues;
        message = patchIssuesMessage(issues);
        continue;
      }

      issues = [...unknownScenes(patch, revised), ...scopeIssues(storyboard, revised, patch, scope)];

      if (issues.length === 0) {
        return { data: { storyboard: revised, patch }, error: null };
      }

      message = patchIssuesMessage(issues);
    }

    return { data: null, error: { code: "PATCH_INVALID", issues } };
  });
}

/** Instructions for Scenes the revised Storyboard doesn't have. */
function unknownScenes({ instructions }: Patch, storyboard: Storyboard): StoryboardIssue[] {
  return instructions.flatMap(({ scene }, index) => {
    if (storyboard.scenes.some(({ id }) => id === scene)) {
      return [];
    }

    return [{ code: "REFERENCE", field: `instructions[${index}].scene`, message: `There is no Scene "${scene}" in the revised Storyboard.` }];
  });
}
