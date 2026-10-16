import { NO_ASSET, type PresetSound, type StoryboardTranscript, type TimelineSound } from "../../contract";
import { placedSounds, type Storyboard } from "../storyboard";
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

/** An agent sound effect's level relative to the Voiceover, before the Preset's effects level (#70). */
export const AGENT_SFX_DB = -6;

/** An agent sound effect this close to a Transition sound replaces it (#70). */
const COLLIDE_SECONDS = 0.15;

/** No sound is ever raised more than this, so a very quiet file can't blow up the mix. */
const MAX_GAIN_DB = 12;

/**
 * The sound plan of a video, leveled from each file's measured loudness against the Voiceover: each Transition's
 * sound effect from the Style Preset at the Transition's start, and the agent's sounds on their words, as many as the
 * density allows in Storyboard order. An agent sound replaces a Transition sound it lands on. Sound effects off plays none.
 */
export function planSound({ storyboard, transcript, sound, files, voice }: SoundPlanOptions): SoundPlan {
  if (sound.sfx === "off") {
    return { sfx: [] };
  }

  const planned = (asset: string, start: number, db: number, source: PlannedSound["source"]): PlannedSound[] => {
    const file = files[asset];

    return file ? [{ asset, file: file.file, name: file.name, start, duration: file.duration, volume: gain(voice + db + sound.sfxLevel - file.loudness), source }] : [];
  };
  const agent = placedSounds(storyboard, transcript.duration, sound.sfx)
    .filter(({ fits }) => fits)
    .flatMap(({ asset, at }) => planned(asset, transcript.words[at]?.start ?? 0, AGENT_SFX_DB, "agent"));
  const transitions = planUnits(storyboard, transcript)
    .flatMap(({ start, transitionIn }) => {
      const asset = transitionIn && sound.transitionSfx[transitionIn];

      return asset && asset !== NO_ASSET ? planned(asset, start, TRANSITION_SFX_DB, "transition") : [];
    })
    .filter(({ start }) => !agent.some((placed) => Math.abs(placed.start - start) <= COLLIDE_SECONDS + 1e-9));

  return { sfx: [...transitions, ...agent].sort((a, b) => a.start - b.start) };
}

/** A dB change as the linear gain `data-volume` takes, capped. */
function gain(db: number): number {
  return Number((10 ** (Math.min(db, MAX_GAIN_DB) / 20)).toFixed(4));
}
