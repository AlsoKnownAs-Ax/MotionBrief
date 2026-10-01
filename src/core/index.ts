/**
 * Entry of the core utilityProcess: every module runs here. Main forwards each window's
 * MessagePort to this process, and the window talks to the core API over it directly.
 */
import { CORE_APP_VERSION_FLAG } from "../shared/ipc";
import { createCore } from "./composition-root";
import { serveCore } from "./serve";

const appVersion = process.argv
  .find((arg) => arg.startsWith(CORE_APP_VERSION_FLAG))
  ?.slice(CORE_APP_VERSION_FLAG.length);

if (!appVersion) {
  throw new Error(`The core needs ${CORE_APP_VERSION_FLAG}<version>`);
}

const { router } = createCore({ appVersion });

process.parentPort.on("message", ({ ports }) => {
  ports.forEach((port) => serveCore(router, port));
});
