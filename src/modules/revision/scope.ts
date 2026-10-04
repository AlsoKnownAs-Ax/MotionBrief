import { isDeepStrictEqual } from "node:util";
import type { StoryboardIssue } from "../../contract";
import type { Scene, Storyboard } from "../storyboard";
import type { Patch } from "./patch";

/**
 * What a patch may touch when the creator selected Scenes: those Scenes and the rest of their Canvas, Scenes it
 * splits them into, and their neighbours' spans where a span change has to give way. Anything else it changes,
 * removes or instructs is outside the request. No selection means the whole video.
 */
export function scopeIssues(current: Storyboard, revised: Storyboard, { instructions }: Patch, scope: string[]): StoryboardIssue[] {
  if (scope.length === 0) {
    return [];
  }

  const allowed = withCanvasMates([...current.scenes, ...revised.scenes], scope);
  const before = new Map(current.scenes.map((scene) => [scene.id, scene]));
  const scopedSpans = current.scenes.filter(({ id }) => allowed.has(id));
  const outside = (message: string, sceneId: string, field: string): StoryboardIssue => ({
    code: "SCOPE",
    sceneId,
    field,
    message: `${message} The creator selected ${scope.join(", ")}; leave other Scenes as they are.`,
  });

  const changed = revised.scenes
    .filter(({ id }) => !allowed.has(id))
    .filter((scene) => isChanged(scene, before.get(scene.id), scopedSpans))
    .map((scene) => outside(`${scene.id} isn't selected, so only its span may move to make room.`, scene.id, ""));
  const removed = current.scenes
    .filter(({ id }) => !allowed.has(id))
    .filter(({ id }) => !revised.scenes.some((scene) => scene.id === id))
    .map(({ id }) => outside(`${id} isn't selected, so it can't be removed.`, id, ""));
  const instructed = instructions
    .map(({ scene }, index) => ({ scene, index }))
    .filter(({ scene }) => !allowed.has(scene))
    .map(({ scene, index }) => outside(`${scene} isn't selected, so it takes no instruction.`, scene, `instructions[${index}]`));

  return [...changed, ...removed, ...instructed];
}

/** The selected Scenes and every Scene sharing a Canvas with one of them. */
function withCanvasMates(scenes: Scene[], scope: string[]): Set<string> {
  const canvases = new Set(scenes.filter(({ id }) => scope.includes(id)).flatMap(({ canvas }) => canvas ?? []));

  return new Set([...scope, ...scenes.filter(({ canvas }) => canvas !== undefined && canvases.has(canvas)).map(({ id }) => id)]);
}

/**
 * An unselected Scene the patch changed: a new one outside the selected Scenes' words, or an existing one that
 * changed beyond its span.
 */
function isChanged(scene: Scene, previous: Scene | undefined, scopedSpans: Scene[]): boolean {
  if (!previous) {
    return !scopedSpans.some(({ from, to }) => scene.from <= to && scene.to >= from);
  }

  return !isDeepStrictEqual({ ...scene, from: 0, to: 0 }, { ...previous, from: 0, to: 0 });
}
