import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalResult } from "./results";
import type { CaseOutput, VersionOutput } from "./run";

/** Saves the eval's results as `<runId>.json`, to be committed beside earlier releases' results. */
export async function saveResults(result: EvalResult, resultsDir: string): Promise<string> {
  const path = join(resultsDir, `${result.runId}.json`);
  await mkdir(resultsDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);

  return path;
}

/**
 * Adds an eval's text outputs to the tier-2 replay corpus under `fixturesDir` (the core's `fixtures/`): per case its
 * Transcript, every agent turn as a replay script, and each saved Version's Storyboard and Scene code, with one corpus
 * entry per Version for the replay test to check against the current frame. No audio. Answers with the entries' paths.
 */
export async function addToCorpus(outputs: CaseOutput[], { fixturesDir, runId }: { fixturesDir: string; runId: string }): Promise<string[]> {
  await mkdir(join(fixturesDir, "corpus"), { recursive: true });
  const entries: string[] = [];

  for (const output of outputs) {
    entries.push(...(await addCase(output, fixturesDir, runId)));
  }

  return entries;
}

async function addCase({ caseId, transcript, versions, replay }: CaseOutput, fixturesDir: string, runId: string): Promise<string[]> {
  const caseDir = ["eval", runId, caseId].join("/");
  await mkdir(join(fixturesDir, caseDir), { recursive: true });
  await writeJson(join(fixturesDir, caseDir, "transcript.json"), transcript);
  await writeJson(join(fixturesDir, caseDir, "replay.json"), replay);
  const entries: string[] = [];

  for (const version of versions) {
    entries.push(await addVersion(version, { fixturesDir, caseDir, name: `eval-${runId}-${caseId}-v${version.version}` }));
  }

  return entries;
}

async function addVersion(output: VersionOutput, { fixturesDir, caseDir, name }: { fixturesDir: string; caseDir: string; name: string }): Promise<string> {
  const versionDir = `${caseDir}/v${output.version}`;
  await mkdir(join(fixturesDir, versionDir), { recursive: true });
  await writeJson(join(fixturesDir, versionDir, "storyboard.json"), output.storyboard);
  await Promise.all(
    Object.entries(output.code).flatMap(([unit, code]) =>
      (["css", "html", "js"] as const).map((part) => writeFile(join(fixturesDir, versionDir, `${unit}.${part}`), code[part])),
    ),
  );

  const entry = {
    description: `Paid eval ${name.replace(/^eval-/, "")}: Version ${output.version}, as the agent wrote it`,
    frameContractVersion: output.frameContractVersion,
    preset: output.preset,
    rules: output.rules,
    storyboard: `${versionDir}/storyboard.json`,
    transcript: `${caseDir}/transcript.json`,
    units: Object.fromEntries(Object.keys(output.code).map((unit) => [unit, `${versionDir}/${unit}`])),
  };
  const path = join(fixturesDir, "corpus", `${name}.json`);
  await writeJson(path, entry);

  return path;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
