// Re-pins one native dependency: `pnpm deps:pin <name> <version>` fetches it for every platform,
// computes our own SHA-256 and rewrites its entry in deps.json (ADR 0002).
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describeError } from "./errors.ts";
import {
  download,
  extract,
  fetchJson,
  fileStep,
  readJsonFile,
  sha256File,
  type DownloadError,
  type ExtractError,
  type FileError,
} from "./files.ts";
import {
  DEP_NAMES,
  isDepName,
  MANIFEST_FILE,
  readPartialManifest,
  writeManifest,
  type DepName,
  type Manifest,
  type ManifestError,
  type PartialManifest,
} from "./manifest.ts";
import { AGENT_SDK, perPlatform, PLATFORMS, type Platform } from "./platforms.ts";
import type { Result } from "./result.ts";

/** Where each upstream lives; tests point them at a local server. */
export type Sources = {
  chromeForTesting: string;
  githubApi: string;
  huggingFace: string;
  npm: string;
};

const UPSTREAM: Sources = {
  chromeForTesting: "https://storage.googleapis.com/chrome-for-testing-public",
  githubApi: "https://api.github.com",
  huggingFace: "https://huggingface.co",
  npm: "https://registry.npmjs.org",
};

export type PinError =
  | ManifestError
  | DownloadError
  | ExtractError
  | FileError
  | { code: "UNKNOWN_DEPENDENCY"; name: string }
  | { code: "INVALID_VERSION"; name: DepName; version: string; expected: string }
  | { code: "RELEASE_ASSET_MISSING"; release: string; name: DepName; platform: Platform }
  | { code: "PACKAGE_JSON_INVALID"; path: string; issues: z.core.$ZodIssue[] };

export type PinOptions = {
  rootDir: string;
  name: string;
  version: string;
  sources?: Sources;
  log: (line: string) => void;
};

export async function pin({ rootDir, name, version, sources = UPSTREAM, log }: PinOptions): Promise<Result<null, PinError>> {
  if (!isDepName(name)) {
    return { data: null, error: { code: "UNKNOWN_DEPENDENCY", name } };
  }

  const path = join(rootDir, MANIFEST_FILE);
  const { data: manifest, error } = await readPartialManifest(path);

  if (error) {
    return { data: null, error };
  }

  const { data: workDir, error: workDirError } = await fileStep(tmpdir(), () => mkdtemp(join(tmpdir(), "motionbrief-pin-")));

  if (workDirError) {
    return { data: null, error: workDirError };
  }

  const pinned = await pinInto({ path, manifest, name, context: { version, sources, workDir, rootDir, log } });
  // Best effort: the OS clears its temp folder in the end.
  await fileStep(workDir, () => rm(workDir, { recursive: true, force: true }));

  return pinned;
}

type PinContext = {
  version: string;
  sources: Sources;
  workDir: string;
  rootDir: string;
  log: (line: string) => void;
};

type PinIntoOptions = { path: string; manifest: PartialManifest; name: DepName; context: PinContext };

async function pinInto({ path, manifest, name, context }: PinIntoOptions): Promise<Result<null, PinError>> {
  const { data: entry, error } = await PINNERS[name](context);

  if (error) {
    return { data: null, error };
  }

  const { error: writeError } = await writeManifest(path, { ...manifest, [name]: entry });

  if (writeError) {
    return { data: null, error: writeError };
  }

  return { data: null, error: null };
}

const PINNERS = {
  "chrome-headless-shell": pinChrome,
  ffmpeg: (context) => pinReleaseAssets("ffmpeg", context),
  "whisper-cli": (context) => pinReleaseAssets("whisper-cli", context),
  claude: pinClaude,
  "whisper-model": pinWhisperModel,
} satisfies { [Name in DepName]: (context: PinContext) => Promise<Result<Manifest[Name], PinError>> };

/** `version` is a Chrome for Testing version; pick the one the pinned Puppeteer expects. */
async function pinChrome({ version, sources, workDir, log }: PinContext): Promise<Result<Manifest["chrome-headless-shell"], PinError>> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    return invalidVersion("chrome-headless-shell", version, "a full Chrome for Testing version, such as 154.0.8037.57");
  }

  const urlFor = (platform: Platform) => {
    const { chromeForTesting } = PLATFORMS[platform];

    return `${sources.chromeForTesting}/${version}/${chromeForTesting}/chrome-headless-shell-${chromeForTesting}.zip`;
  };

  return pinArchives({ version, workDir, log, urlFor });
}

/** The repo whose native-deps releases hold our FFmpeg and whisper-cli builds. */
const NATIVE_DEPS_REPO = "AlsoKnownAs-Ax/MotionBrief";

const ReleaseSchema = z.object({ assets: z.array(z.object({ name: z.string(), browser_download_url: z.url() })) });

/** `version` is a native-deps release tag; its assets are named `<name>-<upstream version>-<platform>.zip`. */
async function pinReleaseAssets(name: "ffmpeg" | "whisper-cli", { version, sources, workDir, log }: PinContext) {
  if (!/^native-deps-[0-9A-Za-z._-]+$/.test(version)) {
    return invalidVersion(name, version, "a native-deps release tag, such as native-deps-1");
  }

  const { data: json, error } = await fetchJson(`${sources.githubApi}/repos/${NATIVE_DEPS_REPO}/releases/tags/${version}`);

  if (error) {
    return { data: null, error };
  }

  const assets = ReleaseSchema.safeParse(json).data?.assets ?? [];
  // Every platform's asset is looked up before anything is downloaded.
  const { data: urls, error: assetError } = await perPlatform(async (platform): Promise<Result<string, PinError>> => {
    const asset = assets.find((candidate) => candidate.name.startsWith(`${name}-`) && candidate.name.endsWith(`-${platform}.zip`));

    if (!asset) {
      return { data: null, error: { code: "RELEASE_ASSET_MISSING", release: version, name, platform } };
    }

    return { data: asset.browser_download_url, error: null };
  });

  if (assetError) {
    return { data: null, error: assetError };
  }

  return pinArchives({ version, workDir, log, urlFor: (platform) => urls[platform] });
}

type PinArchivesOptions = {
  version: string;
  workDir: string;
  log: (line: string) => void;
  urlFor: (platform: Platform) => string;
};

type Archive = { url: string; sha256: string };

async function pinArchives({ version, workDir, log, urlFor }: PinArchivesOptions) {
  const { data: platforms, error } = await perPlatform(async (platform): Promise<Result<Archive, PinError>> => {
    const url = urlFor(platform);
    log(`Hashing ${url}`);
    const { data: sha256, error: downloadError } = await download(url, join(workDir, platform));

    if (downloadError) {
      return { data: null, error: downloadError };
    }

    return { data: { url, sha256 }, error: null };
  });

  if (error) {
    return { data: null, error };
  }

  return { data: { version, platforms }, error: null };
}

type ClaudeBinary = Manifest["claude"]["platforms"][Platform];

/**
 * `version` is the Agent SDK version. The hashes come from the SDK's per-platform npm packages, and the SDK in
 * package.json moves to the same version, so `pnpm install` installs the binary deps.json pins.
 */
async function pinClaude({ version, sources, workDir, rootDir, log }: PinContext): Promise<Result<Manifest["claude"], PinError>> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return invalidVersion("claude", version, "an exact Agent SDK version, such as 0.3.288");
  }

  const { data: platforms, error } = await perPlatform(async (platform): Promise<Result<ClaudeBinary, PinError>> => {
    const { package: packageName, binary } = PLATFORMS[platform].claude;
    const { data: sha256, error: hashError } = await hashPackageFile({ packageName, file: binary, version, sources, workDir, log });

    if (hashError) {
      return { data: null, error: hashError };
    }

    return { data: { package: packageName, binary, sha256 }, error: null };
  });

  if (error) {
    return { data: null, error };
  }

  const { error: sdkError } = await setAgentSdkVersion(rootDir, version);

  if (sdkError) {
    return { data: null, error: sdkError };
  }

  return { data: { version, platforms }, error: null };
}

type HashPackageFileOptions = {
  packageName: string;
  file: string;
  version: string;
  sources: Sources;
  workDir: string;
  log: (line: string) => void;
};

/** Downloads an npm package's tarball and hashes one file in it. */
async function hashPackageFile({ packageName, file, version, sources, workDir, log }: HashPackageFileOptions): Promise<Result<string, PinError>> {
  const unscoped = packageName.split("/").at(-1) ?? packageName;
  const url = `${sources.npm}/${packageName}/-/${unscoped}-${version}.tgz`;
  const tarball = join(workDir, `${unscoped}.tgz`);
  log(`Hashing ${file} in ${url}`);
  const { error } = await download(url, tarball);

  if (error) {
    return { data: null, error };
  }

  const unpacked = join(workDir, unscoped);
  const { error: mkdirError } = await fileStep(unpacked, () => mkdir(unpacked));

  if (mkdirError) {
    return { data: null, error: mkdirError };
  }

  // npm tarballs hold the package under package/.
  const { error: extractError } = await extract(tarball, unpacked, [`package/${file}`]);

  if (extractError) {
    return { data: null, error: extractError };
  }

  const path = join(unpacked, "package", file);

  return fileStep(path, () => sha256File(path));
}

/** Kept as a record, which keeps package.json's key order on rewrite. */
const PackageJsonSchema = z.record(z.string(), z.unknown());

const DependenciesSchema = z.record(z.string(), z.string());

async function setAgentSdkVersion(rootDir: string, version: string): Promise<Result<void, PinError>> {
  const path = join(rootDir, "package.json");
  const { data: json, error } = await readJsonFile(path);

  if (error) {
    return { data: null, error };
  }

  const { success, data: packageJson, error: parseError } = PackageJsonSchema.safeParse(json);

  if (!success) {
    return { data: null, error: { code: "PACKAGE_JSON_INVALID", path, issues: parseError.issues } };
  }

  const deps = DependenciesSchema.safeParse(packageJson.dependencies);

  if (!deps.success) {
    return { data: null, error: { code: "PACKAGE_JSON_INVALID", path, issues: deps.error.issues } };
  }

  const updated = { ...packageJson, dependencies: { ...deps.data, [AGENT_SDK]: version } };

  return fileStep(path, () => writeFile(path, `${JSON.stringify(updated, null, 2)}\n`));
}

const WHISPER_MODEL = { repo: "ggerganov/whisper.cpp", file: "ggml-large-v3-turbo-q5_0.bin" };

/** `version` is a full commit of the Hugging Face repo, so the URL can't move. */
async function pinWhisperModel({ version, sources, workDir, log }: PinContext): Promise<Result<Manifest["whisper-model"], PinError>> {
  if (!/^[0-9a-f]{40}$/.test(version)) {
    return invalidVersion("whisper-model", version, `a full Hugging Face commit of ${WHISPER_MODEL.repo}`);
  }

  const url = `${sources.huggingFace}/${WHISPER_MODEL.repo}/resolve/${version}/${WHISPER_MODEL.file}`;
  const file = join(workDir, WHISPER_MODEL.file);
  log(`Hashing ${url}`);
  const { data: sha256, error } = await download(url, file);

  if (error) {
    return { data: null, error };
  }

  const { data: stats, error: statError } = await fileStep(file, () => stat(file));

  if (statError) {
    return { data: null, error: statError };
  }

  return { data: { version, url, sha256, size: stats.size }, error: null };
}

function invalidVersion(name: DepName, version: string, expected: string) {
  return { data: null, error: { code: "INVALID_VERSION" as const, name, version, expected } };
}

if (import.meta.main) {
  const [name, version] = process.argv.slice(2);

  if (!name || !version) {
    console.error(`Usage: pnpm deps:pin <${DEP_NAMES.join("|")}> <version>`);
    process.exit(1);
  }

  const { error } = await pin({ rootDir: join(import.meta.dirname, "../.."), name, version, log: (line) => console.log(line) });

  if (error) {
    console.error(describeError(error));
    process.exit(1);
  }

  console.log(`Pinned ${name} ${version} in ${MANIFEST_FILE}.`);

  if (name === "claude") {
    console.log(`Also pinned ${AGENT_SDK} ${version} in package.json: run pnpm install to update the lockfile.`);
  }
}
