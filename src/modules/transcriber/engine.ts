import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { readFile, rm } from "node:fs/promises";
import type { RawWhisperOutput } from "./raw-output";
import type { Result } from "./transcriber";

export type WhisperRun = {
  /** A 16 kHz mono WAV. */
  audioPath: string;
  modelPath: string;
  /** A Whisper language code, or `auto`. */
  language: string;
  signal: AbortSignal;
  /** The fraction of the audio done so far. */
  onProgress?: (fraction: number) => void;
};

export type WhisperEngineError = { code: "WHISPER_FAILED"; message: string };

/**
 * One run of Whisper over one audio file. Swapped in tests for one that replays committed raw output, so all of the
 * Transcriber's own logic still runs.
 */
export type WhisperEngine = {
  /** Names the binary, its settings and the VAD model, so cached output from another engine is never reused. */
  id: string;
  run: (run: WhisperRun) => Promise<Result<RawWhisperOutput, WhisperEngineError>>;
};

export type WhisperCliOptions = {
  cliPath: string;
  vadModelPath: string;
  /** The pins of the binary and the VAD model, part of the engine's id. */
  version: string;
};

/** The DTW alignment heads of the pinned model, large-v3-turbo. */
const DTW_PRESET = "large.v3.turbo";

const THREADS = Math.min(8, availableParallelism());

/** whisper-cli's `-pp` lines. */
const PROGRESS = /progress =\s*(\d+)%/g;

/** The pinned whisper-cli with DTW token timestamps and VAD. */
export function createWhisperCli({ cliPath, vadModelPath, version }: WhisperCliOptions): WhisperEngine {
  /** Set once the GPU build crashes on this machine, so later runs go straight to the CPU. */
  let cpuOnly = false;

  async function run(request: WhisperRun): Promise<Result<RawWhisperOutput, WhisperEngineError>> {
    const result = await runCli(request, cpuOnly);

    if (result.error?.crashed && !cpuOnly && !request.signal.aborted) {
      cpuOnly = true;

      return finish(await runCli(request, true));
    }

    return finish(result);
  }

  async function runCli({ audioPath, modelPath, language, signal, onProgress }: WhisperRun, onCpu: boolean): Promise<CliResult> {
    const outBase = `${audioPath}.whisper`;
    const args = [
      ...["-m", modelPath, "-f", audioPath, "-l", language, "-t", String(THREADS)],
      // DTW is silently skipped while flash attention is on, which is the default.
      ...["-dtw", DTW_PRESET, "-nfa"],
      ...["--vad", "-vm", vadModelPath],
      // Not -np: it silences the log, and the log is where VAD's time map is.
      ...["-ojf", "-of", outBase, "-pp"],
      ...gpuArgs(onCpu),
    ];
    const exit = await spawnCli(cliPath, args, { signal, onCpu, onProgress });

    if (exit.error) {
      return { data: null, error: exit.error };
    }

    const jsonPath = `${outBase}.json`;
    const json = await readText(jsonPath);
    await rm(jsonPath, { force: true }).catch(() => undefined);

    if (json === undefined) {
      return { data: null, error: { message: `whisper-cli wrote no output\n${exit.data}`, crashed: false } };
    }

    return { data: { json, log: exit.data }, error: null };
  }

  return { id: `whisper-cli ${version} dtw ${DTW_PRESET} vad`, run };
}

type CliError = { message: string; crashed: boolean };

type CliResult = Result<RawWhisperOutput, CliError>;

function finish({ data, error }: CliResult): Result<RawWhisperOutput, WhisperEngineError> {
  if (error) {
    return { data: null, error: { code: "WHISPER_FAILED", message: error.message } };
  }

  return { data, error: null };
}

/** On the CPU fallback, the GPU backend finds no devices and whisper.cpp loads its CPU backend instead. */
function gpuArgs(onCpu: boolean) {
  if (onCpu) {
    return ["-ng"];
  }

  return [];
}

type SpawnOptions = { signal: AbortSignal; onCpu: boolean; onProgress?: (fraction: number) => void };

/** Runs whisper-cli to completion; resolves to its log (stderr), which the Transcriber needs for VAD's time map. */
function spawnCli(path: string, args: string[], { signal, onCpu, onProgress }: SpawnOptions): Promise<Result<string, CliError>> {
  return new Promise((resolve) => {
    const env = cpuEnv(onCpu);
    const child = spawn(path, args, { signal, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      log += text;
      [...text.matchAll(PROGRESS)].forEach((match) => onProgress?.(Number(match[1]) / 100));
    });
    child.on("error", (error) => resolve({ data: null, error: { message: String(error), crashed: false } }));
    child.on("close", (exitCode, exitSignal) => {
      if (exitCode === 0) {
        resolve({ data: log, error: null });
        return;
      }

      resolve({ data: null, error: { message: `whisper-cli exited with ${exitSignal ?? exitCode}\n${tail(log)}`, crashed: isCrash(exitCode, exitSignal) } });
    });
  });
}

/** Hides every Vulkan device, which is how the Windows build falls back to its CPU backend. */
function cpuEnv(onCpu: boolean) {
  if (!onCpu) {
    return process.env;
  }

  return { ...process.env, GGML_VK_VISIBLE_DEVICES: "" };
}

/** Killed by a signal, or a Windows NTSTATUS failure such as an access violation (0xC0000005). */
function isCrash(exitCode: number | null, exitSignal: NodeJS.Signals | null) {
  if (exitSignal) {
    return exitSignal !== "SIGTERM";
  }

  return (exitCode ?? 0) >= 0xc0000000;
}

async function readText(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function tail(log: string) {
  return log.trim().split("\n").slice(-8).join("\n");
}
