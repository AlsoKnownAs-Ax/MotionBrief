import { spawn } from "node:child_process";
import { z } from "zod";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type MediaError =
  /** FFprobe or FFmpeg couldn't read the file, or couldn't run at all. */
  | { code: "UNREADABLE"; path: string; detail: string }
  | { code: "NO_AUDIO"; path: string }
  | { code: "FFMPEG_FAILED"; path: string; detail: string };

export type MediaOptions = { ffmpegPath: string; ffprobePath: string };

export type Media = ReturnType<typeof createMedia>;

export type MediaInfo = {
  /** Seconds. */
  duration: number;
  /** It has a picture, not just cover art: only its audio is used. */
  isVideo: boolean;
  /** FFprobe's container names, such as `wav` or `mov,mp4,m4a,3gp,3g2,mj2`. */
  container: string;
  /** The first audio stream's codec, such as `opus`. */
  codec: string;
};

export type ImageInfo = {
  /** FFprobe's codec name, such as `png` or `mjpeg`. */
  codec: string;
  width: number;
  height: number;
  /** Some pixel is not fully opaque. */
  transparent: boolean;
};

export type TimeRange = { start: number; end: number };

/** The sample rate whisper.cpp expects. */
const WHISPER_SAMPLE_RATE = 16_000;

/** Quieter than this for at least `SILENCE_SECONDS` is a pause. */
const SILENCE_NOISE = "-35dB";
const SILENCE_SECONDS = 0.3;

/** Below this, EBU R128 reads as silence; FFmpeg reports it for a silent file. */
const SILENCE_LUFS = -70;

const ProbeSchema = z.object({
  streams: z.array(
    z.object({ codec_type: z.string(), codec_name: z.string().default(""), disposition: z.object({ attached_pic: z.number() }).partial().optional() }),
  ),
  format: z.object({ duration: z.coerce.number(), format_name: z.string().default("") }),
});

const ImageStreamSchema = z.object({ codec_name: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

const ImageProbeSchema = z.object({ streams: z.tuple([ImageStreamSchema]).rest(ImageStreamSchema) });

/** Reads and converts audio with the pinned FFmpeg and FFprobe, as subprocesses. */
export function createMedia({ ffmpegPath, ffprobePath }: MediaOptions) {
  /** What a file holds, if FFprobe can read it and it has sound. */
  async function probe(path: string): Promise<Result<MediaInfo, MediaError>> {
    const args = ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name:stream_disposition=attached_pic", "-of", "json", path];
    const { data: output, error } = await runProcess(ffprobePath, args);

    if (error) {
      return { data: null, error: { code: "UNREADABLE", path, detail: error.detail } };
    }

    const { success, data: info } = ProbeSchema.safeParse(parseJson(output.stdout));

    if (!success || Number.isNaN(info.format.duration)) {
      return { data: null, error: { code: "UNREADABLE", path, detail: output.stdout } };
    }

    const audio = info.streams.find(({ codec_type }) => codec_type === "audio");

    if (!audio) {
      return { data: null, error: { code: "NO_AUDIO", path } };
    }

    const isVideo = info.streams.filter(({ codec_type }) => codec_type === "video").some(({ disposition }) => !disposition?.attached_pic);

    return { data: { duration: info.format.duration, isVideo, container: info.format.format_name, codec: audio.codec_name }, error: null };
  }

  /** A still image's codec, size and whether it has see-through pixels, if FFmpeg can decode it. */
  async function probeImage(path: string): Promise<Result<ImageInfo, MediaError>> {
    const { data: output, error } = await runProcess(ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", path]);

    if (error) {
      return { data: null, error: { code: "UNREADABLE", path, detail: error.detail } };
    }

    const { success, data: info } = ImageProbeSchema.safeParse(parseJson(output.stdout));

    if (!success) {
      return { data: null, error: { code: "UNREADABLE", path, detail: output.stdout } };
    }

    // The least opaque pixel of the first frame: below 255 means something shows through.
    const filter = "format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN";
    const { data: stats, error: statsError } = await runProcess(ffmpegPath, ["-hide_banner", "-nostats", "-i", path, "-frames:v", "1", "-vf", filter, "-f", "null", "-"]);

    if (statsError) {
      return { data: null, error: { code: "UNREADABLE", path, detail: statsError.detail } };
    }

    const minAlpha = Number(/lavfi\.signalstats\.YMIN=(\d+)/.exec(stats.stderr)?.[1] ?? 255);
    const [{ codec_name, width, height }] = info.streams;

    return { data: { codec: codec_name, width, height, transparent: minAlpha < 255 }, error: null };
  }

  /** Integrated loudness in LUFS (EBU R128): for a music bed or a Voiceover, which run long enough to gate. */
  async function loudness(path: string): Promise<Result<number, MediaError>> {
    const { data: log, error } = await loudnessLog(path, "ebur128");

    if (error) {
      return { data: null, error };
    }

    const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log.split("Summary:")[1] ?? "")?.[1]);

    return { data: Number.isFinite(integrated) ? integrated : SILENCE_LUFS, error: null };
  }

  /**
   * The loudest 400 ms in LUFS, padded with a second of silence: for a sound effect, which may be too short to have an
   * integrated loudness at all and would otherwise read as silence.
   */
  async function momentaryMax(path: string): Promise<Result<number, MediaError>> {
    const { data: log, error } = await loudnessLog(path, "apad=pad_dur=1,ebur128=framelog=verbose");

    if (error) {
      return { data: null, error };
    }

    const momentary = [...log.matchAll(/M:\s*(-?[\d.]+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);

    return { data: Math.max(SILENCE_LUFS, ...momentary), error: null };
  }

  /** ebur128 writes its readings to stderr at the verbose log level. */
  async function loudnessLog(path: string, filter: string): Promise<Result<string, MediaError>> {
    const { data: output, error } = await runProcess(ffmpegPath, ["-hide_banner", "-nostats", "-v", "verbose", "-i", path, "-map", "0:a:0", "-af", filter, "-f", "null", "-"]);

    if (error) {
      return { data: null, error: { code: "FFMPEG_FAILED", path, detail: error.detail } };
    }

    return { data: output.stderr, error: null };
  }

  /** Writes the first audio stream of `input` as the 16 kHz mono WAV whisper-cli reads; any picture is dropped. */
  async function toWhisperAudio(input: string, output: string, signal: AbortSignal): Promise<Result<null, MediaError>> {
    const args = ["-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(WHISPER_SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav", output];

    return ffmpeg(input, args, signal);
  }

  /** The pauses in an audio file. */
  async function silences(path: string, signal: AbortSignal): Promise<Result<TimeRange[], MediaError>> {
    const filter = `silencedetect=noise=${SILENCE_NOISE}:d=${SILENCE_SECONDS}`;
    const { data: output, error } = await runProcess(ffmpegPath, ["-hide_banner", "-nostats", "-i", path, "-af", filter, "-f", "null", "-"], signal);

    if (error) {
      return { data: null, error: { code: "FFMPEG_FAILED", path, detail: error.detail } };
    }

    return { data: parseSilences(output.stderr), error: null };
  }

  /** Copies `range` of a WHISPER_SAMPLE_RATE WAV to `output`, cut on exact samples. */
  async function cut(input: string, output: string, { start, end }: TimeRange, signal: AbortSignal): Promise<Result<null, MediaError>> {
    const trim = `atrim=start_sample=${sampleAt(start)}:end_sample=${sampleAt(end)},asetpts=PTS-STARTPTS`;

    return ffmpeg(input, ["-i", input, "-af", trim, "-c:a", "pcm_s16le", "-f", "wav", output], signal);
  }

  async function ffmpeg(input: string, args: string[], signal: AbortSignal): Promise<Result<null, MediaError>> {
    const { error } = await runProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], signal);

    if (error) {
      return { data: null, error: { code: "FFMPEG_FAILED", path: input, detail: error.detail } };
    }

    return { data: null, error: null };
  }

  return { probe, probeImage, loudness, momentaryMax, toWhisperAudio, silences, cut };
}

/** The sample a time falls on; also how a cut chunk's start is turned back into seconds. */
export function sampleAt(seconds: number) {
  return Math.round(seconds * WHISPER_SAMPLE_RATE);
}

/** silencedetect's `silence_start: 1.2` and `silence_end: 2.5 | silence_duration: 1.3` lines, paired up. */
function parseSilences(log: string): TimeRange[] {
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((match) => Math.max(0, Number(match[1])));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));

  // A silence running to the end of the file has no end line.
  return starts.map((start, index) => ({ start, end: ends[index] ?? Number.POSITIVE_INFINITY }));
}

type ProcessOutput = { stdout: string; stderr: string };

type ProcessError = { detail: string };

/** Runs a program to completion; the error is its stderr, or why it couldn't start. */
function runProcess(path: string, args: string[], signal?: AbortSignal): Promise<Result<ProcessOutput, ProcessError>> {
  return new Promise((resolve) => {
    const child = spawn(path, args, { signal, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ data: null, error: { detail: String(error) } }));
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve({ data: null, error: { detail: stderr.trim() || `exited with ${exitCode}` } });
        return;
      }

      resolve({ data: { stdout, stderr }, error: null });
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
