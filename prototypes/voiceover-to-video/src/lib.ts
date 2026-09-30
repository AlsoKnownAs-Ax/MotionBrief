// PROTOTYPE: shared helpers for the voiceover-to-video spike.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TOOLS = join(ROOT, ".tools");

export function run(cmd: string, args: string[], opts: { cwd?: string; allowFail?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: opts.cwd, shell: false, maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr}\n${r.stdout}`);
  return (r.stdout ?? "") + (opts.allowFail ? (r.stderr ?? "") : "");
}
