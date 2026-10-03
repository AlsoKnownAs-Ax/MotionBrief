// Re-pins one native dependency: `pnpm deps:pin <name> <version>` fetches it for every platform,
// computes our own SHA-256 and rewrites its entry in deps.json (ADR 0002).
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AGENT_SDK, CLAUDE_PACKAGES } from "./claude.ts";
import { describeError } from "./errors.ts";
import { download, extract, fetchJson, sha256File, type DownloadError, type ExtractError } from "./files.ts";
import {
  DEP_NAMES,
  isDepName,
  MANIFEST_FILE,
  PLATFORMS,
  readPartialManifest,
  writeManifest,
  type DepName,
  type Manifest,
  type ManifestError,
  type Platform,
  type Result,
} from "./manifest.ts";

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
  | { code: "UNKNOWN_DEPENDENCY"; name: string }
  | { code: "INVALID_VERSION"; name: DepName; version: string; expected: string }
  | { code: "RELEASE_ASSET_MISSING"; release: string; name: DepName; platform: Platform };

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

  const workDir = await mkdtemp(join(tmpdir(), "motionbrief-pin-"));

  try {
    const { data: entry, error: pinError } = await PINNERS[name]({ version, sources, workDir, rootDir, log });

    if (pinError) {
      return { data: null, error: pinError };
    }

    await writeManifest(path, { ...manifest, [name]: entry });

    return { data: null, error: null };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

type PinContext = {
  version: string;
  sources: Sources;
  workDir: string;
  rootDir: string;
  log: (line: string) => void;
};

const PINNERS = {
  "chrome-headless-shell": pinChrome,
  ffmpeg: (context) => pinReleaseAssets("ffmpeg", context),
  "whisper-cli": (context) => pinReleaseAssets("whisper-cli", context),
  claude: pinClaude,
  "whisper-model": pinWhisperModel,
} satisfies { [Name in DepName]: (context: PinContext) => Promise<Result<Manifest[Name], PinError>> };

/** Chrome for Testing's names for our platforms. */
const CHROME_PLATFORMS = { "win-x64": "win64", "mac-arm64": "mac-arm64" } satisfies Record<Platform, string>;

/** `version` is a Chrome for Testing version; pick the one the pinned Puppeteer expects. */
async function pinChrome({ version, sources, workDir, log }: PinContext): Promise<Result<Manifest["chrome-headless-shell"], PinError>> {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    return invalidVersion("chrome-headless-shell", version, "a full Chrome for Testing version, such as 154.0.8037.57");
  }

  const url = (platform: Platform) => {
    const chromePlatform = CHROME_PLATFORMS[platform];

    return `${sources.chromeForTesting}/${version}/${chromePlatform}/chrome-headless-shell-${chromePlatform}.zip`;
  };

  return pinArchives({ version, workDir, log, urls: { "win-x64": url("win-x64"), "mac-arm64": url("mac-arm64") } });
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
  const found = PLATFORMS.map((platform) => {
    const asset = assets.find((candidate) => candidate.name.startsWith(`${name}-`) && candidate.name.endsWith(`-${platform}.zip`));

    return { platform, url: asset?.browser_download_url };
  });
  const missing = found.find(({ url }) => !url);

  if (missing) {
    return { data: null, error: { code: "RELEASE_ASSET_MISSING" as const, release: version, name, platform: missing.platform } };
  }

  const urls = Object.fromEntries(found.map(({ platform, url }) => [platform, url])) as Record<Platform, string>;

  return pinArchives({ version, workDir, log, urls });
}

type PinArchivesOptions = {
  version: string;
  workDir: string;
  log: (line: string) => void;
  urls: Record<Platform, string>;
};

async function pinArchives({ version, workDir, log, urls }: PinArchivesOptions) {
  const platforms: Partial<Record<Platform, { url: string; sha256: string }>> = {};

  for (const platform of PLATFORMS) {
    const url = urls[platform];
    log(`Hashing ${url}`);
    const { data: sha256, error } = await download(url, join(workDir, platform));

    if (error) {
      return { data: null, error };
    }

    platforms[platform] = { url, sha256 };
  }

  return { data: { version, platforms: platforms as Record<Platform, { url: string; sha256: string }> }, error: null };
}

/**
 * `version` is the Agent SDK version. The hashes come from the SDK's per-platform npm packages, and the SDK in
 * package.json moves to the same version, so `pnpm install` installs the binary deps.json pins.
 */
async function pinClaude({ version, sources, workDir, rootDir, log }: PinContext): Promise<Result<Manifest["claude"], PinError>> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return invalidVersion("claude", version, "an exact Agent SDK version, such as 0.3.288");
  }

  const platforms: Partial<Manifest["claude"]["platforms"]> = {};

  for (const platform of PLATFORMS) {
    const { package: packageName, binary } = CLAUDE_PACKAGES[platform];
    const { data: sha256, error } = await hashPackageFile({ packageName, file: binary, version, sources, workDir, log });

    if (error) {
      return { data: null, error };
    }

    platforms[platform] = { package: packageName, binary, sha256 };
  }

  await setAgentSdkVersion(rootDir, version);

  return { data: { version, platforms: platforms as Manifest["claude"]["platforms"] }, error: null };
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
  await mkdir(unpacked);
  // npm tarballs hold the package under package/.
  const { error: extractError } = await extract(tarball, unpacked, [`package/${file}`]);

  if (extractError) {
    return { data: null, error: extractError };
  }

  return { data: await sha256File(join(unpacked, "package", file)), error: null };
}

async function setAgentSdkVersion(rootDir: string, version: string) {
  const path = join(rootDir, "package.json");
  const packageJson = JSON.parse(await readFile(path, "utf8")) as { dependencies: Record<string, string> };
  packageJson.dependencies[AGENT_SDK] = version;
  await writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`);
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

  return { data: { version, url, sha256, size: (await stat(file)).size }, error: null };
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
