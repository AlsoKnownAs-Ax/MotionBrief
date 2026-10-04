import type { WordFixOffer } from "../../contract";
import { copyOf, type Scene, type Storyboard } from "../storyboard";

/** A word as on-screen copy has it: without the punctuation around it, which the Transcript keeps. */
export function bareWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * The Revision that carries a word fix into the Storyboard: scoped to the Scenes whose on-screen copy still says the
 * word as it was (`spellings`: its text before the fix, and what whisper-cli heard). Copy that already says the
 * fixed word needs nothing, so a fix the screen already agrees with offers nothing.
 */
export function wordFixOffer(storyboard: Storyboard, spellings: string[], fixed: string): WordFixOffer | undefined {
  const to = bareWord(fixed);
  const found = [...new Set(spellings.map(bareWord))]
    .filter((from) => from !== "")
    .filter((from) => from !== to)
    .map((from) => ({ from, scenes: storyboard.scenes.filter((scene) => isShowing(scene, from, to)).map(({ id }) => id) }))
    .filter(({ scenes }) => scenes.length > 0);
  const [first] = found;

  if (!first) {
    return undefined;
  }

  const affected = new Set(found.flatMap(({ scenes }) => scenes));
  const scope = storyboard.scenes.map(({ id }) => id).filter((id) => affected.has(id));

  return { from: first.from, to, scope, message: `Carry my word fix into the on-screen copy: write "${to}" where it says "${first.from}".` };
}

/** Whether the Scene's copy says `from` as a whole word, whatever its case, anywhere it doesn't already say `to`. */
function isShowing(scene: Scene, from: string, to: string): boolean {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${from.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");

  return copyOf(scene).some(({ text }) => [...text.matchAll(pattern)].some(([match]) => match !== to));
}
