import { z } from "zod";
import { StoryboardSchema, type Storyboard } from "../storyboard";

const SceneSchema = StoryboardSchema.shape.scenes.element;

/**
 * A Storyboard patch as the Revision agent hands it in: whole Scenes that replace those with the same id or add new
 * ones, Scene ids to remove, optionally Captions on or off, and instructions for individual Scenes. It names no unit
 * to rebuild: our code decides that.
 */
export const PatchSchema = {
  scenes: z.array(SceneSchema).describe("whole Scenes: each replaces the Scene with its id, or is added when no Scene has it"),
  remove: z.array(z.string()).describe("ids of Scenes to remove"),
  captions: z.boolean().optional().describe("switches Captions on or off; leave it out to keep them as they are"),
  instructions: z
    .array(z.strictObject({ scene: z.string().describe("Scene id in the revised Storyboard"), text: z.string().min(1) }))
    .describe("what to change in a Scene's look or motion that the Storyboard can't say, such as 'make the arrows thicker'"),
  summary: z.string().min(1).max(160).describe("one line on what the Revision changes, for the creator"),
};

export type Patch = z.infer<z.ZodObject<typeof PatchSchema>>;

/** The current Storyboard with the patch applied: Scenes replaced, added and removed, in Transcript order. */
export function applyPatch(current: Storyboard, { scenes, remove }: Patch): unknown {
  const removed = new Set(remove);
  const replacements = new Map(scenes.map((scene) => [scene.id, scene]));
  const kept = current.scenes.filter(({ id }) => !removed.has(id)).map((scene) => replacements.get(scene.id) ?? scene);
  const added = scenes.filter((scene) => !current.scenes.some(({ id }) => id === scene.id));

  return { ...current, scenes: [...kept, ...added].sort((a, b) => a.from - b.from) };
}
