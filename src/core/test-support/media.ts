import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { ffmpegPath, ffprobePath } from "../native";

const run = promisify(execFile);

/** A stretch of a synthetic Voiceover: a tone standing in for speech, or silence. */
export type Stretch = { tone: number } | { silence: number };

/**
 * Writes a synthetic Voiceover with the pinned FFmpeg: tones where speech would be and silence where the speaker
 * pauses, so it chunks like the Voiceover a fixture was recorded from. The extension picks the container.
 */
export async function voiceover(dir: string, name: string, stretches: Stretch[]) {
  const path = join(dir, name);
  await ffmpeg(["-f", "lavfi", "-i", toneSource(stretches), path]);

  return path;
}

type VideoOptions = { stretches?: Stretch[]; audio?: boolean };

/** A video with a picture and, unless `audio` is false, the synthetic Voiceover as its sound. */
export async function video(dir: string, name: string, { stretches = [{ tone: 3 }], audio = true }: VideoOptions = {}) {
  const path = join(dir, name);
  const picture = ["-f", "lavfi", "-i", `testsrc2=size=160x120:rate=10:duration=${lengthOf(stretches)}`];

  if (!audio) {
    await ffmpeg([...picture, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);

    return path;
  }

  await ffmpeg([...picture, "-f", "lavfi", "-i", toneSource(stretches), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path]);

  return path;
}

type Stream = { codec_type: string; sample_rate?: string; channels?: number };

/** The streams of a media file, as FFprobe reports them. */
export async function streamsOf(path: string) {
  const { stdout } = await run(ffprobePath(), ["-v", "error", "-show_entries", "stream=codec_type,sample_rate,channels", "-of", "json", path]);

  return (JSON.parse(stdout) as { streams: Stream[] }).streams;
}

function ffmpeg(args: string[]) {
  return run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

/** An `aevalsrc` source: a 220 Hz tone, silent inside every `silence` stretch. */
function toneSource(stretches: Stretch[]) {
  const starts = stretches.map((_, index) => lengthOf(stretches.slice(0, index)));
  const silent = stretches
    .map((stretch, index) => ({ stretch, start: starts[index] ?? 0 }))
    .filter(({ stretch }) => "silence" in stretch)
    .map(({ stretch, start }) => `between(t,${start},${start + secondsOf(stretch)})`);

  return `aevalsrc='${gate(silent)}0.5*sin(2*PI*220*t)':s=16000:d=${lengthOf(stretches)}`;
}

/** A factor that is 0 inside any of the silent ranges and 1 elsewhere. */
function gate(silent: string[]) {
  if (silent.length === 0) {
    return "";
  }

  return `(1-(${silent.join("+")}))*`;
}

function lengthOf(stretches: Stretch[]) {
  return stretches.reduce((total, stretch) => total + secondsOf(stretch), 0);
}

function secondsOf(stretch: Stretch) {
  if ("tone" in stretch) {
    return stretch.tone;
  }

  return stretch.silence;
}
