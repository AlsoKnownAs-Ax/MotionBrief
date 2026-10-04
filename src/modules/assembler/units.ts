import type { StoryboardTranscript, TransitionType } from "../../contract";
import type { UnitTiming } from "../frame";
import { elementsOf, sceneTimings, type Scene, type SceneTiming, type Storyboard } from "../storyboard";

/** A unit of Scene code: a lone Scene, or the run of Scenes sharing a Canvas, with its id. */
export type Unit = UnitTiming & {
  /** When the unit starts on the Voiceover, in seconds. */
  start: number;
  scenes: Scene[];
  /** The Transition from the unit before into this one; the first unit has none. */
  transitionIn?: TransitionType;
};

/**
 * How long each Transition the Assembler draws overlaps the two units, in seconds. The incoming
 * unit starts on time; the outgoing one plays on underneath it until the Transition is over.
 */
export const TRANSITION_SECONDS: Partial<Record<TransitionType, number>> = { crossfade: 0.5 };

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

  return runs.map((run, index) => unitOf(run, runs[index - 1], runs[index + 1], transcript));
}

function unitOf(run: SceneTiming[], previous: SceneTiming[] | undefined, next: SceneTiming[] | undefined, transcript: StoryboardTranscript): Unit {
  const first = run[0]!;
  const start = first.start;
  const end = run.at(-1)?.end ?? start;

  return {
    id: first.scene.canvas ?? first.scene.id,
    start: seconds(start),
    duration: seconds(end - start + overlapOf(transitionInto(next, run))),
    scenes: run.map(({ scene }) => scene),
    transitionIn: transitionInto(run, previous),
    sceneStarts: Object.fromEntries(run.map(({ scene, start: sceneStart }) => [scene.id, seconds(sceneStart - start)])),
    anchors: Object.fromEntries(
      run.flatMap(({ scene }) =>
        elementsOf(scene).map(({ id, at }) => [`${scene.id}-${id}`, seconds(Math.max(0, (transcript.words[at]?.start ?? 0) - start))]),
      ),
    ),
  };
}

/** The Transition into a run: the one the Scene before it names. */
function transitionInto(run: SceneTiming[] | undefined, previous: SceneTiming[] | undefined): TransitionType | undefined {
  if (!run || !previous) {
    return undefined;
  }

  return previous.at(-1)?.scene.transition?.type;
}

function overlapOf(transition: TransitionType | undefined): number {
  if (!transition) {
    return 0;
  }

  return TRANSITION_SECONDS[transition] ?? 0;
}

/** Times are kept to the millisecond, so pages built from the same Storyboard are byte for byte the same. */
function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
