/**
 * `npm run eval [-- --dry-run] [-- --rotation=N]`: the tier-3 paid eval (src/core/eval/cli.ts). The core imports files
 * as text the way Vite does, so it is loaded through Vite's module runner rather than Node's own loader.
 */
import { join } from "node:path";
import { runnerImport } from "vite";

type EvalCli = { main: (argv: string[]) => Promise<number> };

const root = join(import.meta.dirname, "..");
const { module: cli } = await runnerImport<EvalCli>(join(root, "src", "core", "eval", "cli.ts"), { root, configFile: false, logLevel: "error" });

// The Checker's browser and the module runner keep handles open; the eval is done once main answers.
process.exit(await cli.main(process.argv.slice(2)));
