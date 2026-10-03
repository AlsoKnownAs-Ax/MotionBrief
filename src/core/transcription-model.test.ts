import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TranscriptionModelStatus } from "../contract";
import type { Disk } from "../modules/system";
import type { ModelDep } from "../shared/deps-manifest";
import { createCore } from "./composition-root";
import { startFileServer, type FileServer } from "./test-support/file-server";

const MiB = 1024 * 1024;

/** A stand-in for the 574 MB model: big enough to arrive in many chunks, small enough to hash instantly. */
const MODEL = randomBytes(3 * MiB);

let server: FileServer;
let appDataDir: string;

beforeEach(async () => {
  server = await startFileServer();
  appDataDir = await mkdtemp(join(tmpdir(), "motionbrief-model-"));
});

afterEach(async () => {
  await server.close();
  await rm(appDataDir, { recursive: true, force: true });
});

function pinOf(body: Buffer, path = "/model.bin"): ModelDep {
  return { version: "test", url: `${server.url}${path}`, sha256: sha256(body), size: body.length };
}

type ConnectOptions = { pin?: ModelDep; freeBytes?: number };

/** A core on the shared app data folder; connecting again is what an app restart looks like. */
function connect({ pin = pinOf(MODEL), freeBytes = 100 * 1024 * MiB }: ConnectOptions = {}) {
  const disk: Disk = { freeBytes: async () => freeBytes };
  const { router } = createCore({ appVersion: "1.2.3", appDataDir, modelPin: pin, adapters: { disk } });

  return createRouterClient(router).transcriptionModel;
}

type ModelClient = ReturnType<typeof connect>;

/** Watches the model until its status matches. */
async function until(model: ModelClient, matches: (status: TranscriptionModelStatus) => boolean) {
  const stream = await model.watch();

  for await (const status of stream) {
    if (matches(status)) {
      return status;
    }
  }

  throw new Error("The status stream ended");
}

/** The model is done for now: in place, failed, or paused by the user. */
function settled(model: ModelClient) {
  return until(model, ({ state }) => state === "ready" || state === "failed" || state === "paused");
}

/** The SHA-256 of every file under dir: what the model costs in disk space, by content rather than by name. */
async function filesIn(dir: string) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));

  return Promise.all(files.map(async (file) => sha256(await readFile(file))));
}

function sha256(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}

describe("transcription model", () => {
  it("downloads the pinned model and reports it ready", async () => {
    server.serve("/model.bin", { body: MODEL });
    const model = connect();

    expect(await model.status()).toMatchObject({ state: "idle", receivedBytes: 0, totalBytes: MODEL.length });

    await model.start();

    expect(await settled(model)).toEqual({ state: "ready", receivedBytes: MODEL.length, totalBytes: MODEL.length });
  });

  it("checks for the model's size plus headroom in free space before downloading anything", async () => {
    server.serve("/model.bin", { body: MODEL });
    const model = connect({ freeBytes: MODEL.length + MiB });

    await model.start();

    expect(await settled(model)).toMatchObject({
      state: "failed",
      error: { code: "NOT_ENOUGH_SPACE", freeBytes: MODEL.length + MiB },
    });
    expect(server.requests).toEqual([]);
  });

  it("stays ready after an app restart without downloading again", async () => {
    server.serve("/model.bin", { body: MODEL });
    const before = connect();
    await before.start();
    await settled(before);

    const after = connect();
    await after.start();

    expect(await after.status()).toMatchObject({ state: "ready" });
    expect(server.requests).toHaveLength(1);
  });

  it("downloads a newly pinned model through the same flow, deleting the old one once the new one verifies", async () => {
    const NEXT = randomBytes(2 * MiB);
    server.serve("/model.bin", { body: MODEL });
    server.serve("/next.bin", { body: NEXT, stallAfter: MiB }, { body: NEXT });
    const current = connect();
    await current.start();
    await settled(current);

    const updated = connect({ pin: pinOf(NEXT, "/next.bin") });

    expect(await updated.status()).toMatchObject({ state: "idle", receivedBytes: 0 });

    await updated.start();
    await until(updated, ({ receivedBytes }) => receivedBytes >= MiB);
    await updated.pause();

    expect(await filesIn(appDataDir)).toContain(sha256(MODEL));

    await updated.resume();
    await settled(updated);

    expect(await filesIn(appDataDir)).toEqual([sha256(NEXT)]);
  });

  describe("resuming", () => {
    it("resumes after a pause from where it stopped, with an HTTP Range request", async () => {
      server.serve("/model.bin", { body: MODEL, stallAfter: MiB }, { body: MODEL });
      const model = connect();
      await model.start();
      await until(model, ({ receivedBytes }) => receivedBytes >= MiB);

      await model.pause();
      // Bytes still buffered for writing when the pause lands are dropped, and fetched again on resume.
      const paused = await model.status();

      expect(paused.state).toBe("paused");
      expect(paused.receivedBytes).toBeGreaterThan(MiB / 2);

      await model.resume();

      expect(await settled(model)).toMatchObject({ state: "ready" });
      expect(server.requests.map(({ range }) => range)).toEqual([undefined, `bytes=${paused.receivedBytes}-`]);
    });

    it("keeps what arrived when the connection drops, and resumes it after an app restart", async () => {
      server.serve("/model.bin", { body: MODEL, dropAfter: 2 * MiB }, { body: MODEL });
      const before = connect();
      await before.start();

      expect(await settled(before)).toMatchObject({ state: "failed", error: { code: "DOWNLOAD_FAILED" } });

      const after = connect();
      const { receivedBytes } = await after.status();

      expect(await after.status()).toMatchObject({ state: "idle" });
      expect(receivedBytes).toBeGreaterThan(MiB);

      await after.start();

      expect(await settled(after)).toMatchObject({ state: "ready" });
      expect(server.requests.map(({ range }) => range)).toEqual([undefined, `bytes=${receivedBytes}-`]);
    });

    it("leaves a paused download paused when the app starts it again", async () => {
      server.serve("/model.bin", { body: MODEL, stallAfter: MiB });
      const model = connect();
      await model.start();
      await until(model, ({ receivedBytes }) => receivedBytes >= MiB);
      await model.pause();

      await model.start();

      expect(await model.status()).toMatchObject({ state: "paused" });
      expect(server.requests).toHaveLength(1);
    });
  });

  describe("verifying", () => {
    /** The same size as the model, so only its hash gives it away. */
    const CORRUPT = randomBytes(MODEL.length);

    it("deletes a download that doesn't match the pinned SHA-256 and downloads it again from scratch", async () => {
      server.serve("/model.bin", { body: CORRUPT }, { body: MODEL });
      const model = connect();

      await model.start();

      expect(await settled(model)).toMatchObject({ state: "ready" });
      expect(server.requests.map(({ range }) => range)).toEqual([undefined, undefined]);
    });

    it("fails after one retry, and Retry downloads it again", async () => {
      server.serve("/model.bin", { body: CORRUPT }, { body: CORRUPT }, { body: MODEL });
      const model = connect();
      await model.start();

      expect(await settled(model)).toMatchObject({
        state: "failed",
        error: { code: "HASH_MISMATCH", expected: sha256(MODEL), actual: sha256(CORRUPT) },
      });
      expect(server.requests).toHaveLength(2);

      await model.resume();

      expect(await settled(model)).toMatchObject({ state: "ready" });
      expect(server.requests.map(({ range }) => range)).toEqual([undefined, undefined, undefined]);
    });
  });

  describe("importing a file the user already has", () => {
    let userDir: string;

    beforeEach(async () => {
      userDir = await mkdtemp(join(tmpdir(), "motionbrief-user-"));
    });

    afterEach(async () => {
      await rm(userDir, { recursive: true, force: true });
    });

    /** A file outside app data, as the user would pick it. */
    async function userFile(body: Buffer) {
      const path = join(userDir, `${randomUUID()}.bin`);
      await writeFile(path, body);

      return path;
    }

    it("installs a copy when Hugging Face can't be reached", async () => {
      server.serve("/model.bin", { body: MODEL, dropAfter: 0 });
      const model = connect();
      await model.start();

      expect(await settled(model)).toMatchObject({ state: "failed", error: { code: "DOWNLOAD_FAILED" } });

      const path = await userFile(MODEL);
      await model.import({ path });

      expect(await settled(model)).toMatchObject({ state: "ready" });
      // A copy: the user's file stays where it was.
      expect(await filesIn(userDir)).toEqual([sha256(MODEL)]);
      expect(await filesIn(appDataDir)).toEqual([sha256(MODEL)]);
    });

    it("refuses a file that doesn't match the pinned SHA-256", async () => {
      const model = connect();
      const path = await userFile(randomBytes(MODEL.length));

      await model.import({ path });

      expect(await settled(model)).toMatchObject({ state: "failed", error: { code: "IMPORT_MISMATCH", path } });
      expect(await connect().status()).toMatchObject({ state: "idle" });
    });

    it("stops a running download to import, keeping the downloaded part for a later Retry", async () => {
      server.serve("/model.bin", { body: MODEL, stallAfter: MiB }, { body: MODEL });
      const model = connect();
      await model.start();
      await until(model, ({ receivedBytes }) => receivedBytes >= MiB);

      await model.import({ path: await userFile(randomBytes(64)) });
      const { receivedBytes } = await settled(model);
      await model.resume();

      expect(await settled(model)).toMatchObject({ state: "ready" });
      expect(server.requests.map(({ range }) => range)).toEqual([undefined, `bytes=${receivedBytes}-`]);
    });
  });
});
