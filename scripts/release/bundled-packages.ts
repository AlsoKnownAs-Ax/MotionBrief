// A Vite plugin for electron.vite.config.ts: records which npm packages each build bundled into out/, so the
// third-party notices (licenses.ts) cover them as well as the production dependencies shipped in node_modules.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** Where each build writes its list; electron-builder.yml leaves it out of the app. */
export const BUNDLED_PACKAGES_DIR = join("out", ".bundled-packages");

/** The folder of the npm package a module belongs to, or undefined for the app's own modules. */
export function packageDirOf(moduleId: string) {
  // Greedy: a package's own node_modules can hold another package.
  const match = /^\0?(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/?]+)/.exec(moduleId);

  return match?.[1];
}

export function bundledPackages(build: string): Plugin {
  const dirs = new Set<string>();

  return {
    name: "motionbrief:bundled-packages",
    apply: "build",
    generateBundle() {
      for (const id of this.getModuleIds()) {
        // An external module isn't bundled: it ships in node_modules.
        if (this.getModuleInfo(id)?.isExternal) {
          continue;
        }

        const dir = packageDirOf(id);

        if (dir) {
          dirs.add(dir);
        }
      }
    },
    writeBundle() {
      mkdirSync(BUNDLED_PACKAGES_DIR, { recursive: true });
      writeFileSync(join(BUNDLED_PACKAGES_DIR, `${build}.json`), JSON.stringify([...dirs].sort(), null, 2));
    },
  };
}
