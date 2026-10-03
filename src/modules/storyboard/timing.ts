import type { StoryboardTranscript } from "../../contract";
import type { Scene, Storyboard } from "./schema";

/** A Scene starts this long before its first word is spoken. */
const SCENE_LEAD_SECONDS = 0.25;

export type SceneTiming = { scene: Scene; start: number; end: number };

/** When each Scene starts and ends on the Voiceover, in seconds. Assumes the spans are valid. */
export function sceneTimings(storyboard: Storyboard, transcript: StoryboardTranscript): SceneTiming[] {
  const starts = storyboard.scenes.map((scene, index) => sceneStart(scene, index, transcript));

  return storyboard.scenes.map((scene, index) => ({
    scene,
    start: starts[index] ?? 0,
    end: starts[index + 1] ?? transcript.duration,
  }));
}

function sceneStart(scene: Scene, index: number, transcript: StoryboardTranscript): number {
  if (index === 0) {
    return 0;
  }

  return Math.max(0, (transcript.words[scene.from]?.start ?? 0) - SCENE_LEAD_SECONDS);
}
