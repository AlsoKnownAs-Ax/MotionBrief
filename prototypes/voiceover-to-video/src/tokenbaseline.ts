// PROTOTYPE: how often did the spike's Scene code (written before the token-only rule) use raw colors/fonts?
// usage: node src/tokenbaseline.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { tokenLint } from "./tokens.ts";

const runs = join(process.argv[2] ?? join(ROOT, "runs"));
let units = 0, failing = 0;
const kinds: Record<string, number> = {};
for (const r of readdirSync(runs)) {
  if (!existsSync(join(runs, r)) || r === "lookcheck") continue;
  for (const f of readdirSync(join(runs, r), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(runs, r, d.name, "code")))) {
    const dir = join(runs, r, f.name, "code");
    const latest = new Map<string, string>();
    for (const file of readdirSync(dir).filter((x) => !x.includes("attempt9")).sort()) latest.set(file.split(".")[0], file);
    for (const file of latest.values()) {
      const errs = tokenLint(JSON.parse(readFileSync(join(dir, file), "utf8")));
      units++;
      if (errs.length) failing++;
      for (const e of errs) { const k = e.replace(/"[^"]*"|#[0-9a-f]+/gi, "").split("—")[0].trim(); kinds[k] = (kinds[k] ?? 0) + 1; }
    }
  }
}
console.log(JSON.stringify({ units, failing, kinds }, null, 1));
