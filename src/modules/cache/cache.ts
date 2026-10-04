import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { CacheStatus } from "../../contract";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type CacheError = { code: "FILE_FAILED"; path: string; message: string };

export type CacheOptions = {
  /** The app's cache folder, outside any Project. */
  dir: string;
  capBytes: number;
};

export type Cache = ReturnType<typeof createCache>;

/** Around 5 GB: room for hours of resampled audio. */
export const DEFAULT_CACHE_CAP_BYTES = 5_000_000_000;

/** Where files are written before they are complete; never counted, never served. */
const STAGING = ".staging";

type Entry = { key: string; path: string; bytes: number; usedAt: number };

/**
 * Files the app can regenerate (resampled audio, raw Whisper output), keyed by content hash rather than Project, so
 * every Project shares them. Least recently used entries are evicted to stay under the cap. Keys are relative paths
 * such as `audio/<sha256>.wav`.
 */
export function createCache({ dir, capBytes }: CacheOptions) {
  /** Entries in use, by how many users: eviction and Clear cache leave them alone. */
  const held = new Map<string, number>();

  /** The entry's path if it is cached, marking it as just used; `undefined` on a miss. */
  async function get(key: string) {
    const path = pathOf(key);
    const now = new Date();
    const { error } = await fileStep(path, () => utimes(path, now, now));

    if (error) {
      return undefined;
    }

    return path;
  }

  /**
   * Caches what `write` writes to the path it is given, then evicts down to the cap. A failed write caches nothing.
   * Resolves to the entry's path.
   */
  async function put<E>(key: string, write: (path: string) => Promise<Result<unknown, E>>): Promise<Result<string, E | CacheError>> {
    const { data: staged, error: scratchError } = await scratch();

    if (scratchError) {
      return { data: null, error: scratchError };
    }

    const { error } = await write(staged);

    if (error) {
      await fileStep(staged, () => rm(staged, { force: true }));

      return { data: null, error };
    }

    const path = pathOf(key);
    const { error: renameError } = await fileStep(path, async () => {
      await mkdir(dirname(path), { recursive: true });
      await rename(staged, path);
    });

    if (renameError) {
      return { data: null, error: renameError };
    }

    await evict(capBytes);

    return { data: path, error: null };
  }

  /** A path to write a file that is only needed for a moment; deleting it is the caller's job. */
  async function scratch(): Promise<Result<string, CacheError>> {
    const path = join(dir, STAGING, randomUUID());
    const { error } = await fileStep(path, () => mkdir(dirname(path), { recursive: true }));

    if (error) {
      return { data: null, error };
    }

    return { data: path, error: null };
  }

  /** Keeps the entry from being evicted or cleared until the returned function is called. */
  function hold(key: string) {
    held.set(key, (held.get(key) ?? 0) + 1);

    return () => {
      const count = (held.get(key) ?? 1) - 1;

      if (count > 0) {
        held.set(key, count);
        return;
      }

      held.delete(key);
    };
  }

  /** Deletes least recently used entries, except held ones, until the cache fits in `limit`. */
  async function evict(limit: number) {
    const entries = (await entriesOf()).sort((a, b) => a.usedAt - b.usedAt);
    const evictable = entries.filter(({ key }) => !held.has(key));
    let used = sum(entries);

    for (const entry of evictable) {
      if (used <= limit) {
        return;
      }

      await fileStep(entry.path, () => rm(entry.path, { force: true }));
      used -= entry.bytes;
    }
  }

  async function status(): Promise<CacheStatus> {
    return { usedBytes: sum(await entriesOf()), capBytes };
  }

  async function entriesOf(): Promise<Entry[]> {
    const { data: found } = await fileStep(dir, () => readdir(dir, { recursive: true, withFileTypes: true }));
    const files = (found ?? [])
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !relative(dir, path).startsWith(STAGING));
    const entries = await Promise.all(files.map(entryAt));

    return entries.filter((entry) => entry !== undefined);
  }

  async function entryAt(path: string): Promise<Entry | undefined> {
    const { data: stats } = await fileStep(path, () => stat(path));

    if (!stats) {
      return undefined;
    }

    return { key: relative(dir, path).split("\\").join("/"), path, bytes: stats.size, usedAt: stats.mtimeMs };
  }

  function pathOf(key: string) {
    return join(dir, ...key.split("/"));
  }

  return {
    get,
    put,
    scratch,
    hold,
    status,
    /** Settings → Clear cache: deletes every entry that isn't in use. */
    clear: async () => {
      await evict(0);

      return status();
    },
  };
}

function sum(entries: Entry[]) {
  return entries.reduce((total, { bytes }) => total + bytes, 0);
}

async function fileStep<T>(path: string, step: () => Promise<T>): Promise<Result<T, CacheError>> {
  try {
    return { data: await step(), error: null };
  } catch (error) {
    return { data: null, error: { code: "FILE_FAILED", path, message: String(error) } };
  }
}
