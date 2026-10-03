import type { StoryboardTranscript } from "../../contract";
import type { UnitTiming } from "../frame";
import { elementsOf, sceneTimings, type Scene, type SceneTiming, type Storyboard } from "../storyboard";

/** A unit of Scene code: a lone Scene, or the run of Scenes sharing a Canvas, with its id. */
export type Unit = UnitTiming & {
  /** When the unit starts on the Voiceover, in seconds. */
  start: number;
  scenes: Scene[];
};

/**
 * Groups Scenes into units and times them from the Transcript. A unit is named after its Scene,
 * or its Canvas. Anchor times are relative to the unit's start, so Scene code never holds seconds.
 */
export function planUnits(storyboard: Storyboard, transcript: StoryboardTranscript): Unit[] {
  const timings = sceneTimings(storyboard, transcript);
  const runs = timings.reduce<SceneTiming[][]>((groups, timing) => {
    const run = groups.at(-1);
    const canvas = timing.scene.canvas;

    if (run && canvas !== undefined && run.at(-1)?.scene.canvas === canvas) {
      run.push(timing);

      return groups;
    }

    return [...groups, [timing]];
  }, []);

  return runs.map((run) => unitOf(run, transcript));
}

function unitOf(run: SceneTiming[], transcript: StoryboardTranscript): Unit {
  const first = run[0]!;
  const start = first.start;

  return {
    id: first.scene.canvas ?? first.scene.id,
    start: seconds(start),
    duration: seconds((run.at(-1)?.end ?? start) - start),
    scenes: run.map(({ scene }) => scene),
    sceneStarts: Object.fromEntries(run.map(({ scene, start: sceneStart }) => [scene.id, seconds(sceneStart - start)])),
    anchors: Object.fromEntries(
      run.flatMap(({ scene }) =>
        elementsOf(scene).map(({ id, at }) => [`${scene.id}-${id}`, seconds(Math.max(0, (transcript.words[at]?.start ?? 0) - start))]),
      ),
    ),
  };
}

/** Times are kept to the millisecond, so pages built from the same Storyboard are byte for byte the same. */
function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
