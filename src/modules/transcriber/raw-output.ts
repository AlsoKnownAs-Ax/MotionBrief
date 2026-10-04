import { z } from "zod";
import type { TranscriptWord } from "../../contract";
import type { Result } from "./transcriber";

/** What whisper-cli leaves behind for one chunk: its `-ojf` JSON and its log, kept verbatim in the cache. */
export type RawWhisperOutput = { json: string; log: string };

export type ParsedChunk = {
  language: string;
  /** In seconds from the start of the chunk, in the order spoken. */
  words: TranscriptWord[];
};

export type ParseError = { code: "TRANSCRIBER_FAILED"; message: string };

const TokenSchema = z.object({
  text: z.string(),
  /** Milliseconds. */
  offsets: z.object({ from: z.number(), to: z.number() }),
  /** DTW onset in centiseconds; -1 when DTW gave none. */
  t_dtw: z.number().optional(),
});

const WhisperJsonSchema = z.object({
  result: z.object({ language: z.string() }),
  transcription: z.array(z.object({ tokens: z.array(TokenSchema).default([]) })),
});

type Token = z.infer<typeof TokenSchema>;

/** A point where VAD-processed audio time (what whisper-cli heard) equals original time, both in centiseconds. */
type TimePoint = { processed: number; original: number };

/** The gap whisper.cpp puts between the speech it keeps, in centiseconds. */
const VAD_SILENCE_CS = 10;

/** Each speech segment VAD kept, as whisper.cpp logs it (seconds, to the centisecond it works in). */
const VAD_SEGMENT = /vad_segment_info: orig_start: ([\d.]+), orig_end: ([\d.]+), vad_start: ([\d.]+), vad_end: ([\d.]+)/g;

/**
 * Turns one chunk's raw output into words timed on the chunk's own audio. With VAD on, whisper-cli maps segment times
 * back to the original audio but leaves token and DTW times on the audio it heard, with the pauses cut out; this
 * rebuilds whisper.cpp's mapping table from its log and maps every word back.
 */
export function parseChunk({ json, log }: RawWhisperOutput): Result<ParsedChunk, ParseError> {
  const { success, data: output, error } = WhisperJsonSchema.safeParse(parseJson(json));

  if (!success) {
    return { data: null, error: { code: "TRANSCRIBER_FAILED", message: `whisper-cli wrote unexpected output: ${error.message}\n${tail(log)}` } };
  }

  const segments = speechSegments(log);
  const table = mappingTable(segments);
  const tokens = output.transcription.flatMap(({ tokens }) => tokens).filter(isSpoken);
  const words = tokens
    .reduce<TranscriptWord[]>((joined, token) => joinToken(joined, token, table), [])
    .map((word) => ({ ...word, end: Math.max(word.end, speechEndAt(word.start, segments)) }));

  return { data: { language: output.result.language, words }, error: null };
}

/**
 * Token end times are rough, so a word is taken to last until the speaker pauses: the end of the stretch of speech
 * VAD found it in. The next word's onset cuts it shorter where there is no pause.
 */
function speechEndAt(seconds: number, segments: SpeechSegment[]) {
  const at = seconds * 100;
  const segment = segments.find(({ origStart, origEnd }) => at >= origStart && at <= origEnd);

  return (segment?.origEnd ?? 0) / 100;
}

/** Special tokens such as `[_BEG_]` and `[_TT_522]` carry no text. */
function isSpoken(token: Token) {
  return token.text.length > 0 && !token.text.startsWith("[_");
}

/** A token starting with a space starts a word; any other continues it ("bal" + "ancer", or a comma). */
function joinToken(words: TranscriptWord[], token: Token, table: TimePoint[]) {
  const end = toOriginal(token.offsets.to / 10, table);
  const last = words.at(-1);

  if (last && !token.text.startsWith(" ")) {
    return [...words.slice(0, -1), { ...last, text: last.text + token.text, end }];
  }

  return [...words, { text: token.text.trim(), start: toOriginal(onsetOf(token), table), end }];
}

/** The DTW onset in centiseconds, or the token's own timestamp where DTW gave none. */
function onsetOf(token: Token) {
  if (token.t_dtw === undefined || token.t_dtw < 0) {
    return token.offsets.from / 10;
  }

  return token.t_dtw;
}

/** A stretch of speech VAD kept, on the chunk's audio (orig) and on the audio whisper-cli heard (vad), in centiseconds. */
type SpeechSegment = { origStart: number; origEnd: number; vadStart: number; vadEnd: number };

function speechSegments(log: string): SpeechSegment[] {
  return [...log.matchAll(VAD_SEGMENT)].map((match) => ({
    origStart: centiseconds(match[1]),
    origEnd: centiseconds(match[2]),
    vadStart: centiseconds(match[3]),
    vadEnd: centiseconds(match[4]),
  }));
}

/** whisper.cpp's VAD time mapping table: segment edges, plus the edges of the short silence it puts between them. */
function mappingTable(segments: SpeechSegment[]): TimePoint[] {
  const edges = segments.flatMap((segment) => [
    { processed: segment.vadStart, original: segment.origStart },
    { processed: segment.vadEnd, original: segment.origEnd },
  ]);
  const silences = segments.slice(1).flatMap((next, index) => [
    { processed: next.vadStart - VAD_SILENCE_CS, original: segments[index]?.origEnd ?? 0 },
    { processed: next.vadStart, original: next.origStart },
  ]);
  const sorted = [...edges, ...silences].sort((a, b) => a.processed - b.processed);

  // Like whisper.cpp, the first point at each processed time wins.
  return sorted.filter((point, index) => sorted[index - 1]?.processed !== point.processed);
}

/** Maps a time on the audio whisper-cli heard to the chunk's audio, in seconds, interpolating between points. */
function toOriginal(processed: number, table: TimePoint[]) {
  const first = table[0];
  const last = table.at(-1);

  if (!first || !last) {
    return processed / 100;
  }

  if (processed <= first.processed) {
    return first.original / 100;
  }

  if (processed >= last.processed) {
    return last.original / 100;
  }

  const upper = table.findIndex((point) => point.processed >= processed);
  const after = table[upper] ?? last;
  const before = table[upper - 1] ?? first;
  const fraction = (processed - before.processed) / (after.processed - before.processed);

  return (before.original + fraction * (after.original - before.original)) / 100;
}

function centiseconds(seconds: string | undefined) {
  return Math.round(Number(seconds) * 100);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The end of a log, where whisper-cli says what went wrong. */
function tail(log: string) {
  return log.trim().split("\n").slice(-5).join("\n");
}
