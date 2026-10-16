import { NO_ASSET, type PresetSound, type StoryboardTranscript, type TimelineSound } from "../../contract";
import type { Storyboard } from "../storyboard";
import { planUnits } from "./units";

/** A sound Asset's file and what the plan needs to know of it. */
export type SoundFile = { file: string; name: string; duration: number; loudness: number };

/** One sound effect the page plays: its file, when, for how long and at what static gain. */
export type PlannedSound = TimelineSound & { asset: string; file: string; duration: number; volume: number };

/** The sound the Assembler emits besides the Voiceover. */
export type SoundPlan = { sfx: PlannedSound[] };

export type SoundPlanOptions = {
  storyboard: Storyboard;
  transcript: StoryboardTranscript;
  sound: PresetSound;
  /** Every Asset the sound names, by id; a missing one plays nothing. */
  files: Record<string, SoundFile>;
  /** The Voiceover's integrated loudness, in LUFS. */
  voice: number;
};

/** A Transition sound effect's level relative to the Voiceover, before the Preset's effects level (#70). */
export const TRANSITION_SFX_DB = -10;

/** No sound is ever raised more than this, so a very quiet file can't blow up the mix. */
const MAX_GAIN_DB = 12;

/**
 * The sound plan of a video: each Transition's sound effect from the Style Preset, at the Transition's start and
 * leveled from its measured loudness against the Voiceover. Sound effects off plays none.
 */
export function planSound({ storyboard, transcript, sound, files, voice }: SoundPlanOptions): SoundPlan {
  if (sound.sfx === "off") {
    return { sfx: [] };
  }

  const sfx = planUnits(storyboard, transcript).flatMap(({ start, transitionIn }) => {
    const asset = transitionIn && sound.transitionSfx[transitionIn];
    const file = asset && asset !== NO_ASSET ? files[asset] : undefined;

    if (!asset || !file) {
      return [];
    }

    const volume = gain(voice + TRANSITION_SFX_DB + sound.sfxLevel - file.loudness);

    return [{ asset, file: file.file, name: file.name, start, duration: file.duration, volume, source: "transition" as const }];
  });

  return { sfx };
}

/** A dB change as the linear gain `data-volume` takes, capped. */
function gain(db: number): number {
  return Number((10 ** (Math.min(db, MAX_GAIN_DB) / 20)).toFixed(4));
}
