/**
 * Entry of the core utilityProcess: every module runs here. Main forwards each window's
 * MessagePort to this process, and the window talks to the core API over it directly.
 */
import { createCore } from "./composition-root";
import { serveCore } from "./serve";

const APP_VERSION_FLAG = "--app-version=";

const appVersion = process.argv.find((arg) => arg.startsWith(APP_VERSION_FLAG))?.slice(APP_VERSION_FLAG.length);

if (!appVersion) {
  throw new Error(`The core needs ${APP_VERSION_FLAG}<version>`);
}

const { router } = createCore({ appVersion });

process.parentPort.on("message", ({ ports }) => {
  ports.forEach((port) => serveCore(router, port));
});
