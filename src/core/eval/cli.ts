import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { createInterface } from "node:readline/promises";
import { createRouterClient } from "@orpc/server";
import type { CoreClient } from "../../contract";
import { createClaudeConnector, memoryConnectionStore } from "../../modules/claude";
import { DEFAULT_MODELS } from "../../modules/settings";
import { bundledClaudePath } from "../claude-binary";
import { createCore } from "../composition-root";
import { addToCorpus, saveResults } from "./corpus";
import { createRecorder } from "./recorder";
import { releaseSet, ROTATION, VOICEOVERS, type EvalCase } from "./release-set";
import { fallbackRate, type CaseResult, type Verdict } from "./results";
import { runEval } from "./run";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EVAL_DIR = join(ROOT, "eval");
const VOICEOVERS_DIR = join(EVAL_DIR, "voiceovers");
const RESULTS_DIR = join(EVAL_DIR, "results");
/** Git-ignored: the eval's app data (the transcription model, kept between runs), cache, Projects and exports. */
const WORK_DIR = join(EVAL_DIR, ".work");
const FIXTURES_DIR = join(ROOT, "src", "core", "fixtures");

type Args = { isDryRun: boolean; rotation?: number };

/**
 * `npm run eval`: the tier-3 paid eval. Runs a release set on the maintainer's own Claude login with the shipped
 * default models, asks for a verdict, writes commit-ready results to `eval/results/` and the agent's outputs to the replay
 * corpus, and reports whether a stable release is blocked. Local only: it refuses to run in CI. `--dry-run` checks
 * everything it needs and prints the release set without starting a single agent turn. Answers with the exit code.
 */
export async function main(argv: string[]): Promise<number> {
  if (process.env.CI) {
    console.error("The paid eval runs locally only, on your own Claude login; it never runs in CI.");
    return 1;
  }

  const args = parseArgs(argv);
  const rotation = args.rotation ?? (await earlierRuns());
  const voiceovers = await voiceoverFiles();
  const cases = releaseSet(rotation, (id) => voiceovers.get(id) ?? join(VOICEOVERS_DIR, `${id}.<missing>`));
  const missing = Object.values(VOICEOVERS).filter(({ id }) => !voiceovers.has(id));
  const appVersion = await packageVersion();
  const runId = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-v${appVersion}`;
  printPlan(cases, rotation);

  missing.forEach(({ id, seconds }) =>
    console.error(`Missing Voiceover: eval/voiceovers/${id}.<ext>, the maintainer's CC0 recording of about ${seconds} s. See eval/voiceovers/README.md.`),
  );

  const recorder = createRecorder(createClaudeConnector({ claudePath: bundledClaudePath(), store: memoryConnectionStore() }));
  const core = createCore({
    appVersion,
    appDataDir: join(WORK_DIR, "app-data"),
    projectsDir: join(WORK_DIR, "Projects", runId),
    cacheDir: join(WORK_DIR, "cache"),
    adapters: { connector: recorder.connector },
  });
  const client: CoreClient = createRouterClient(core.router);

  try {
    // Choosing the subscription login only reads `claude auth status`: no tokens.
    const { status, error } = await client.connection.useLogin();
    console.log(`Claude: ${error?.message ?? `${status.login?.email ?? "signed in"} · ${status.login?.plan ?? "subscription"}`}`);
    const model = await client.transcriptionModel.status();
    console.log(`Transcription model: ${model.state}`);

    if (args.isDryRun) {
      console.log("Dry run: no agent turn was started.");
      return 0;
    }

    if (error || missing.length > 0) {
      return 1;
    }

    if (!(await confirmed(cases))) {
      console.log("Nothing was run.");
      return 0;
    }

    await modelReady(client);
    const exportDir = join(WORK_DIR, "output", runId);
    const { result, outputs } = await runEval({
      core: client,
      recorder,
      runId,
      cases,
      projectsDir: join(WORK_DIR, "Projects", runId),
      exportDir,
      verdict: askVerdict,
      log: (line) => console.log(line),
    });
    const resultsPath = await saveResults(result, RESULTS_DIR);
    const entries = await addToCorpus(outputs, { fixturesDir: FIXTURES_DIR, runId });
    console.log(`Results: ${resultsPath}`);
    console.log(`Replay corpus: ${entries.length} entries added under src/core/fixtures/corpus/`);

    if (result.blocked) {
      console.log(`BLOCKED: a stable release must wait.\n${result.blockReasons.map((reason) => `- ${reason}`).join("\n")}`);
      return 1;
    }

    console.log("Not blocked.");
    return 0;
  } finally {
    await core.shutdown();
  }
}

function parseArgs(argv: string[]): Args {
  return { isDryRun: argv.includes("--dry-run"), rotation: rotationArg(argv) };
}

/** `--rotation=N` picks the rotation's Nth Preset and Format (from 0) instead of the next one. */
function rotationArg(argv: string[]): number | undefined {
  const value = argv.find((arg) => arg.startsWith("--rotation="))?.slice("--rotation=".length);

  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }

  return Number(value);
}

/** Each release rotates on from the last: the results already committed count the releases so far. */
async function earlierRuns(): Promise<number> {
  const names = await readdir(RESULTS_DIR).catch(() => []);

  return names.filter((name) => name.endsWith(".json")).length;
}

/** The committed Voiceovers by id: `explainer.wav` is the explainer's, whatever its extension. */
async function voiceoverFiles(): Promise<Map<string, string>> {
  const names = await readdir(VOICEOVERS_DIR).catch(() => []);
  const ids = new Set<string>(Object.values(VOICEOVERS).map(({ id }) => id));

  return new Map(names.filter((name) => ids.has(parse(name).name)).map((name) => [parse(name).name, join(VOICEOVERS_DIR, name)]));
}

async function packageVersion(): Promise<string> {
  const { version } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version: string };

  return version;
}

function printPlan(cases: EvalCase[], rotation: number) {
  console.log(`Release set (rotation ${rotation % ROTATION.length + 1} of ${ROTATION.length}):`);
  cases.forEach(({ id, voiceover, revisions }) => console.log(`- ${id}: ${voiceover}, then ${revisions.map(({ scope }) => scope).join(" and ")} Revisions`));
  console.log(`Models: ${Object.entries(DEFAULT_MODELS).map(([role, model]) => `${role} ${model}`).join(", ")}`);
}

async function confirmed(cases: EvalCase[]): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await prompt.question(`This spends real usage on your Claude login: ${cases.length} generations and their Revisions. Type "run" to start: `);

    return answer.trim() === "run";
  } finally {
    prompt.close();
  }
}

async function modelReady(core: CoreClient) {
  await core.transcriptionModel.start();

  for await (const { state, receivedBytes, totalBytes, error } of await core.transcriptionModel.watch()) {
    if (state === "ready") {
      return;
    }

    if (state === "failed") {
      throw new Error(`The transcription model couldn't be installed: ${error?.code ?? "no reason given"}`);
    }

    console.log(`Transcription model: ${state} ${Math.round((receivedBytes / totalBytes) * 100)}%`);
  }
}

/** Shows what each case made and asks the maintainer, who watched the exports, whether it is good enough to release. */
async function askVerdict(cases: CaseResult[]): Promise<Verdict> {
  cases.forEach(({ id, exportPath, generation, revisions }) =>
    console.log(
      `- ${id}: ${exportPath ?? "not exported"}; ${generation.units.filter(({ status }) => status === "fallback").length} fallbacks of ${generation.units.length} units; Revisions ${revisions.map(({ state }) => state).join(", ")}`,
    ),
  );
  console.log(`Fallback rate: ${(fallbackRate(cases) * 100).toFixed(1)}%`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await prompt.question("Watch the exports. Are these videos good enough to release? (y/n): ");
    const note = await prompt.question("Note: ");

    return { looksRight: answer.trim().toLowerCase().startsWith("y"), note: note.trim() };
  } finally {
    prompt.close();
  }
}
