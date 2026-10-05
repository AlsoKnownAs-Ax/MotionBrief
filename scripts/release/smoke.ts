// `pnpm package:smoke`: runs the app electron-builder just packed in dist/ against the core's fixtures, proving it
// reads its files from app.asar and runs every executable it ships from app.asar.unpacked. The release workflow runs
// it before uploading anything. Never calls Claude: it only asks the bundled binary for its version.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Where electron-builder leaves the unpacked app it built the installers from. */
const PACKED = {
  win32: { executable: join("win-unpacked", "MotionBrief.exe"), resources: join("win-unpacked", "resources") },
  darwin: {
    executable: join("mac-arm64", "MotionBrief.app", "Contents", "MacOS", "MotionBrief"),
    resources: join("mac-arm64", "MotionBrief.app", "Contents", "Resources"),
  },
} satisfies Partial<Record<NodeJS.Platform, { executable: string; resources: string }>>;

const packed = PACKED[process.platform as keyof typeof PACKED];

if (!packed) {
  console.error(`Nothing to smoke-test on ${process.platform}: MotionBrief ships for Windows and macOS.`);
  process.exit(1);
}

const distDir = join(ROOT, "dist");
const workDir = await mkdtemp(join(tmpdir(), "motionbrief-smoke-"));
const flags = [
  "--app-version=smoke",
  `--app-data=${join(workDir, "app-data")}`,
  `--projects-dir=${join(workDir, "Projects")}`,
  `--cache-dir=${join(workDir, "cache")}`,
  `--sample-project=${join(ROOT, "src", "core", "fixtures")}`,
];
const result = spawnSync(
  join(distDir, packed.executable),
  [join(import.meta.dirname, "smoke-driver.mjs"), join(distDir, packed.resources), join(ROOT, "src", "core", "fixtures"), workDir, ...flags],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 600_000 },
);

await rm(workDir, { recursive: true, force: true, maxRetries: 5 });

if (result.status !== 0) {
  console.error(`The packaged app failed its smoke test (${result.status ?? result.signal ?? result.error}).`);
  process.exit(1);
}
