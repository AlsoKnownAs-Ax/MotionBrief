import { isDeepStrictEqual } from "node:util";
import type { IndexedAsset, StoryboardTranscript, UnitCode } from "../../contract";
import { planUnits, unitsToRegenerate, type Unit } from "../assembler";
import { assetsOf, withAssets, type Scene, type Storyboard } from "../storyboard";

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
  /** Assets swapped in its Scenes that a re-render alone shows, once its code points at them (`swappedCode`). */
  swaps: Swap[];
};

/** An Asset reference changed from one Asset to another. */
export type Swap = { from: string; to: string };

/** How far apart two images' aspect ratios may be for a swap to only re-render (ADR 0003). */
const ASPECT_TOLERANCE = 0.15;

type RebuildInput = {
  current: Storyboard;
  next: Storyboard;
  transcript: StoryboardTranscript;
  /** Instructions by Scene id of the revised Storyboard. */
  instructions: Record<string, string>;
  /** Captions were switched on or off, which changes every unit's page. */
  captionsChanged: boolean;
  /** The Asset index, whose sizes tell a swap that only re-renders from one that regenerates. */
  assets?: IndexedAsset[];
};

/**
 * The rebuild rule (ADR 0003): compares the revised Storyboard with the current one, unit by unit.
 * A changed Scene Type, content or element set, or an instruction, regenerates the Scene's unit; any
 * change inside a Canvas, or to its grouping, regenerates the whole Canvas (the Assembler's
 * `unitsToRegenerate`). Timing changes only re-render, since anchor times are injected at assembly:
 * spans, anchor words, and the Transitions and carry-overs at either edge of a unit. So do sound changes, and swapping
 * an image or logo for one of the same kind within about 15% aspect; any other swap is a content change.
 */
export function planRebuild({ current, next, transcript, instructions, captionsChanged, assets = [] }: RebuildInput): UnitRebuild[] {
  const before = new Map(planUnits(current, transcript).map((unit) => [unit.id, unit]));
  const units = planUnits(next, transcript);
  const index = new Map(assets.map((asset) => [asset.id, asset]));
  const scenesBefore = new Map(current.scenes.map((scene) => [scene.id, scene]));
  const regenerated = new Set(unitsToRegenerate(current, next, rewrittenScenes(current, next, instructions, index)));

  return units.map((unit) => {
    const previous = before.get(unit.id);
    const unitInstructions = unit.scenes.filter(({ id }) => instructions[id]).map(({ id }) => instructions[id]!);
    const timingChanged = !previous || !isDeepStrictEqual(edgesOf(unit), edgesOf(previous));
    const swaps = unit.scenes.flatMap((scene) => rerenderSwaps(scene, scenesBefore.get(scene.id), index).filter((swap) => swap !== undefined));
    const plan = { unit, previous, instructions: unitInstructions, swaps };

    if (regenerated.has(unit.id)) {
      return { ...plan, rebuild: "regenerate", isInstructionOnly: isInstructionOnly(unit, previous, unitInstructions, timingChanged) };
    }

    // Scene code never plays sound, so the agent's sounds only change the page.
    const soundsChanged = !previous || !isDeepStrictEqual(soundsOf(unit), soundsOf(previous));

    return { ...plan, rebuild: rerenderOrKeep(timingChanged || captionsChanged || swaps.length > 0 || soundsChanged), isInstructionOnly: false };
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
 * and re-render-only Asset swaps aside), an instruction, or any other change to a Scene on a Canvas.
 */
function rewrittenScenes(current: Storyboard, next: Storyboard, instructions: Record<string, string>, index: Map<string, IndexedAsset>): string[] {
  const before = new Map(current.scenes.map((scene) => [scene.id, scene]));

  return next.scenes
    .filter((scene) => {
      const previous = before.get(scene.id);

      if (!previous) {
        return true;
      }

      // Compared as if the swaps a re-render shows hadn't happened.
      const swaps = rerenderSwaps(scene, previous, index);
      const compared = withAssets(scene, assetsOf(scene).map(({ id }, place) => swaps[place]?.from ?? id));

      return Boolean(instructions[scene.id]) || !sameContent(compared, previous) || isMovedOnCanvas(compared, previous);
    })
    .map(({ id }) => id);
}

/**
 * The swaps from `previous` a re-render alone shows, by place in `assetsOf` order: an Asset swapped in the same place
 * for one of the same kind whose aspect ratio is within about 15%. None when the Scene's Asset places changed.
 */
function rerenderSwaps(scene: Scene, previous: Scene | undefined, index: Map<string, IndexedAsset>): (Swap | undefined)[] {
  const now = assetsOf(scene);
  const was = previous ? assetsOf(previous) : [];

  if (now.length !== was.length || now.some(({ field }, place) => field !== was[place]!.field)) {
    return [];
  }

  return now.map(({ id: to }, place) => {
    const from = was[place]!.id;

    return from !== to && isLikeForLike(index.get(from), index.get(to)) ? { from, to } : undefined;
  });
}

function isLikeForLike(from: IndexedAsset | undefined, to: IndexedAsset | undefined): boolean {
  if (!from || !to || from.kind !== to.kind || !("width" in from) || !("width" in to)) {
    return false;
  }

  return Math.abs(from.width / from.height / (to.width / to.height) - 1) <= ASPECT_TOLERANCE;
}

/** A unit's code pointing at the Assets swapped in, wherever it names one through `asset(id)`. */
export function swappedCode(code: UnitCode, swaps: Swap[]): UnitCode {
  const to = new Map(swaps.map((swap) => [swap.from, swap.to]));
  const swap = (part: string) => part.replace(/(asset\(\s*["']?)([^"')\s]+)/g, (call, start: string, id: string) => (to.has(id) ? `${start}${to.get(id)}` : call));

  return { css: swap(code.css), html: swap(code.html), js: swap(code.js) };
}

/** A Scene on a Canvas that changed in any way but the Transition out of it, which belongs between units, and its sounds. */
function isMovedOnCanvas(scene: Scene, previous: Scene): boolean {
  if (scene.canvas === undefined && previous.canvas === undefined) {
    return false;
  }

  return !isDeepStrictEqual({ ...scene, transition: undefined, sounds: undefined }, { ...previous, transition: undefined, sounds: undefined });
}

function soundsOf({ scenes }: Unit) {
  return scenes.map(({ sounds = [] }) => sounds);
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
