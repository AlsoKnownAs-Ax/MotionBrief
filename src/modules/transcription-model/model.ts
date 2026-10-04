import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TranscriptionModelError } from "../../contract";
import type { ModelDep } from "../../shared/deps-manifest";
import type { Disk } from "../system";
import { copyHashed, fileStep, sha256File, type Result } from "./files";
import { createStatusStore } from "./status";

export type TranscriptionModelOptions = {
  /** The app's data folder; the model lives in its `models` folder. */
  appDataDir: string;
  /** The model deps.json pins for this release. */
  pin: ModelDep;
  disk: Disk;
};

export type TranscriptionModel = ReturnType<typeof createTranscriptionModel>;

/** Progress is reported each time this many more bytes arrive: about 550 updates over the real model. */
const PROGRESS_STEP_BYTES = 1024 * 1024;

/** Free space required beyond the model itself, so the download never fills the disk. */
const HEADROOM_BYTES = 256 * 1024 * 1024;

/** Fresh downloads after a hash mismatch before the user is asked to Retry. */
const MISMATCH_RETRIES = 1;

type Operation = { controller: AbortController; done: Promise<void> };

/**
 * The Whisper model on this computer: downloads the pinned file into app data, resuming with HTTP Range,
 * and installs it only once its SHA-256 matches the pin.
 */
export function createTranscriptionModel({ appDataDir, pin, disk }: TranscriptionModelOptions) {
  const dir = join(appDataDir, "models");
  // Named by hash, so a release that pins another model looks for another file.
  const modelFile = join(dir, `whisper-${pin.sha256}.bin`);
  const partFile = `${modelFile}.part`;
  const store = createStatusStore({ state: "idle", receivedBytes: 0, totalBytes: pin.size });
  let active: Operation | undefined;
  // Every call waits for this, so none sees the status before the disk has been read.
  const loaded = load();

  /** Picks up where the last session left off: the model in place, or part of it downloaded. */
  async function load() {
    const { data: installed } = await fileStep(modelFile, () => stat(modelFile));

    if (installed) {
      store.update({ state: "ready", receivedBytes: pin.size });
      return;
    }

    store.update({ receivedBytes: await partSize() });
  }

  function fail(error: TranscriptionModelError) {
    store.update({ state: "failed", error });
  }

  /** Runs one download or import at a time; pause and import abort it through its signal. */
  function run(operation: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    const done = operation(controller.signal).finally(() => {
      if (active?.controller === controller) {
        active = undefined;
      }
    });
    active = { controller, done };
  }

  async function stop() {
    if (!active) {
      return;
    }

    active.controller.abort();
    await active.done;
  }

  async function download(signal: AbortSignal) {
    const { error } = await makeRoom();

    if (error) {
      fail(error);
      return;
    }

    await fetchAndVerify(signal, MISMATCH_RETRIES);
  }

  /** Copies the user's file into app data, installing it only if it is the pinned model. */
  async function importFile(path: string, signal: AbortSignal) {
    const { error } = await makeRoom();

    if (error) {
      fail(error);
      return;
    }

    const { data: stats, error: statError } = await fileStep(path, () => stat(path));

    if (statError) {
      fail(statError);
      return;
    }

    // A file of another size can't match, so it isn't worth copying.
    if (stats.size !== pin.size) {
      await refuseImport(path);
      return;
    }

    const copy = `${modelFile}.import`;
    const { data: actual, error: copyError } = await copyHashed(path, copy, signal);

    if (signal.aborted) {
      return;
    }

    if (copyError) {
      fail(copyError);
      return;
    }

    if (actual !== pin.sha256) {
      await fileStep(copy, () => rm(copy, { force: true }));
      await refuseImport(path);
      return;
    }

    await install(copy);
  }

  /** Back to the download as it was, with an error naming the file. */
  async function refuseImport(path: string) {
    store.update({ state: "failed", receivedBytes: await partSize(), error: { code: "IMPORT_MISMATCH", path } });
  }

  /** Creates the models folder and checks it has room for the model. */
  async function makeRoom(): Promise<Result<null, TranscriptionModelError>> {
    const { error } = await fileStep(dir, () => mkdir(dir, { recursive: true }));

    if (error) {
      return { data: null, error };
    }

    return checkSpace();
  }

  async function fetchAndVerify(signal: AbortSignal, retries: number): Promise<void> {
    const { error } = await fetchPart(signal);

    if (signal.aborted) {
      return;
    }

    if (error) {
      fail(error);
      return;
    }

    store.update({ state: "verifying" });
    const { data: actual, error: hashError } = await sha256File(partFile, signal);

    if (signal.aborted) {
      return;
    }

    if (hashError) {
      fail(hashError);
      return;
    }

    if (actual === pin.sha256) {
      await install(partFile);
      return;
    }

    // Some bytes on disk are wrong, and there is no telling which: start over.
    const { error: rmError } = await fileStep(partFile, () => rm(partFile, { force: true }));

    if (rmError) {
      fail(rmError);
      return;
    }

    if (retries === 0) {
      fail({ code: "HASH_MISMATCH", expected: pin.sha256, actual });
      return;
    }

    store.update({ state: "downloading", receivedBytes: 0 });

    return fetchAndVerify(signal, retries - 1);
  }

  async function checkSpace(): Promise<Result<null, TranscriptionModelError>> {
    const { data: freeBytes, error } = await fileStep(dir, () => disk.freeBytes(dir));

    if (error) {
      return { data: null, error };
    }

    const requiredBytes = pin.size + HEADROOM_BYTES;

    if (freeBytes < requiredBytes) {
      return { data: null, error: { code: "NOT_ENOUGH_SPACE", requiredBytes, freeBytes } };
    }

    return { data: null, error: null };
  }

  /** Fetches whatever the part file lacks, appending to it when the server honours the Range request. */
  async function fetchPart(signal: AbortSignal): Promise<Result<null, TranscriptionModelError>> {
    const offset = await partSize();

    if (offset >= pin.size) {
      return { data: null, error: null };
    }

    let output: WriteStream | undefined;

    try {
      const response = await fetch(pin.url, { headers: rangeFrom(offset), signal });

      if (!response.ok || !response.body) {
        return downloadFailed(`HTTP ${response.status}`);
      }

      const start = startOf(response);

      if (start !== 0 && start !== offset) {
        return downloadFailed(`Asked for bytes from ${offset}, got ${response.headers.get("content-range")}`);
      }

      // A server that ignores Range sends the whole file, which replaces the part.
      if (start === 0) {
        await rm(partFile, { force: true });
      }

      output = createWriteStream(partFile, { flags: "a" });
      await pipeline(Readable.fromWeb(response.body), countProgress(start), output, { signal });
    } catch (error) {
      return downloadFailed(String(error));
    } finally {
      // Windows keeps the file locked until the stream closes, so pause or import must wait for it.
      if (output && !output.closed) {
        await once(output, "close");
      }
    }

    const received = await partSize();
    store.update({ receivedBytes: received });

    if (received < pin.size) {
      return downloadFailed(`The download ended after ${received} of ${pin.size} bytes`);
    }

    return { data: null, error: null };
  }

  function downloadFailed(message: string) {
    return { data: null, error: { code: "DOWNLOAD_FAILED" as const, url: pin.url, message } };
  }

  /** Passes bytes through, reporting progress every PROGRESS_STEP_BYTES. */
  function countProgress(from: number) {
    let received = from;
    let reported = from;

    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;

        if (received - reported >= PROGRESS_STEP_BYTES) {
          reported = received;
          store.update({ receivedBytes: received });
        }

        callback(null, chunk);
      },
    });
  }

  /** Bytes already downloaded; 0 when there is no part file. */
  async function partSize() {
    const { data: stats } = await fileStep(partFile, () => stat(partFile));

    return stats?.size ?? 0;
  }

  /** Moves a verified file into place, then deletes every other file in the folder: parts and older models. */
  async function install(verified: string) {
    const { error } = await fileStep(modelFile, async () => {
      await rename(verified, modelFile);
      const others = (await readdir(dir)).filter((name) => join(dir, name) !== modelFile);
      await Promise.all(others.map((name) => rm(join(dir, name), { force: true })));
    });

    if (error) {
      fail(error);
      return;
    }

    store.update({ state: "ready", receivedBytes: pin.size, error: undefined });
  }

  function startDownload() {
    store.update({ state: "downloading", error: undefined });
    run(download);
  }

  return {
    status: async () => {
      await loaded;

      return store.get();
    },
    watch: async function* (signal?: AbortSignal) {
      await loaded;
      yield* store.watch(signal);
    },
    start: async () => {
      await loaded;

      if (store.get().state !== "idle") {
        return;
      }

      startDownload();
    },
    pause: async () => {
      await loaded;

      if (store.get().state !== "downloading") {
        return;
      }

      await stop();
      store.update({ state: "paused", receivedBytes: await partSize() });
    },
    resume: async () => {
      await loaded;
      const { state } = store.get();

      if (state !== "paused" && state !== "failed") {
        return;
      }

      startDownload();
    },
    import: async (path: string) => {
      await loaded;

      if (store.get().state === "ready") {
        return;
      }

      await stop();
      store.update({ state: "verifying", error: undefined });
      run((signal) => importFile(path, signal));
    },
  };
}

/** The byte a response starts at: 0 for a whole file, the Content-Range start for a partial one. */
function startOf(response: Response) {
  if (response.status !== 206) {
    return 0;
  }

  const start = /^bytes (\d+)-/.exec(response.headers.get("content-range") ?? "")?.[1];

  return Number(start ?? -1);
}

function rangeFrom(offset: number): Record<string, string> {
  if (offset === 0) {
    return {};
  }

  return { range: `bytes=${offset}-` };
}
