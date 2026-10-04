import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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

/** Copies a file and returns the SHA-256 of what it copied, reading it once. */
export function copyHashed(from: string, to: string, signal: AbortSignal) {
  return fileStep(from, async () => {
    const hash = createHash("sha256");
    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(createReadStream(from), hashing, createWriteStream(to), { signal });

    return hash.digest("hex");
  });
}

export function sha256File(path: string, signal: AbortSignal) {
  return fileStep(path, async () => {
    const hash = createHash("sha256");
    await pipeline(createReadStream(path), hash, { signal });

    return hash.digest("hex");
  });
}
