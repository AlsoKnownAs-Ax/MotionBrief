import deps from "../../deps.json";
import { createCoreRouter } from "../modules/core-api";
import { createSystem, realClock, realDisk, type Clock, type Disk } from "../modules/system";
import { createTranscriptionModel } from "../modules/transcription-model";
import { ModelDepSchema, type ModelDep } from "../shared/deps-manifest";

/**
 * The implementations behind swappable boundaries. Tests replace these; nothing else does.
 * The clock is the time boundary (it paces streams) and the disk reports free space;
 * the Connector and Transcriber join them here.
 */
export type Adapters = {
  clock: Clock;
  disk: Disk;
};

export type CoreOptions = {
  appVersion: string;
  /** The app's per-user data folder: the transcription model is downloaded here. */
  appDataDir: string;
  /** The transcription model to install; deps.json's pin unless a test serves its own. */
  modelPin?: ModelDep;
  adapters?: Partial<Adapters>;
};

const DEFAULT_ADAPTERS: Adapters = {
  clock: realClock,
  disk: realDisk,
};

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({ appVersion, appDataDir, modelPin = pinnedModel(), adapters }: CoreOptions) {
  const { clock, disk } = { ...DEFAULT_ADAPTERS, ...adapters };
  const system = createSystem({ clock, appVersion, pid: process.pid });
  const transcriptionModel = createTranscriptionModel({ appDataDir, pin: modelPin, disk });

  return { router: createCoreRouter({ system, transcriptionModel }) };
}

/** The release's model pin, checked like the scripts check the rest of deps.json. A bad pin is a broken build. */
function pinnedModel() {
  return ModelDepSchema.parse(deps["whisper-model"]);
}
