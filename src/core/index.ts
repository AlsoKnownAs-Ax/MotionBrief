/**
 * Entry of the core utilityProcess: every module runs here. Main forwards each window's
 * MessagePort to this process, and the window talks to the core API over it directly.
 */
import {
  CORE_APP_DATA_FLAG,
  CORE_APP_VERSION_FLAG,
  CORE_CACHE_DIR_FLAG,
  CORE_PROJECTS_DIR_FLAG,
  CORE_SAMPLE_FLAG,
  EXPORTS_CHANNEL,
  type ExportsMessage,
} from "../shared/ipc";
import { createCore } from "./composition-root";
import { parentPortConnectionStore } from "./connection-store";
import { serveCore } from "./serve";

const { router } = createCore({
  appVersion: flagValue(CORE_APP_VERSION_FLAG),
  appDataDir: flagValue(CORE_APP_DATA_FLAG),
  projectsDir: flagValue(CORE_PROJECTS_DIR_FLAG),
  cacheDir: flagValue(CORE_CACHE_DIR_FLAG),
  connectionStore: parentPortConnectionStore(process.parentPort),
  sampleDir: optionalFlagValue(CORE_SAMPLE_FLAG),
  onExportsChange: (running) => process.parentPort.postMessage({ channel: EXPORTS_CHANNEL, running } satisfies ExportsMessage),
});

process.parentPort.on("message", ({ ports }) => {
  ports.forEach((port) => serveCore(router, port));
});

function optionalFlagValue(flag: string) {
  return process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
}

function flagValue(flag: string) {
  const value = optionalFlagValue(flag);

  if (!value) {
    throw new Error(`The core needs ${flag}<value>`);
  }

  return value;
}
