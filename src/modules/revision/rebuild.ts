import { isDeepStrictEqual } from "node:util";
import type { StoryboardTranscript } from "../../contract";
import { planUnits, unitsToRegenerate, type Unit } from "../assembler";
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
  /** Regenerated only because of an instruction: its entries and timing didn't change at all. */
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
 * A changed Scene Type, content or element set, or an instruction, regenerates the Scene's unit; any
 * change inside a Canvas, or to its grouping, regenerates the whole Canvas (the Assembler's
 * `unitsToRegenerate`). Timing changes only re-render, since anchor times are injected at assembly:
 * spans, anchor words, and the Transitions and carry-overs at either edge of a unit.
 */
export function planRebuild({ current, next, transcript, instructions, captionsChanged }: RebuildInput): UnitRebuild[] {
  const before = new Map(planUnits(current, transcript).map((unit) => [unit.id, unit]));
  const units = planUnits(next, transcript);
  const regenerated = new Set(unitsToRegenerate(current, next, rewrittenScenes(current, next, instructions)));

  return units.map((unit) => {
    const previous = before.get(unit.id);
    const unitInstructions = unit.scenes.filter(({ id }) => instructions[id]).map(({ id }) => instructions[id]!);
    const timingChanged = !previous || !isDeepStrictEqual(edgesOf(unit), edgesOf(previous));
    const plan = { unit, previous, instructions: unitInstructions };

    if (regenerated.has(unit.id)) {
      return { ...plan, rebuild: "regenerate", isInstructionOnly: isInstructionOnly(unit, previous, unitInstructions, timingChanged) };
    }

    return { ...plan, rebuild: rerenderOrKeep(timingChanged || captionsChanged), isInstructionOnly: false };
  });
}

function rerenderOrKeep(changed: boolean): Rebuild {
  if (changed) {
    return "rerender";
  }

  return "keep";
}

/**
 * Scenes whose code must be written again: a new Scene, a changed Scene Type or content (anchors
 * aside), an instruction, or any change at all to a Scene on a Canvas.
 */
function rewrittenScenes(current: Storyboard, next: Storyboard, instructions: Record<string, string>): string[] {
  const before = new Map(current.scenes.map((scene) => [scene.id, scene]));

  return next.scenes
    .filter((scene) => {
      const previous = before.get(scene.id);

      return !previous || Boolean(instructions[scene.id]) || !sameContent(scene, previous) || isMovedOnCanvas(scene, previous);
    })
    .map(({ id }) => id);
}

/** A Scene on a Canvas that changed in any way but the Transition out of it, which belongs between units. */
function isMovedOnCanvas(scene: Scene, previous: Scene): boolean {
  if (scene.canvas === undefined && previous.canvas === undefined) {
    return false;
  }

  return !isDeepStrictEqual({ ...scene, transition: undefined }, { ...previous, transition: undefined });
}

function isInstructionOnly(unit: Unit, previous: Unit | undefined, instructions: string[], timingChanged: boolean): boolean {
  if (!previous || instructions.length === 0 || timingChanged) {
    return false;
  }

  return isDeepStrictEqual(unit.scenes, previous.scenes);
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
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "at")
        .map(([key, field]) => [key, unanchored(field)]),
    );
  }

  return value;
}

/**
 * Everything about a unit's place in time and at its edges that the page is assembled with: its
 * timing, the Transition and carry-over into it, and the Transition out of it.
 */
function edgesOf({ duration, sceneStarts, anchors, transitionIn, carryIn, scenes }: Unit) {
  return { duration, sceneStarts, anchors, transitionIn, carryIn, transitionOut: scenes.at(-1)?.transition };
}
