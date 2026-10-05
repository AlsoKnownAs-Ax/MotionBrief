// electron-builder's afterExtract hook (electron-builder.yml): Electron's archive carries Chromium's license
// texts beside the app, and electron-builder deletes them on macOS (electronMac.js) before afterPack. This runs
// first and copies them into out/licenses, which extraResources then ships as the app's resources/licenses.
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "electron-builder";

// electron-builder 26.15's own AfterExtractContext export points at a declaration file it doesn't ship.
type AfterExtractContext = Parameters<Extract<Configuration["afterExtract"], (context: never) => unknown>>[0];

const CHROMIUM_LICENSES = "LICENSES.chromium.html";

export default async function afterExtract({ appOutDir }: AfterExtractContext) {
  await copyFile(join(appOutDir, CHROMIUM_LICENSES), join(import.meta.dirname, "../..", "out", "licenses", CHROMIUM_LICENSES));
}
