import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { Transcript, TranscriptWord } from "../../contract";
import type { Cache, CacheError } from "../cache";
import type { Media, MediaError, TimeRange } from "../media";
import { planChunks } from "./chunks";
import type { WhisperEngine } from "./engine";
import { parseChunk, type ParsedChunk, type RawWhisperOutput } from "./raw-output";
import { finishWords } from "./timing";
import type { Result, Transcriber, TranscriberError, TranscriptionRequest } from "./transcriber";

/** The transcription model on this computer, once it is downloaded and verified. */
export type InstalledModel = { path: string; sha256: string };

export type WhisperTranscriberOptions = {
  engine: WhisperEngine;
  media: Media;
  cache: Cache;
  /** Resolves once the transcription model is ready; `undefined` if the signal aborts first. */
  model: { whenReady: (signal: AbortSignal) => Promise<InstalledModel | undefined> };
};

type Transcribed = { language: string; words: TranscriptWord[] };

type ChunkJob = {
  request: TranscriptionRequest;
  /** The whole Voiceover, resampled. */
  audio: string;
  chunk: TimeRange;
  language: string;
  model: InstalledModel;
  /** Words of the chunks before this one, for progress updates. */
  before: TranscriptWord[];
};

/**
 * The v1 Transcriber: whisper-cli on this computer. The Voiceover is resampled to 16 kHz mono once, then transcribed
 * in chunks cut at pauses, so the Transcript fills in as each chunk finishes. Resampled audio and each chunk's raw
 * output are cached by content, so a restart, or another Project with the same Voiceover, reuses them.
 */
export function createWhisperTranscriber({ engine, media, cache, model }: WhisperTranscriberOptions): Transcriber {
  async function transcribe(request: TranscriptionRequest): Promise<Result<Transcript, TranscriberError>> {
    request.onUpdate({ state: "waiting-for-model", transcribedSeconds: 0, words: [] });
    const installed = await model.whenReady(request.signal);

    if (!installed) {
      return stopped();
    }

    request.onUpdate({ state: "transcribing", transcribedSeconds: 0, words: [] });
    const audioKey = `audio/${request.voiceoverSha256}.wav`;
    const release = cache.hold(audioKey);
    const result = await transcribeAudio(request, audioKey, installed);
    release();

    if (result.error) {
      return { data: null, error: result.error };
    }

    const { language, words } = result.data;

    return { data: { language, duration: request.duration, words: finishWords(words, request.duration) }, error: null };
  }

  async function transcribeAudio(request: TranscriptionRequest, audioKey: string, installed: InstalledModel): Promise<Result<Transcribed, TranscriberError>> {
    const { data: audio, error } = await resampled(request, audioKey);

    if (error) {
      return { data: null, error };
    }

    const { data: silences, error: silenceError } = await media.silences(audio, request.signal);

    if (silenceError) {
      return { data: null, error: mediaError(silenceError) };
    }

    let transcribed: Transcribed = { language: request.language, words: [] };

    for (const chunk of planChunks(request.duration, silences)) {
      const job = { request, audio, chunk, language: transcribed.language, model: installed, before: transcribed.words };
      const { data: parsed, error: chunkError } = await transcribeChunk(job);

      if (chunkError) {
        return { data: null, error: chunkError };
      }

      // `auto` detects the language on the first chunk; the rest are transcribed in it, so they all agree.
      transcribed = { language: parsed.language, words: [...transcribed.words, ...shifted(parsed.words, chunk.start)] };
      request.onUpdate({ state: "transcribing", transcribedSeconds: chunk.end, ...withFinishedWords(transcribed, request.duration) });
    }

    return { data: transcribed, error: null };
  }

  /** The Voiceover as whisper-cli reads it, from the cache or freshly converted. */
  async function resampled({ voiceoverPath, signal }: TranscriptionRequest, key: string): Promise<Result<string, TranscriberError>> {
    const cached = await cache.get(key);

    if (cached) {
      return { data: cached, error: null };
    }

    const { data: path, error } = await cache.put<MediaError>(key, (output) => media.toWhisperAudio(voiceoverPath(), output, signal));

    if (error) {
      return { data: null, error: mediaError(error) };
    }

    return { data: path, error: null };
  }

  async function transcribeChunk(job: ChunkJob): Promise<Result<ParsedChunk, TranscriberError>> {
    const key = `whisper/${chunkKey(job)}.json`;
    const cached = await readCached(key);

    if (cached) {
      return parseChunk(cached);
    }

    const { data: raw, error } = await runEngine(job);

    if (error) {
      return { data: null, error };
    }

    const parsed = parseChunk(raw);

    // Output whisper-cli got wrong is never cached, so Retry runs it again.
    if (parsed.error) {
      return parsed;
    }

    await cache.put<CacheError>(key, (path) => fileStep(path, () => writeFile(path, JSON.stringify(raw))));

    return parsed;
  }

  /** Cuts the chunk out of the resampled audio and runs whisper-cli on it. */
  async function runEngine({ request, audio, chunk, language, model: installed, before }: ChunkJob): Promise<Result<RawWhisperOutput, TranscriberError>> {
    const { data: chunkPath, error } = await cache.scratch();

    if (error) {
      return { data: null, error: mediaError(error) };
    }

    const { error: cutError } = await media.cut(audio, chunkPath, chunk, request.signal);

    if (cutError) {
      await rm(chunkPath, { force: true }).catch(() => undefined);

      return { data: null, error: mediaError(cutError) };
    }

    const progress = (fraction: number) =>
      request.onUpdate({
        state: "transcribing",
        transcribedSeconds: chunk.start + fraction * (chunk.end - chunk.start),
        ...withFinishedWords({ language, words: before }, request.duration),
      });
    const result = await engine.run({ audioPath: chunkPath, modelPath: installed.path, language, signal: request.signal, onProgress: progress });
    await rm(chunkPath, { force: true }).catch(() => undefined);

    if (result.error) {
      return { data: null, error: { code: "TRANSCRIBER_FAILED", message: result.error.message } };
    }

    return result;
  }

  /** Everything that changes a chunk's output: its audio, the language, the model and the engine. */
  function chunkKey({ request, chunk, language, model: installed }: ChunkJob) {
    const inputs = { voiceover: request.voiceoverSha256, chunk, language, model: installed.sha256, engine: engine.id };

    return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
  }

  async function readCached(key: string): Promise<RawWhisperOutput | undefined> {
    const path = await cache.get(key);

    if (!path) {
      return undefined;
    }

    const { data: text } = await fileStep(path, () => readFile(path, "utf8"));

    return parseRaw(text ?? "");
  }

  return { transcribe };
}

/** Moves a chunk's words onto the Voiceover's timeline. */
function shifted(words: TranscriptWord[], offset: number) {
  return words.map((word) => ({ ...word, start: word.start + offset, end: word.end + offset }));
}

function withFinishedWords({ language, words }: Transcribed, duration: number) {
  return { language: knownLanguage(language), words: finishWords(words, duration) };
}

/** `auto` isn't a language yet. */
function knownLanguage(language: string) {
  if (language === "auto") {
    return undefined;
  }

  return language;
}

function mediaError(error: MediaError | CacheError): TranscriberError {
  if (error.code === "FILE_FAILED") {
    return { code: "FILE_FAILED", message: `${error.path}: ${error.message}` };
  }

  if (error.code === "NO_AUDIO") {
    return { code: "VOICEOVER_UNREADABLE", message: `${error.path} has no sound` };
  }

  return { code: "VOICEOVER_UNREADABLE", message: error.detail };
}

/** A cached entry that isn't raw output any more is treated as a miss. */
function parseRaw(text: string): RawWhisperOutput | undefined {
  try {
    const raw = JSON.parse(text) as Partial<RawWhisperOutput>;

    if (typeof raw.json !== "string" || typeof raw.log !== "string") {
      return undefined;
    }

    return { json: raw.json, log: raw.log };
  } catch {
    return undefined;
  }
}

function stopped(): Result<never, TranscriberError> {
  return { data: null, error: { code: "TRANSCRIBER_FAILED", message: "Stopped" } };
}

async function fileStep<T>(path: string, step: () => Promise<T>): Promise<Result<T, CacheError>> {
  try {
    return { data: await step(), error: null };
  } catch (error) {
    return { data: null, error: { code: "FILE_FAILED", path, message: String(error) } };
  }
}
