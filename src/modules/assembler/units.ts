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
 * How long each Transition the Assembler draws on the root timeline overlaps the two units, in
 * seconds. The incoming unit starts on time; the outgoing one plays on underneath it until the
 * Transition is over. A carry-over cuts and flies the shared element inside the incoming unit, and
 * a camera move happens inside a Canvas unit, so neither overlaps.
 */
export const TRANSITION_SECONDS: Partial<Record<TransitionType, number>> = {
  crossfade: 0.5,
  "push-left": 0.55,
  "push-right": 0.55,
  "push-up": 0.55,
  "push-down": 0.55,
  "zoom-through": 0.45,
};

/** How long a carried element takes to fly from the outgoing Scene into its place in the incoming one. */
export const CARRY_SECONDS = 0.6;

/**
 * Groups Scenes into units and times them from the Transcript. A unit is named after its Scene,
 * or its Canvas. Anchor times are relative to the unit's start, so Scene code never holds seconds.
 */
export function planUnits(storyboard: Storyboard, transcript: StoryboardTranscript): Unit[] {
  const runs = runsOf(sceneTimings(storyboard, transcript), ({ scene }) => scene);

  return runs.map((run, index) => unitOf(run, runs[index - 1], runs[index + 1], transcript));
}

/**
 * The units to write again when Scenes change: the whole unit of each changed Scene, so a change
 * inside a Canvas regenerates the whole Canvas, and every unit whose Canvas grouping is new.
 * Returns unit ids of the next Storyboard, in its order.
 */
export function unitsToRegenerate(current: Storyboard, next: Storyboard, changedScenes: string[]): string[] {
  const groupingOf = (run: Scene[]) => `${unitIdOf(run)}:${run.map(({ id }) => id).join(",")}`;
  const currentGroupings = new Set(runsOf(current.scenes, (scene) => scene).map(groupingOf));

  return runsOf(next.scenes, (scene) => scene)
    .filter((run) => !currentGroupings.has(groupingOf(run)) || run.some(({ id }) => changedScenes.includes(id)))
    .map(unitIdOf);
}

/** Consecutive Scenes on the same Canvas form one run; every other Scene is a run of its own. */
function runsOf<T>(items: T[], sceneOf: (item: T) => Scene): T[][] {
  return items.reduce<T[][]>((groups, item) => {
    const run = groups.at(-1);
    const canvas = sceneOf(item).canvas;
    const last = run?.at(-1);

    if (run && last !== undefined && canvas !== undefined && sceneOf(last).canvas === canvas) {
      run.push(item);

      return groups;
    }

    return [...groups, [item]];
  }, []);
}

function unitIdOf(run: Scene[]): string {
  const first = run[0]!;

  return first.canvas ?? first.id;
}

function unitOf(run: SceneTiming[], previous: SceneTiming[] | undefined, next: SceneTiming[] | undefined, transcript: StoryboardTranscript): Unit {
  const first = run[0]!;
  const start = first.start;
  const end = run.at(-1)?.end ?? start;
  const anchors = Object.fromEntries(
    run.flatMap(({ scene }) =>
      elementsOf(scene).map(({ id, at }) => [`${scene.id}-${id}`, seconds(Math.max(0, (transcript.words[at]?.start ?? 0) - start))]),
    ),
  );
  const carryIn = carryInto(run, previous);

  return {
    id: unitIdOf(run.map(({ scene }) => scene)),
    start: seconds(start),
    duration: seconds(end - start + overlapOf(transitionInto(next, run))),
    scenes: run.map(({ scene }) => scene),
    transitionIn: transitionInto(run, previous),
    sceneStarts: Object.fromEntries(run.map(({ scene, start: sceneStart }) => [scene.id, seconds(sceneStart - start)])),
    // A carried element is already on screen as the unit starts: it flies in from the Scene before.
    anchors: carryIn ? { ...anchors, [carryIn.target]: 0 } : anchors,
    ...(carryIn && { carryIn }),
  };
}

/** The Transition into a run: the one the Scene before it names. */
function transitionInto(run: SceneTiming[] | undefined, previous: SceneTiming[] | undefined): TransitionType | undefined {
  if (!run || !previous) {
    return undefined;
  }

  return previous.at(-1)?.scene.transition?.type;
}

/** A carry-over into a run: the outgoing Scene's element flies to the place of the incoming Scene's element with the same id. */
function carryInto(run: SceneTiming[], previous: SceneTiming[] | undefined): UnitTiming["carryIn"] {
  const from = previous?.at(-1)?.scene;
  const transition = from?.transition;

  if (!previous || !from || transition?.type !== "carry-over") {
    return undefined;
  }

  return {
    from: unitIdOf(previous.map(({ scene }) => scene)),
    element: `${from.id}-${transition.element}`,
    target: `${run[0]!.scene.id}-${transition.element}`,
    duration: CARRY_SECONDS,
  };
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
