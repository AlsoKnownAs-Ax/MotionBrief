import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Result } from "./manifest.ts";

export type DownloadError = { code: "DOWNLOAD_FAILED"; url: string; message: string };

export type ExtractError = { code: "EXTRACT_FAILED"; archive: string; message: string };

/** Streams url into dest and returns the SHA-256 of the bytes written. */
export async function download(url: string, dest: string): Promise<Result<string, DownloadError>> {
  const hash = createHash("sha256");

  try {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      return { data: null, error: { code: "DOWNLOAD_FAILED", url, message: `HTTP ${response.status}` } };
    }

    const hashing = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), hashing, createWriteStream(dest));
  } catch (error) {
    return { data: null, error: { code: "DOWNLOAD_FAILED", url, message: String(error) } };
  }

  return { data: hash.digest("hex"), error: null };
}

export async function fetchJson(url: string): Promise<Result<unknown, DownloadError>> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });

    if (!response.ok) {
      return { data: null, error: { code: "DOWNLOAD_FAILED", url, message: `HTTP ${response.status}` } };
    }

    return { data: await response.json(), error: null };
  } catch (error) {
    return { data: null, error: { code: "DOWNLOAD_FAILED", url, message: String(error) } };
  }
}

export async function sha256File(path: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);

  return hash.digest("hex");
}

/** Unpacks a zip or tarball (or only its `members`) into dir with bsdtar, keeping file modes. */
export function extract(archive: string, dir: string, members: string[] = []): Promise<Result<null, ExtractError>> {
  return new Promise((resolve) => {
    const tar = spawn(bsdtarPath(), ["-xf", archive, "-C", dir, ...members], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    tar.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    tar.on("error", (error) => resolve({ data: null, error: { code: "EXTRACT_FAILED", archive, message: String(error) } }));
    tar.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve({ data: null, error: { code: "EXTRACT_FAILED", archive, message: stderr.trim() } });

        return;
      }

      resolve({ data: null, error: null });
    });
  });
}

/**
 * bsdtar reads and writes zip and tar on both platforms: System32\tar.exe on Windows, /usr/bin/tar on macOS.
 * A GNU tar earlier on PATH (Git Bash, MSYS2, Homebrew) can't read zip, so it is never looked up on PATH.
 */
export function bsdtarPath() {
  if (process.platform === "win32") {
    return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  }

  return "/usr/bin/tar";
}
