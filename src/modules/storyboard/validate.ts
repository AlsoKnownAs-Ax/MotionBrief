import type { z } from "zod";
import type { StoryboardIssue, StoryboardRules, StoryboardTranscript } from "../../contract";
import { CHECKS } from "./checks";
import { StoryboardSchema, type Storyboard } from "./schema";

export type StoryboardResult =
  | { data: Storyboard; error: null }
  | { data: null; error: { code: "INVALID_STORYBOARD"; issues: StoryboardIssue[] } };

/**
 * Checks an agent-written Storyboard against its Transcript, Format, Captions and Style Preset.
 * Every issue names the Scene and field at fault, so the list can go back to the agent as is.
 */
export function validateStoryboard(raw: unknown, transcript: StoryboardTranscript, rules: StoryboardRules): StoryboardResult {
  const { success, data: storyboard, error } = StoryboardSchema.safeParse(raw);

  if (!success) {
    return invalid(error.issues.flatMap((issue) => schemaIssues(raw, issue)));
  }

  const issues = CHECKS.flatMap((check) => check({ storyboard, transcript, rules }));

  if (issues.length > 0) {
    return invalid(issues);
  }

  return { data: storyboard, error: null };
}

function invalid(issues: StoryboardIssue[]): StoryboardResult {
  return { data: null, error: { code: "INVALID_STORYBOARD", issues } };
}

/** One issue per schema problem; an object with unknown fields gets one issue per field, located at that field. */
function schemaIssues(raw: unknown, issue: z.core.$ZodIssue): StoryboardIssue[] {
  if (issue.code !== "unrecognized_keys") {
    return [{ code: "SCHEMA", ...locate(raw, issue.path), message: issue.message }];
  }

  return issue.keys.map((key) => ({
    code: "SCHEMA",
    ...locate(raw, [...issue.path, key]),
    message: `"${key}" isn't a field here; a Storyboard holds structure and content only, no layout or motion.`,
  }));
}

/** Where a schema issue is: the Scene it sits in, if that Scene has a usable id, and the field path below it. */
function locate(raw: unknown, path: PropertyKey[]): Pick<StoryboardIssue, "sceneId" | "field"> {
  const [root, index, ...rest] = path;
  const sceneId = rawSceneId(raw, index);

  if (root !== "scenes" || !sceneId) {
    return { field: fieldPath(path) };
  }

  return { sceneId, field: fieldPath(rest) };
}

function rawSceneId(raw: unknown, index: PropertyKey | undefined): string | undefined {
  if (typeof index !== "number") {
    return undefined;
  }

  const scenes = (raw as { scenes?: unknown } | null)?.scenes;

  if (!Array.isArray(scenes)) {
    return undefined;
  }

  const id = (scenes[index] as { id?: unknown } | null)?.id;

  if (typeof id !== "string" || id === "") {
    return undefined;
  }

  return id;
}

/** `["content", "nodes", 1, "at"]` → `content.nodes[1].at`. */
function fieldPath(path: PropertyKey[]): string {
  return path.map(fieldKey).join("").replace(/^\./, "");
}

function fieldKey(key: PropertyKey): string {
  if (typeof key === "number") {
    return `[${key}]`;
  }

  return `.${String(key)}`;
}
