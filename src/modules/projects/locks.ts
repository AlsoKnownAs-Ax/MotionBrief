import { readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { fileStep, writeAtomically } from "./files";

export const LOCK_FILE = ".lock";

/** Who holds a Project's `.lock`, and since when. */
export type Lock = {
  host: string;
  pid: number;
  /** When the lock was taken, in ms since the epoch. */
  lockedAt: number;
  isThisComputer: boolean;
  /** Its holder is gone: a MotionBrief that quit unexpectedly, or one on another computer that can't be checked. */
  isStale: boolean;
  /** This MotionBrief holds it. */
  isOurs: boolean;
};

/** Marks the Project as open in this app, so another app or computer can tell (ADR 0004). */
export function writeLock(dir: string) {
  return writeAtomically(join(dir, LOCK_FILE), JSON.stringify({ host: hostname(), pid: process.pid }));
}

export function removeLock(dir: string) {
  const path = join(dir, LOCK_FILE);

  return fileStep(path, () => rm(path, { force: true }));
}

/** The Project's lock, if it has one. A lock that can't be read is treated as stale. */
export async function readLock(dir: string): Promise<Lock | undefined> {
  const path = join(dir, LOCK_FILE);
  const { data: text } = await fileStep(path, () => readFile(path, "utf8"));
  const { data: stats } = await fileStep(path, () => stat(path));

  if (text === null || !stats) {
    return undefined;
  }

  const { host, pid } = parseLock(text);
  const isThisComputer = host === hostname();

  return {
    host,
    pid,
    lockedAt: stats.mtimeMs,
    isThisComputer,
    isStale: !isThisComputer || !isRunning(pid),
    isOurs: isThisComputer && pid === process.pid,
  };
}

/** Each field on its own, so a lock with one unreadable field still names its holder's other. */
const LockFileSchema = z.object({ host: z.string().catch(""), pid: z.number().catch(0) });

/** A lock that isn't JSON, or isn't one at all, names no holder: no host and no process, so it is stale. */
const UNREADABLE = { host: "", pid: 0 };

function parseLock(text: string): { host: string; pid: number } {
  const { success, data: lock } = LockFileSchema.safeParse(parseJson(text));

  if (!success) {
    return UNREADABLE;
  }

  return lock;
}

/** JSON.parse throws on text that isn't JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Signal 0 checks a process exists without touching it; EPERM means it exists but belongs to someone else. */
function isRunning(pid: number) {
  if (pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
