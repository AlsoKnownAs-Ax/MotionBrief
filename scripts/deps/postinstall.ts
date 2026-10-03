// The package's postinstall, and `pnpm deps:fetch`: fetches the native binaries deps.json pins for this platform into
// vendor/, refusing any hash mismatch, and checks the Claude Code binary pnpm installed (ADR 0002).
// MOTIONBRIEF_SKIP_DEPS=1 skips it.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkClaude, type ClaudeError } from "./claude.ts";
import { describeError } from "./errors.ts";
import { download, extract, fileStep, type DownloadError, type ExtractError } from "./files.ts";
import { ARCHIVE_NAMES, MANIFEST_FILE, readManifest, type ArchiveName, type Manifest, type ManifestError } from "./manifest.ts";
import { platformOf, type Platform } from "./platforms.ts";
import type { Result } from "./result.ts";

export type PostinstallOptions = {
  rootDir: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  arch: string;
  log: (line: string) => void;
};

export type PostinstallError =
  | ManifestError
  | DownloadError
  | ExtractError
  | ClaudeError
  | { code: "HASH_MISMATCH"; name: ArchiveName; url: string; expected: string; actual: string };

export async function runPostinstall({ rootDir, env, platform, arch, log }: PostinstallOptions): Promise<Result<null, PostinstallError>> {
  if (env.MOTIONBRIEF_SKIP_DEPS === "1") {
    log("MOTIONBRIEF_SKIP_DEPS=1: not fetching native dependencies.");

    return { data: null, error: null };
  }

  const target = platformOf(platform, arch);

  if (!target) {
    log(`No native dependencies for ${platform}-${arch}: MotionBrief ships for Windows x64 and macOS arm64.`);

    return { data: null, error: null };
  }

  const { data: manifest, error } = await readManifest(join(rootDir, MANIFEST_FILE));

  if (error) {
    return { data: null, error };
  }

  for (const name of ARCHIVE_NAMES) {
    const { error: archiveError } = await installArchive({ manifest, name, platform: target, rootDir, log });

    if (archiveError) {
      return { data: null, error: archiveError };
    }
  }

  return checkClaude({ dep: manifest.claude, platform: target, rootDir });
}

type InstallArchiveOptions = {
  manifest: Manifest;
  name: ArchiveName;
  platform: Platform;
  rootDir: string;
  log: (line: string) => void;
};

/** Downloads and unpacks into a staging folder, so vendor/<name> only ever holds a verified archive. */
async function installArchive({ manifest, name, platform, rootDir, log }: InstallArchiveOptions): Promise<Result<null, PostinstallError>> {
  const { url, sha256 } = manifest[name].platforms[platform];
  const vendorDir = join(rootDir, "vendor");
  // Written after vendor/<name> is in place, so it only ever names a complete, verified install.
  const pinFile = join(vendorDir, `${name}.sha256`);

  if ((await readPin(pinFile)) === sha256) {
    return { data: null, error: null };
  }

  const staging = join(vendorDir, `.${name}`);
  const { error: stagingError } = await fileStep(staging, async () => {
    await rm(staging, { recursive: true, force: true });
    await mkdir(join(staging, "unpacked"), { recursive: true });
  });

  if (stagingError) {
    return { data: null, error: stagingError };
  }

  log(`Fetching ${name} ${manifest[name].version}`);
  const { error } = await unpackVerified({ name, url, sha256, staging });

  if (error) {
    // Best effort: the next run clears a staging folder left behind.
    await fileStep(staging, () => rm(staging, { recursive: true, force: true }));

    return { data: null, error };
  }

  const dest = join(vendorDir, name);
  const { error: swapError } = await fileStep(dest, async () => {
    await rm(pinFile, { force: true });
    await rm(dest, { recursive: true, force: true });
    await rename(join(staging, "unpacked"), dest);
    await rm(staging, { recursive: true, force: true });
    await writeFile(pinFile, `${sha256}\n`);
  });

  if (swapError) {
    return { data: null, error: swapError };
  }

  return { data: null, error: null };
}

type UnpackVerifiedOptions = { name: ArchiveName; url: string; sha256: string; staging: string };

async function unpackVerified({ name, url, sha256, staging }: UnpackVerifiedOptions): Promise<Result<null, PostinstallError>> {
  const archive = join(staging, "archive");
  const { data: actual, error } = await download(url, archive);

  if (error) {
    return { data: null, error };
  }

  if (actual !== sha256) {
    return { data: null, error: { code: "HASH_MISMATCH", name, url, expected: sha256, actual } };
  }

  return extract(archive, join(staging, "unpacked"));
}

/** The archive hash vendor/<name> was installed from; `undefined` when nothing is installed. */
async function readPin(pinFile: string) {
  const { data: pin } = await fileStep(pinFile, () => readFile(pinFile, "utf8"));

  return pin?.trim();
}

if (import.meta.main) {
  const { error } = await runPostinstall({
    rootDir: join(import.meta.dirname, "../.."),
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    log: (line) => console.log(line),
  });

  if (error) {
    // pnpm install doesn't run postinstall again while the lockfile is satisfied, so say how to retry.
    console.error(`Native dependencies: ${describeError(error)}\nOnce fixed, run pnpm deps:fetch.`);
    process.exit(1);
  }
}
