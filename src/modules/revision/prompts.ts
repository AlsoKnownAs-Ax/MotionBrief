import type { StoryboardIssue, StoryboardRules, StylePreset, Transcript, UnitCode } from "../../contract";
import { issueLine, storyboardSystem } from "../generation";
import type { RevisionRecord } from "../projects";
import type { Storyboard } from "../storyboard";
import type { PresetBrief } from "../style";

/**
 * What the Revision agent is told. It reads one request and either answers it, asks one clarifying
 * question, or hands in a Storyboard patch with a one-line summary. It never decides what gets
 * rebuilt; it is told that our code works that out from the patch.
 */

export const PATCH_TOOL = "submit_patch";

export function revisionSystem(rules: StoryboardRules, brief: PresetBrief): string {
  return `You revise a MotionBrief video. MotionBrief turned a Voiceover into a motion-graphics explainer: a Storyboard of Scenes, each animated by its own Scene code inside a frame MotionBrief owns. The creator now asks for a change in chat.

Read the request, then do exactly one of these:
- If it is a question about the video, answer it in a sentence or two and hand in nothing.
- If it is too vague to act on, ask one short clarifying question and hand in nothing.
- Otherwise hand in a Storyboard patch with the ${PATCH_TOOL} tool, then end your turn.

THE PATCH:
- "scenes" holds whole Scenes in the Storyboard's shape. Each replaces the Scene with the same id; a new id adds a Scene. "remove" lists Scene ids to drop. Scenes still tile the whole Transcript afterwards, so changing a span means changing its neighbour's too.
- "instructions" carry what the Storyboard can't say about a Scene's look or motion ("make the arrows thicker", "slow the reveals"). Give one only when the request asks for that; content, wording, anchor words, spans and Transitions go in the Scenes themselves.
- "summary" is one line for the creator on what changes, such as "Moved the cache hit to its own Scene and shortened the hook."
- Change only what the request asks for. When it names Scenes, touch only those, and their neighbours' spans when you must.
- MotionBrief validates the revised Storyboard and sends back every issue to fix. It works out on its own which Scenes to rebuild: timing changes re-render, content changes and instructions rewrite a Scene's code. Never say which Scenes will be rebuilt.

The Storyboard follows the rules its author was given:

${storyboardSystem(rules, brief)}`;
}

type RevisionContext = {
  storyboard: Storyboard;
  transcript: Transcript;
  preset: StylePreset;
  captions: boolean;
  /** The video's earlier Revisions, oldest first. */
  history: RevisionRecord[];
  request: string;
  scope: string[];
};

/** The request with what it is about: the Transcript, the current Storyboard, the Style Preset, the scope and earlier Revisions. */
export function revisionMessage({ storyboard, transcript, preset, captions, history, request, scope }: RevisionContext): string {
  const earlier = history.map(({ request: asked, summary }) => `- "${asked}": ${summary}`).join("\n");

  return `Transcript (index:word, with the time each word starts):
${transcript.words.map(({ text, start }, index) => `${index}:${text}@${start.toFixed(1)}`).join(" ")}

The current Storyboard:
${JSON.stringify(storyboard, null, 1)}

Style Preset "${preset.name}": ${preset.direction}
Captions are ${captions ? "on" : "off"}.
${earlier ? `\nEarlier Revisions, oldest first:\n${earlier}\n` : ""}
${scope.length > 0 ? `The creator selected Scenes ${scope.join(", ")}: the request is about them.` : "No Scenes are selected: the request is about the whole video."}

The request:
${request}`;
}

export function patchIssuesMessage(issues: StoryboardIssue[]): string {
  return `The validator rejected the revised Storyboard. Fix every issue and hand in the whole patch again with ${PATCH_TOOL}:
${issues.map(issueLine).join("\n")}`;
}

/** What a Scene-code subagent regenerating a unit is told on top of its brief: the instructions, and the code it had. */
export function regenerateRequest(instructions: string[], previous: UnitCode | undefined): string {
  const asked = instructions.length > 0 ? `THE CREATOR ASKED FOR THIS CHANGE:\n${instructions.map((text) => `- ${text}`).join("\n")}\n\n` : "";

  if (!previous) {
    return asked.trim();
  }

  return `${asked}The unit's code before this Revision, which passed every check. Keep what still fits and change what the Storyboard entries or the request now ask for:
${JSON.stringify(previous, null, 1)}`;
}
