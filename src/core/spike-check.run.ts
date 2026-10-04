import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckFinding, Format, StoryboardRules, StoryboardTranscript, UnitCode } from "../contract";
import { validateStoryboard } from "../modules/storyboard";
import { bundledPreset } from "../modules/style";
import { connect } from "./test-support/checker";

/** Where the report is written. */
const OUT_DIR = join(import.meta.dirname, "..", "..", "out", "spike-check");

/** The spike's own rules: every Transition, Canvases where they help, no Captions (it had none). */
const SPIKE_RULES = { transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"], canvas: "where-it-helps", captions: false } as const;

/** Spike Scene Types that were renamed since. */
const RENAMED_TYPES: Record<string, string> = { architecture: "architecture-diagram", stat: "stat-chart" };

type SpikeScene = { id: string; type: string; from: number; to: number; canvas?: string; transitionIn?: string | { type: string; element?: string }; content: Record<string, unknown> };

type RunReport = { run: string; format: Format; storyboardIssues: string[]; units: { unit: string; findings: CheckFinding[] }[] };

/**
 * The one-off "old outputs vs new frame" check (spec #23, tier 2): runs the spike's committed agent outputs
 * (`prototypes/voiceover-to-video/runs/<voiceover>/<run>/`, never committed here) through today's Checker. They are
 * not added to the replay corpus: most predate the token rule. Each run's Storyboard is translated to today's schema
 * where it maps one to one; a run whose Storyboard still doesn't validate is reported without a check. Point
 * MOTIONBRIEF_SPIKE_RUNS at the spike's `runs` folder and run `pnpm spike-check`; it writes `out/spike-check/report.md`.
 */
describe("the spike's outputs against the new frame", () => {
  it("are checked and reported", async () => {
    const runsDir = process.env.MOTIONBRIEF_SPIKE_RUNS;

    if (!runsDir) {
      throw new Error("Set MOTIONBRIEF_SPIKE_RUNS to the spike's prototypes/voiceover-to-video/runs folder");
    }

    const runs = await spikeRuns(runsDir);
    const reports: RunReport[] = [];

    for (const run of runs) {
      reports.push(await checkRun(run));
    }

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, "report.md"), reportMarkdown(reports));
    await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(reports, null, 2));

    expect(reports).not.toEqual([]);
  });
});

/** Every run folder with a Storyboard and Scene code, beside its Voiceover's Transcript. */
async function spikeRuns(runsDir: string): Promise<{ dir: string; transcriptPath: string; name: string }[]> {
  const voiceovers = await readdir(runsDir, { withFileTypes: true });
  const runs = await Promise.all(
    voiceovers
      .filter((entry) => entry.isDirectory())
      .map(async (voiceover) => {
        const dir = join(runsDir, voiceover.name);
        const children = await readdir(dir, { withFileTypes: true });

        return children
          .filter((entry) => entry.isDirectory() && entry.name !== "audio")
          .map((entry) => ({ dir: join(dir, entry.name), transcriptPath: join(dir, "transcript.json"), name: `${voiceover.name}/${entry.name}` }));
      }),
  );
  const withCode = await Promise.all(runs.flat().map(async (run) => ({ run, files: await readdir(join(run.dir, "code")).catch(() => []) })));

  return withCode.filter(({ files }) => files.length > 0).map(({ run }) => run);
}

async function checkRun({ dir, transcriptPath, name }: { dir: string; transcriptPath: string; name: string }): Promise<RunReport> {
  const format = formatOfRun(dir);
  const rules: StoryboardRules = { ...SPIKE_RULES, transitions: [...SPIKE_RULES.transitions], format };
  const transcript = toTranscript(JSON.parse(await readFile(transcriptPath, "utf8")));
  const spike = JSON.parse(await readFile(join(dir, "storyboard.json"), "utf8")) as { scenes: SpikeScene[] };
  const storyboard = toStoryboard(spike.scenes, format);
  const { error } = validateStoryboard(storyboard, transcript, rules);

  if (error) {
    return { run: name, format, storyboardIssues: error.issues.map(({ message }) => message), units: [] };
  }

  const code = await finalCode(join(dir, "code"));
  const report = await connect().checker.check({ storyboard, transcript, rules, preset: bundledPreset("blueprint"), code });
  const units = Object.keys(code).map((unit) => ({ unit, findings: report.findings.filter((finding) => finding.unit === unit) }));
  const unattributed = report.findings.filter((finding) => !finding.unit);

  return { run: name, format, storyboardIssues: [], units: [...units, ...unattributedUnit(unattributed)] };
}

/** The spike named each run folder after its Format: `vertical-r2`, `horizontal-r1`. */
function formatOfRun(dir: string): Format {
  if (basename(dir).startsWith("vertical")) {
    return "vertical";
  }

  return "horizontal";
}

function unattributedUnit(findings: CheckFinding[]) {
  if (findings.length === 0) {
    return [];
  }

  return [{ unit: "(page)", findings }];
}

/** The spike wrote `{ i, w, s, e }` words. */
function toTranscript(spike: { duration: number; words: { w: string; s: number; e: number }[] }): StoryboardTranscript {
  return { duration: spike.duration, words: spike.words.map(({ w, s, e }) => ({ text: w, start: s, end: e })) };
}

/**
 * Today's Storyboard from the spike's: Scene Types renamed, `intent` dropped, each Scene's `transitionIn` moved to the
 * Scene before it as its outgoing Transition, and code `lines` as one block on the Scene's first word.
 */
function toStoryboard(scenes: SpikeScene[], format: Format) {
  return {
    format,
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      type: RENAMED_TYPES[scene.type] ?? scene.type,
      from: scene.from,
      to: scene.to,
      canvas: scene.canvas,
      transition: transitionOf(scenes[index + 1]?.transitionIn),
      content: contentOf(scene),
    })),
  };
}

function transitionOf(spike: SpikeScene["transitionIn"]) {
  if (typeof spike === "string") {
    return { type: spike };
  }

  return spike;
}

function contentOf({ type, from, content }: SpikeScene): Record<string, unknown> {
  if (type !== "code" || !Array.isArray(content.lines)) {
    return content;
  }

  // The spike's `reveal` (typing or not) is motion, which today's Storyboard leaves to Scene code.
  const rest = Object.fromEntries(Object.entries(content).filter(([key]) => key !== "lines" && key !== "reveal"));

  return { ...rest, blocks: [{ id: "lines", lines: content.lines, at: from }] };
}

/** Each unit's last attempt: `attempt9` is the spike's final code, else the highest attempt number. */
async function finalCode(codeDir: string): Promise<Record<string, UnitCode>> {
  const files = await readdir(codeDir);
  const attempts = files.map((file) => ({ file, unit: file.split(".")[0] ?? "", attempt: Number(/attempt(\d+)/.exec(file)?.[1] ?? 0) }));
  const byUnit = Map.groupBy(attempts, ({ unit }) => unit);
  const latest = [...byUnit.values()].map((unitAttempts) => unitAttempts.toSorted((a, b) => b.attempt - a.attempt)[0]!);

  return Object.fromEntries(
    await Promise.all(
      latest.map(async ({ unit, file }) => {
        const { css = "", html = "", js = "" } = JSON.parse(await readFile(join(codeDir, file), "utf8")) as Partial<UnitCode>;

        return [unit, { css, html, js }] as const;
      }),
    ),
  );
}

function reportMarkdown(reports: RunReport[]): string {
  const checked = reports.flatMap(({ units }) => units.filter(({ unit }) => unit !== "(page)"));
  const passing = checked.filter(({ findings }) => findings.length === 0);
  const codes = Map.groupBy(
    checked.flatMap(({ findings }) => findings),
    ({ source, code }) => `${source}/${code}`,
  );
  const codeLines = [...codes.entries()].toSorted((a, b) => b[1].length - a[1].length).map(([code, findings]) => `| ${code} | ${findings.length} |`);
  const runLines = reports.map((report) => `| ${report.run} | ${runSummary(report)} |`);

  return `# Spike outputs against the new frame

${passing.length} of ${checked.length} checked units pass lint, check, the contract and the token rule in Blueprint.

| Run | Result |
| --- | --- |
${runLines.join("\n")}

| Finding | Count |
| --- | --- |
${codeLines.join("\n")}
`;
}

function runSummary({ storyboardIssues, units }: RunReport): string {
  if (storyboardIssues.length > 0) {
    return `Storyboard doesn't validate today (${storyboardIssues.length} issues, first: ${storyboardIssues[0]}); not checked`;
  }

  const checked = units.filter(({ unit }) => unit !== "(page)");

  return `${checked.filter(({ findings }) => findings.length === 0).length} of ${checked.length} units pass`;
}
