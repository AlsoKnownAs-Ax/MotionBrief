import { NO_ASSET, type PresetSound, type StoryboardTranscript, type TimelineSound } from "../../contract";
import { serializeAutomation, VOLUME_TARGET } from "@hyperframes/core/audio-automation";
import { analyseCarveBands, analyseCarveDuck, carveBandsToChain, carveProfile } from "@hyperframes/core/audio-carve";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import { sceneTimings, type Storyboard } from "../storyboard";
import { planUnits } from "./units";

/** A sound Asset's file and what the plan needs to know of it. */
export type SoundFile = { file: string; name: string; duration: number; loudness: number };

/** One sound effect the page plays: its file, when, for how long and at what static gain. */
export type PlannedSound = TimelineSound & { asset: string; file: string; duration: number; volume: number };

/** One pass through the music bed file, from its start: the bed loops as passes crossfading into each other. */
export type BedPass = {
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** The duck under the Voiceover, as a `data-automation` volume lane. */
  automation?: string;
};

/** The music bed the page plays under the whole video, at a static gain, carved by `chain` when there is a Voiceover. */
export type PlannedBed = { asset: string; file: string; name: string; volume: number; chain?: HfAudioFxChain; passes: BedPass[] };

/** The sound the Assembler emits besides the Voiceover. */
export type SoundPlan = { sfx: PlannedSound[]; bed?: PlannedBed };

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

/** The bed rises over its first second, and each pass of a looping bed crossfades into the next over this many. */
const BED_FADE_IN = 1;
const BED_CROSSFADE = 2;

/** How hard the Voiceover carves the bed, 0..1 (#70). */
const CARVE_STRENGTH = 0.25;

/**
 * The sound plan of a video: each Transition's sound effect from the Style Preset, at the Transition's start and
 * leveled from its measured loudness against the Voiceover. Sound effects off plays none.
 */
export function planSound({ storyboard, transcript, sound, files, voice }: SoundPlanOptions): SoundPlan {
  const bed = planBed({ storyboard, transcript, sound, files, voice });

  if (sound.sfx === "off") {
    return { sfx: [], bed };
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

  return { sfx, bed };
}

/**
 * The music bed fitted to the video: its level from the measured loudness, a fade-in, a crossfaded pass after pass
 * while the bed is shorter than the video, and a fade-out over the last Scene. No music, or a missing file, has none.
 */
function planBed({ storyboard, transcript, sound, files, voice }: SoundPlanOptions): PlannedBed | undefined {
  const file = sound.music === NO_ASSET ? undefined : files[sound.music];

  if (!file) {
    return undefined;
  }

  const lastScene = sceneTimings(storyboard, transcript).at(-1)?.start ?? 0;
  const length = transcript.duration;
  const crossfade = Math.min(BED_CROSSFADE, file.duration / 4);
  const passes: BedPass[] = [];

  for (let start = 0; start < length; start = seconds(start + file.duration - crossfade)) {
    passes.push({ start, duration: seconds(Math.min(file.duration, length - start)), fadeIn: start === 0 ? BED_FADE_IN : crossfade, fadeOut: crossfade });

    if (start + file.duration >= length) {
      break;
    }
  }

  passes.at(-1)!.fadeOut = seconds(length - lastScene);

  return { asset: sound.music, file: file.file, name: file.name, volume: gain(voice + sound.musicLevel - file.loudness), passes };
}

/**
 * The Voiceover carve on a fitted bed (#70): the bands the voice occupies dipped in the bed by an FX chain, and the bed
 * ducked where it would still cover the voice, as each pass's volume automation. Both are measured on the mix as
 * planned, so `voice` and `bed` are mono samples at `sampleRate`.
 */
export function carveBed(bed: PlannedBed, voice: Float32Array, music: Float32Array, sampleRate: number): PlannedBed {
  const mix = new Float32Array(voice.length);

  for (const { start, duration } of bed.passes) {
    const offset = Math.round(start * sampleRate);
    const samples = Math.min(Math.round(duration * sampleRate), music.length, mix.length - offset);

    for (let index = 0; index < samples; index += 1) {
      mix[offset + index]! += music[index]! * bed.volume;
    }
  }

  const profile = carveProfile(CARVE_STRENGTH);
  const chain = carveBandsToChain(analyseCarveBands(voice, sampleRate, profile));
  const duck = analyseCarveDuck(voice, mix, sampleRate, profile, 0);

  return { ...bed, chain, passes: bed.passes.map((pass) => ({ ...pass, automation: duckLane(duck, pass, bed.volume) })) };
}

/** The part of the duck, in dB over the whole video, a pass plays: as its own volume lane, in seconds from its start. */
function duckLane(duck: { t: number; v: number }[], { start, duration }: BedPass, volume: number): string | undefined {
  if (duck.length === 0) {
    return undefined;
  }

  const atStart = duck.findLast(({ t }) => t <= start)?.v ?? 0;
  const inside = duck.filter(({ t }) => t > start && t < start + duration);
  const points = [{ t: 0, v: atStart }, ...inside.map(({ t, v }) => ({ t: seconds(t - start), v }))].map(({ t, v }) => ({ t, v: Number((volume * 10 ** (v / 20)).toFixed(4)) }));

  return serializeAutomation({ version: 1, lanes: [{ target: VOLUME_TARGET, points }] });
}

function seconds(value: number): number {
  return Number(value.toFixed(3));
}

/** A dB change as the linear gain `data-volume` takes, capped. */
function gain(db: number): number {
  return Number((10 ** (Math.min(db, MAX_GAIN_DB) / 20)).toFixed(4));
}
