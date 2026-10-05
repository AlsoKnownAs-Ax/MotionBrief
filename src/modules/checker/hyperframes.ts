import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { CheckFinding } from "../../contract";
import type { Unit } from "../assembler";

const require = createRequire(import.meta.url);

const CLI = join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");

/** Layout samples across the video; the spike's value. */
const SAMPLES = 15;

const FindingSchema = z.looseObject({
  code: z.string(),
  severity: z.string(),
  message: z.string(),
  selector: z.string().optional(),
  sourceFile: z.string().optional(),
  time: z.number().optional(),
  fixHint: z.string().optional(),
});

const SectionSchema = z.looseObject({ findings: z.array(FindingSchema) });

const CheckOutputSchema = z.looseObject({
  lint: SectionSchema,
  runtime: SectionSchema,
  layout: SectionSchema,
  motion: SectionSchema,
});

type HyperframesFinding = z.infer<typeof FindingSchema>;

export type HyperframesError = { code: "HYPERFRAMES_FAILED"; output: string };

type RunOptions = { dir: string; chromePath: string; units: Unit[] };

/**
 * Runs `hyperframes check`, which lints the page and then plays it in the pinned
 * chrome-headless-shell for runtime, layout and motion problems. Telemetry and update checks are
 * off. Each error maps to its unit through the file it was found in.
 */
export async function runHyperframesCheck({ dir, chromePath, units }: RunOptions) {
  const { stdout, stderr } = await run(
    [CLI, "check", dir, "--json", "--no-contrast", "--no-browser-gpu", "--samples", String(SAMPLES)],
    chromePath,
  );
  const json = parseJson(stdout);
  const { success, data } = CheckOutputSchema.safeParse(json);

  if (!success) {
    return { data: null, error: { code: "HYPERFRAMES_FAILED", output: `${stdout}\n${stderr}`.trim().slice(-4000) } satisfies HyperframesError };
  }

  const sections = [
    { source: "lint" as const, findings: data.lint.findings },
    ...[data.runtime, data.layout, data.motion].map(({ findings }) => ({ source: "check" as const, findings })),
  ];
  const findings: CheckFinding[] = sections.flatMap(({ source, findings: sectionFindings }) =>
    sectionFindings
      .filter((finding) => finding.severity === "error")
      .map((finding) => ({
        unit: unitOf(finding, units),
        source,
        code: finding.code,
        message: [finding.message, finding.fixHint].filter(Boolean).join(" "),
        selector: finding.selector,
        time: finding.time,
      })),
  );

  return { data: findings, error: null };
}

function run(args: string[], chromePath: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        // In the Electron core process, execPath is Electron: run it as Node.
        ELECTRON_RUN_AS_NODE: "1",
        HYPERFRAMES_BROWSER_PATH: chromePath,
        HYPERFRAMES_NO_TELEMETRY: "1",
        DO_NOT_TRACK: "1",
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
        HYPERFRAMES_NO_AUTO_INSTALL: "1",
        HYPERFRAMES_SKIP_SKILLS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resolve({ stdout: "", stderr: error.message }));
    child.on("close", () => resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}

/** The CLI's JSON report; anything it logs around it is ignored. */
function parseJson(output: string): unknown {
  try {
    return JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
}

/**
 * The unit a finding belongs to: by the composition file it was found in, by the composition a
 * script error names, or by the Scene in its element's DOM id. `undefined` when it is the page's.
 */
function unitOf(finding: HyperframesFinding, units: Unit[]): string | undefined {
  const file = /compositions[\\/]([^\\/]+)\.html$/.exec(finding.sourceFile ?? "")?.[1];
  const scriptError = /composition script error: (\S+)/.exec(finding.message)?.[1];
  const sceneId = /#([A-Za-z][A-Za-z0-9_]*)-/.exec(finding.selector ?? "")?.[1];
  const byScene = units.find((unit) => unit.scenes.some((scene) => scene.id === sceneId))?.id;

  return [file, scriptError, byScene].find((id) => units.some((unit) => unit.id === id));
}
