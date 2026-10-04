import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

/** Windows and macOS file systems ignore case by default, so two spellings of one folder are the same Project. */
const IGNORES_CASE = process.platform === "win32" || process.platform === "darwin";

export function samePath(a: string, b: string) {
  return comparable(a) === comparable(b);
}

/**
 * Who a folder is: its real location through any junction, symlink or short name, as a key to compare. Two routes to
 * one folder are one Project. A folder that isn't there falls back to its spelling.
 */
export async function folderKey(path: string) {
  const resolved = resolve(path);

  try {
    return comparable(await realpath(resolved));
  } catch {
    return comparable(resolved);
  }
}

function comparable(path: string) {
  const resolved = resolve(path);

  if (IGNORES_CASE) {
    return resolved.toLowerCase();
  }

  return resolved;
}
