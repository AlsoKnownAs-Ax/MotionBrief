import { isDeepStrictEqual } from "node:util";
import type { StoryboardTranscript } from "../../contract";
import { planUnits, type Unit } from "../assembler";
import type { Scene, Storyboard } from "../storyboard";

/**
 * What a unit of the revised Storyboard needs: its code as it is, its code re-rendered and checked
 * again, or new code from a Scene-code subagent.
 */
export type Rebuild = "keep" | "rerender" | "regenerate";

export type UnitRebuild = {
  unit: Unit;
  rebuild: Rebuild;
  /** The unit of the current Storyboard whose code it starts from; absent for a unit the patch made. */
  previous?: Unit;
  /** The patch's instructions for the unit's Scenes. */
  instructions: string[];
  /** Regenerated only because of an instruction: its entries didn't change at all. */
  isInstructionOnly: boolean;
};

type RebuildInput = {
  current: Storyboard;
  next: Storyboard;
  transcript: StoryboardTranscript;
  /** Instructions by Scene id of the revised Storyboard. */
  instructions: Record<string, string>;
  /** Captions were switched on or off, which changes every unit's page. */
  captionsChanged: boolean;
};

/**
 * The rebuild rule (ADR 0003): compares the revised Storyboard with the current one, unit by unit.
 * Timing changes (Transitions, anchor words, spans) only re-render, since anchor times are injected
 * at assembly. A changed Scene Type, content or element set, or an instruction, regenerates the unit.
 * Any change inside a Canvas, or to its grouping, regenerates the whole Canvas.
 */
export function planRebuild({ current, next, transcript, instructions, captionsChanged }: RebuildInput): UnitRebuild[] {
  const before = new Map(planUnits(current, transcript).map((unit) => [unit.id, unit]));

  return planUnits(next, transcript).map((unit) => {
    const previous = before.get(unit.id);
    const unitInstructions = unit.scenes.flatMap(({ id }) => (instructions[id] ? [instructions[id]] : []));
    const plan = { unit, previous, instructions: unitInstructions };

    if (!previous || !sameScenes(previous, unit)) {
      return { ...plan, rebuild: "regenerate", isInstructionOnly: false };
    }

    const isCanvas = unit.scenes.length > 1;
    const changed = unit.scenes.some((scene, index) => !isDeepStrictEqual(withoutOutgoing(scene), withoutOutgoing(previous.scenes[index]!)));
    const contentChanged = unit.scenes.some((scene, index) => !sameContent(scene, previous.scenes[index]!));

    if (contentChanged || (isCanvas && changed)) {
      return { ...plan, rebuild: "regenerate", isInstructionOnly: false };
    }

    const timingChanged = changed || !isDeepStrictEqual(timingOf(unit), timingOf(previous));

    if (unitInstructions.length > 0) {
      return { ...plan, rebuild: "regenerate", isInstructionOnly: !timingChanged };
    }

    return { ...plan, rebuild: timingChanged || captionsChanged ? "rerender" : "keep", isInstructionOnly: false };
  });
}

/** The same Scenes, in the same grouping. */
function sameScenes(previous: Unit, unit: Unit): boolean {
  return isDeepStrictEqual(
    previous.scenes.map(({ id }) => id),
    unit.scenes.map(({ id }) => id),
  );
}

/** A Scene without the Transition out of it, which belongs between units. */
function withoutOutgoing(scene: Scene) {
  return { ...scene, transition: undefined };
}

/** The same Scene Type and content, element set and all, wherever its elements are anchored. */
function sameContent(scene: Scene, previous: Scene): boolean {
  return scene.type === previous.type && isDeepStrictEqual(unanchored(scene.content), unanchored(previous.content));
}

/** Content with every word anchor taken out. */
function unanchored(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unanchored);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "at").map(([key, field]) => [key, unanchored(field)]));
  }

  return value;
}

/** Everything about a unit's place in time the page is assembled with. */
function timingOf({ duration, sceneStarts, anchors, transitionIn }: Unit) {
  return { duration, sceneStarts, anchors, transitionIn };
}
