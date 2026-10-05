import type { StoryboardIssue, StoryboardRules, StoryboardTranscript } from "../../contract";
import { validateStoryboard, type Storyboard } from "../storyboard";
import { applyPatch, type Patch } from "./patch";
import { scopeIssues } from "./scope";

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type PatchCheck = {
  /** The Storyboard the patch revises. */
  current: Storyboard;
  patch: Patch;
  transcript: StoryboardTranscript;
  /** The Storyboard rules with Captions on or off. */
  rulesFor: (captions: boolean) => StoryboardRules;
  /** Whether the Storyboard was written for Captions: its rules, unless the patch switches them. */
  writtenFor: boolean;
  /** The selected Scenes; none for the whole video. */
  scope: string[];
};

/**
 * Applies a Revision's patch and checks the revised Storyboard: valid by the Storyboard rules, instructing only
 * Scenes it has, and changing nothing outside the selected Scenes. Answers with the revised Storyboard or every issue.
 */
export function validatePatch({ current, patch, transcript, rulesFor, writtenFor, scope }: PatchCheck): Result<Storyboard, StoryboardIssue[]> {
  const { data: revised, error } = validateStoryboard(applyPatch(current, patch), transcript, rulesFor(patch.captions ?? writtenFor));

  if (error) {
    return { data: null, error: error.issues };
  }

  const issues = [...unknownScenes(patch, revised), ...scopeIssues(current, revised, patch, scope)];

  if (issues.length > 0) {
    return { data: null, error: issues };
  }

  return { data: revised, error: null };
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
