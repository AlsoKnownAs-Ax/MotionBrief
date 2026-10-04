import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawWhisperOutput, WhisperEngine, WhisperRun } from "../../modules/transcriber";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "whisper");

/** Raw output of whisper-cli as committed: its `-ojf` JSON and its log, per chunk of the Voiceover. */
export async function whisperFixture(name: string, chunks: number): Promise<RawWhisperOutput[]> {
  return Promise.all(
    Array.from({ length: chunks }, async (_, index) => ({
      json: await readFile(join(FIXTURES, name, `chunk-${index}.json`), "utf8"),
      log: await readFile(join(FIXTURES, name, `chunk-${index}.log`), "utf8"),
    })),
  );
}

export type FakeWhisper = WhisperEngine & {
  /** What each run was asked to transcribe, in order, with a copy of the audio it was given. */
  runs: (Omit<WhisperRun, "signal" | "onProgress"> & { audio: Buffer })[];
  /** Holds run `index` and every one after it until `release`, so a test can look at the Transcript between chunks. */
  holdFrom: (index: number) => void;
  release: () => void;
};

/**
 * Stands in for whisper-cli: run n replays chunk n of the fixture, wrapping around, and reports the language it
 * was asked for unless that was `auto`. Everything the Transcriber does with the output runs for real.
 */
export function fakeWhisper(chunks: RawWhisperOutput[]): FakeWhisper {
  const runs: FakeWhisper["runs"] = [];
  let held: { from: number; released: PromiseWithResolvers<void> } | undefined;

  return {
    id: "fixture",
    runs,
    holdFrom: (from) => {
      held = { from, released: Promise.withResolvers() };
    },
    release: () => {
      held?.released.resolve();
      held = undefined;
    },
    run: async ({ audioPath, modelPath, language, signal }) => {
      const index = runs.length;
      const chunk = chunks[index % chunks.length];
      runs.push({ audioPath, modelPath, language, audio: await readFile(audioPath) });

      if (held && index >= held.from) {
        await Promise.race([held.released.promise, new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))]);
      }

      if (signal.aborted || !chunk) {
        return { data: null, error: { code: "WHISPER_FAILED", message: "aborted" } };
      }

      return { data: { json: withLanguage(chunk.json, language), log: chunk.log }, error: null };
    },
  };
}

function withLanguage(json: string, language: string) {
  if (language === "auto") {
    return json;
  }

  const output = JSON.parse(json) as { result: { language: string } };

  return JSON.stringify({ ...output, result: { ...output.result, language } });
}
