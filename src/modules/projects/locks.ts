import { readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
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

function parseLock(text: string): { host: string; pid: number } {
  try {
    const { host, pid } = JSON.parse(text) as { host?: unknown; pid?: unknown };

    return { host: typeof host === "string" ? host : "", pid: typeof pid === "number" ? pid : 0 };
  } catch {
    return { host: "", pid: 0 };
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
