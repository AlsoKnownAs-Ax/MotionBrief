import type { SfxDensity } from "../../contract";
import type { Storyboard } from "./schema";

/** How many sound effects the agent may place at each density: per Scene, and about one per `period` seconds (#68). */
const SFX_CAPS: Record<SfxDensity, { perScene: number; period: number }> = {
  off: { perScene: 0, period: Infinity },
  subtle: { perScene: 1, period: 20 },
  lively: { perScene: 2, period: 8 },
};

/** A density's caps as the agent is told them, such as "at most 1 per Scene and about 1 per 20 s". */
export function sfxCapsText(sfx: Exclude<SfxDensity, "off">): string {
  const { perScene, period } = SFX_CAPS[sfx];

  return `at most ${perScene} per Scene and about 1 per ${period} s`;
}

/** A sound effect the agent placed, where it sits, and whether it fits the density's caps. */
export type PlacedSound = { sceneId: string; index: number; asset: string; at: number; fits: boolean };

/**
 * Every sound effect the Storyboard places, in Storyboard order. The first ones fit the density's caps and the rest
 * don't, so stepping the density down drops the extra ones and stepping it up keeps them all.
 */
export function placedSounds(storyboard: Storyboard, duration: number, sfx: SfxDensity): PlacedSound[] {
  const { perScene } = SFX_CAPS[sfx];
  const total = totalSounds(sfx, duration);
  let kept = 0;

  return storyboard.scenes.flatMap((scene) => {
    let inScene = 0;

    return (scene.sounds ?? []).map(({ asset, at }, index) => {
      const fits = inScene < perScene && kept < total;
      inScene += Number(fits);
      kept += Number(fits);

      return { sceneId: scene.id, index, asset, at, fits };
    });
  });
}

/** How many sound effects the whole video may play: about one per period, and at least one unless they are off. */
function totalSounds(sfx: SfxDensity, duration: number): number {
  const { perScene, period } = SFX_CAPS[sfx];

  if (perScene === 0) {
    return 0;
  }

  return Math.max(1, Math.round(duration / period));
}
