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
  CORE_SHUTDOWN_MESSAGE,
} from "../shared/ipc";
import { createCore } from "./composition-root";
import { parentPortConnectionStore } from "./connection-store";
import { serveCore } from "./serve";
import { parentPortTrash } from "./trash";

const core = createCore({
  appVersion: flagValue(CORE_APP_VERSION_FLAG),
  appDataDir: flagValue(CORE_APP_DATA_FLAG),
  projectsDir: flagValue(CORE_PROJECTS_DIR_FLAG),
  cacheDir: flagValue(CORE_CACHE_DIR_FLAG),
  connectionStore: parentPortConnectionStore(process.parentPort),
  trash: parentPortTrash(process.parentPort),
  sampleDir: optionalFlagValue(CORE_SAMPLE_FLAG),
});

process.parentPort.on("message", ({ data, ports }) => {
  if (data === CORE_SHUTDOWN_MESSAGE) {
    void core.shutdown().finally(() => process.exit(0));
    return;
  }

  ports.forEach((port) => serveCore(core, port));
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
