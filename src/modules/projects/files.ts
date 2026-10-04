import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type FileError = { code: "FILE_FAILED"; path: string; message: string };

/** Runs a filesystem step on path, turning its rejection into a FileError. */
export async function fileStep<T>(path: string, step: () => Promise<T>): Promise<Result<T, FileError>> {
  try {
    return { data: await step(), error: null };
  } catch (error) {
    return { data: null, error: { code: "FILE_FAILED", path, message: String(error) } };
  }
}

/** Writes a file in full beside its destination, then renames it into place, so a crash never leaves half a file. */
export function writeAtomically(path: string, content: string) {
  return fileStep(path, async () => {
    const staged = `${path}.${randomUUID()}.tmp`;

    try {
      await writeFile(staged, content);
      await renameRetrying(staged, path);
    } finally {
      await rm(staged, { force: true });
    }
  });
}

/** Copies a file byte for byte, through a staged copy renamed into place, and returns the SHA-256 of what it copied. */
export function copyHashed(from: string, to: string) {
  return fileStep(to, async () => {
    const staged = `${to}.${randomUUID()}.tmp`;
    const hash = createHash("sha256");
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(createReadStream(from), hashing, createWriteStream(staged));
      await renameRetrying(staged, to);
    } finally {
      await rm(staged, { force: true });
    }

    return hash.digest("hex");
  });
}

/**
 * Errors Windows gives while another process has a file open. Virus scanners, sync clients and the search indexer
 * open every new file in Documents for a while, so a fresh Project can't be renamed for seconds.
 */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Seven tries 0.1 s to 3.2 s apart: about six seconds in all. */
const RENAME_ATTEMPTS = 7;
const FIRST_RETRY_MS = 100;

/** Renames, trying again with growing pauses while Windows reports the file or folder busy. */
export async function renameRetrying(from: string, to: string, attempt = 1): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";

    if (attempt >= RENAME_ATTEMPTS || !TRANSIENT.has(code)) {
      throw error;
    }

    await sleep(FIRST_RETRY_MS * 2 ** (attempt - 1));
    await renameRetrying(from, to, attempt + 1);
  }
}
