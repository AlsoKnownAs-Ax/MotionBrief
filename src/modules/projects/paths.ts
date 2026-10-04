import { resolve } from "node:path";

/** Windows and macOS file systems ignore case by default, so two spellings of one folder are the same Project. */
const IGNORES_CASE = process.platform === "win32" || process.platform === "darwin";

export function samePath(a: string, b: string) {
  return comparable(a) === comparable(b);
}

function comparable(path: string) {
  const resolved = resolve(path);

  if (IGNORES_CASE) {
    return resolved.toLowerCase();
  }

  return resolved;
}
