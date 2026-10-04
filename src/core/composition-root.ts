import deps from "../../deps.json";
import { createChecker } from "../modules/checker";
import { createClaudeConnector, memoryConnectionStore, type ConnectionStore } from "../modules/claude";
import type { Connector } from "../modules/connector";
import { createCoreRouter } from "../modules/core-api";
import { createSystem, realClock, realDisk, type Clock, type Disk } from "../modules/system";
import { createTranscriptionModel } from "../modules/transcription-model";
import { ModelDepSchema, type ModelDep } from "../shared/deps-manifest";
import { bundledClaudePath } from "./claude-binary";
import { chromeHeadlessShellPath } from "./native";

/**
 * The implementations behind swappable boundaries. Tests replace these; nothing else does.
 * The clock is the time boundary (it paces streams) and the disk reports free space;
 * the connector is the agent boundary, Claude in the app and a fake `claude` or a replay
 * of committed outputs in tests.
 */
export type Adapters = {
  clock: Clock;
  disk: Disk;
  connector: Connector;
};

export type CoreOptions = {
  appVersion: string;
  /** The app's per-user data folder: the transcription model is downloaded here. */
  appDataDir: string;
  /** The transcription model to install; deps.json's pin unless a test serves its own. */
  modelPin?: ModelDep;
  /** Where the Claude connection is kept: main's safeStorage in the app, memory when absent. */
  connectionStore?: ConnectionStore;
  adapters?: Partial<Adapters>;
  /** The chrome-headless-shell the frame runs in; the pinned one in vendor/ by default. */
  chromePath?: string;
};

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({
  appVersion,
  appDataDir,
  modelPin = pinnedModel(),
  connectionStore,
  adapters,
  chromePath = chromeHeadlessShellPath(),
}: CoreOptions) {
  const clock = adapters?.clock ?? realClock;
  const disk = adapters?.disk ?? realDisk;
  const connector =
    adapters?.connector ??
    createClaudeConnector({ claudePath: bundledClaudePath(), store: connectionStore ?? memoryConnectionStore() });
  const system = createSystem({ clock, appVersion, pid: process.pid });
  const checker = createChecker({ chromePath });
  const transcriptionModel = createTranscriptionModel({ appDataDir, pin: modelPin, disk });

  return { router: createCoreRouter({ system, checker, connector, transcriptionModel }) };
}

/** The release's model pin, checked like the scripts check the rest of deps.json. A bad pin is a broken build. */
function pinnedModel() {
  return ModelDepSchema.parse(deps["whisper-model"]);
}
