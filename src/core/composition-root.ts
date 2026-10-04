import { join } from "node:path";
import deps from "../../deps.json";
import { createCache, DEFAULT_CACHE_CAP_BYTES } from "../modules/cache";
import { createChecker } from "../modules/checker";
import { createClaudeConnector, memoryConnectionStore, type ConnectionStore } from "../modules/claude";
import type { Connector } from "../modules/connector";
import { createCoreRouter } from "../modules/core-api";
import { createGeneration } from "../modules/generation";
import { createMedia } from "../modules/media";
import { createPreviews } from "../modules/preview";
import { createProjects } from "../modules/projects";
import { createSystem, realClock, realDisk, type Clock, type Disk } from "../modules/system";
import { createWhisperCli, createWhisperTranscriber, type WhisperEngine } from "../modules/transcriber";
import { createTranscriptionModel } from "../modules/transcription-model";
import { ModelDepSchema, type ModelDep } from "../shared/deps-manifest";
import { bundledClaudePath } from "./claude-binary";
import { chromeHeadlessShellPath, ffmpegPath, ffprobePath, whisperCliPath, whisperVadModelPath } from "./native";
import { sampleProject } from "./sample-project";

/**
 * The implementations behind swappable boundaries. Tests replace these; nothing else does.
 * The clock is the time boundary (it paces streams) and the disk reports free space;
 * the connector is the agent boundary, Claude in the app and a fake `claude` or a replay
 * of committed outputs in tests; whisper is whisper-cli in the app and a replay of
 * committed raw output in tests.
 */
export type Adapters = {
  clock: Clock;
  disk: Disk;
  connector: Connector;
  whisper: WhisperEngine;
};

export type CoreOptions = {
  appVersion: string;
  /** The app's per-user data folder: the transcription model is downloaded here. */
  appDataDir: string;
  /** Where new Projects go by default: Documents/MotionBrief. Inside app data when absent. */
  projectsDir?: string;
  /** The app's cache of regenerable files. Inside app data when absent. */
  cacheDir?: string;
  cacheCapBytes?: number;
  /** The transcription model to install; deps.json's pin unless a test serves its own. */
  modelPin?: ModelDep;
  /** Where the Claude connection is kept: main's safeStorage in the app, memory when absent. */
  connectionStore?: ConnectionStore;
  adapters?: Partial<Adapters>;
  /** The chrome-headless-shell the frame runs in; the pinned one in vendor/ by default. */
  chromePath?: string;
  /** The source tree's fixtures folder: development builds open the fixture Project from it. */
  sampleDir?: string;
};

/** The cache folder's subfolder of assembled preview pages. */
const PREVIEW_DIR = "preview";

/** The app data subfolder agent sessions get their workspaces in; each is deleted when its session ends. */
const AGENT_DIR = "agent";

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({
  appVersion,
  appDataDir,
  projectsDir = join(appDataDir, "Projects"),
  cacheDir = join(appDataDir, "MotionBrief Cache"),
  cacheCapBytes = DEFAULT_CACHE_CAP_BYTES,
  modelPin = pinnedModel(),
  connectionStore,
  adapters,
  chromePath = chromeHeadlessShellPath(),
  sampleDir,
}: CoreOptions) {
  const clock = adapters?.clock ?? realClock;
  const disk = adapters?.disk ?? realDisk;
  const connector =
    adapters?.connector ??
    createClaudeConnector({ claudePath: bundledClaudePath(), store: connectionStore ?? memoryConnectionStore() });
  const whisper = adapters?.whisper ?? pinnedWhisperCli();
  const system = createSystem({ clock, appVersion, pid: process.pid });
  const checker = createChecker({ chromePath });
  const transcriptionModel = createTranscriptionModel({ appDataDir, pin: modelPin, disk });
  const media = createMedia({ ffmpegPath: ffmpegPath(), ffprobePath: ffprobePath() });
  // Assembled pages are folders that keep themselves to the newest few, so the cache's per-file LRU leaves them alone.
  const cache = createCache({ dir: cacheDir, capBytes: cacheCapBytes, unmanaged: [PREVIEW_DIR] });
  const previews = createPreviews({ rootDir: join(cacheDir, PREVIEW_DIR), chromePath });
  const transcriber = createWhisperTranscriber({ engine: whisper, media, cache, model: transcriptionModel });
  const projects = createProjects({ projectsDir, appDataDir, media, transcriber, clock });
  const generation = createGeneration({ connector, checker, previews, projects, clock, workDir: join(appDataDir, AGENT_DIR) });
  const sample = sampleDir ? sampleProject(sampleDir) : undefined;

  return { router: createCoreRouter({ system, checker, connector, transcriptionModel, previews, sample, projects, cache, generation }) };
}

/** The release's model pin, checked like the scripts check the rest of deps.json. A bad pin is a broken build. */
function pinnedModel() {
  return ModelDepSchema.parse(deps["whisper-model"]);
}

/** The pinned whisper-cli and VAD model in vendor/; their pins name the engine, so a re-pin never reuses old output. */
function pinnedWhisperCli() {
  const version = `${deps["whisper-cli"].version} ${deps["whisper-vad-model"].version}`;

  return createWhisperCli({ cliPath: whisperCliPath(), vadModelPath: whisperVadModelPath(), version });
}
