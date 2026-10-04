import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UnitCode } from "../../contract";
import type { EvalResult } from "./results";
import type { CaseOutput } from "./run";

/** Saves the eval's results as `<runId>.json`, to be committed beside earlier releases' results. */
export async function saveResults(result: EvalResult, resultsDir: string): Promise<string> {
  const path = join(resultsDir, `${result.runId}.json`);
  await mkdir(resultsDir, { recursive: true });
  await writeJson(path, result);

  return path;
}

/**
 * Adds an eval's agent outputs to the tier-2 replay corpus under `fixturesDir` (the core's `fixtures/`), one run per
 * case: `corpus/eval-<runId>-<case>.json`, and its files in `eval/<runId>/<case>/`: the Transcript, the first
 * generation's Storyboard and Scene code, and per Revision its patch and regenerated units' code. Units that ended as
 * fallbacks are listed in `fallbacks`, so the replay plays them as fallbacks too. No audio. Answers with the entries'
 * paths.
 */
export async function addToCorpus(outputs: CaseOutput[], { fixturesDir, runId }: { fixturesDir: string; runId: string }): Promise<string[]> {
  await mkdir(join(fixturesDir, "corpus"), { recursive: true });

  return Promise.all(outputs.map((output) => addCase(output, fixturesDir, runId)));
}

async function addCase(output: CaseOutput, fixturesDir: string, runId: string): Promise<string> {
  const caseDir = ["eval", runId, output.caseId].join("/");
  await mkdir(join(fixturesDir, caseDir), { recursive: true });
  await writeJson(join(fixturesDir, caseDir, "transcript.json"), output.transcript);
  await writeJson(join(fixturesDir, caseDir, "storyboard.json"), output.storyboard);
  const units = await writeUnits(fixturesDir, caseDir, output.code);
  const revisions = await Promise.all(
    output.revisions.map(async ({ request, scope, patch, code, fallbacks }, index) => {
      const revisionDir = `${caseDir}/revision-${index + 1}`;
      await mkdir(join(fixturesDir, revisionDir), { recursive: true });
      await writeJson(join(fixturesDir, revisionDir, "patch.json"), patch);

      return { request, scope, patch: `${revisionDir}/patch.json`, units: await writeUnits(fixturesDir, revisionDir, code), fallbacks };
    }),
  );
  const entry = {
    description: `Paid eval ${runId}: ${output.caseId}, as the agent wrote it`,
    frameContractVersion: output.frameContractVersion,
    preset: output.preset,
    storyboard: `${caseDir}/storyboard.json`,
    transcript: `${caseDir}/transcript.json`,
    units,
    fallbacks: output.fallbacks,
    revisions,
  };
  const path = join(fixturesDir, "corpus", `eval-${runId}-${output.caseId}.json`);
  await writeJson(path, entry);

  return path;
}

/** Writes each unit's `.css`, `.html` and `.js` into `dir` and answers with their paths, relative to `fixtures/`, by unit. */
async function writeUnits(fixturesDir: string, dir: string, code: Record<string, UnitCode>): Promise<Record<string, string>> {
  await Promise.all(
    Object.entries(code).flatMap(([unit, unitCode]) => (["css", "html", "js"] as const).map((part) => writeFile(join(fixturesDir, dir, `${unit}.${part}`), unitCode[part]))),
  );

  return Object.fromEntries(Object.keys(code).map((unit) => [unit, `${dir}/${unit}`]));
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
