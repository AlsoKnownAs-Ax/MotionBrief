/**
 * Entry of the core utilityProcess: every module runs here. Main forwards each window's
 * MessagePort to this process, and the window talks to the core API over it directly.
 */
import { CORE_APP_DATA_FLAG, CORE_APP_VERSION_FLAG } from "../shared/ipc";
import { createCore } from "./composition-root";
import { serveCore } from "./serve";

const appVersion = flagValue(CORE_APP_VERSION_FLAG);
const appDataDir = flagValue(CORE_APP_DATA_FLAG);

const { router } = createCore({ appVersion, appDataDir });

process.parentPort.on("message", ({ ports }) => {
  ports.forEach((port) => serveCore(router, port));
});

function flagValue(flag: string) {
  const value = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);

  if (!value) {
    throw new Error(`The core needs ${flag}<value>`);
  }

  return value;
}
