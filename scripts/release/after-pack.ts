// electron-builder's afterPack hook (electron-builder.yml): puts Electron's Chromium license texts in the app's
// resources/licenses, next to what licenses.ts wrote. Electron's archive keeps them beside the app, where the
// macOS DMG would leave them out. Runs before signing, so the copy is signed with the rest.
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "electron-builder";

// electron-builder 26.15's own AfterPackContext export points at a declaration file it doesn't ship.
type AfterPackContext = Parameters<Extract<Configuration["afterPack"], (context: never) => unknown>>[0];

const CHROMIUM_LICENSES = "LICENSES.chromium.html";

export default async function afterPack({ appOutDir, electronPlatformName, packager }: AfterPackContext) {
  const resourcesDir =
    electronPlatformName === "darwin" ? join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources") : join(appOutDir, "resources");

  await copyFile(join(appOutDir, CHROMIUM_LICENSES), join(resourcesDir, "licenses", CHROMIUM_LICENSES));
}
