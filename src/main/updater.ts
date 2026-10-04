import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import { z } from "zod";
import type { UpdateChannel, UpdateState } from "../shared/ipc";
import { createUpdates, type ChannelStore, type ExportsHold, type UpdateBackend } from "./updates";

// electron-updater is CommonJS; its named exports aren't visible to an ES module.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const SettingsSchema = z.object({ channel: z.enum(["stable", "beta"]) });

type UpdaterOptions = {
  exports: ExportsHold;
  /** The state changed: a new channel, a downloaded update, or an export starting or ending. */
  onChange: (state: UpdateState) => void;
};

/**
 * App updates from GitHub Releases (electron-builder.yml's publish), downloaded as blockmap differences from
 * the installed version. Development builds never update. The logic is in updates.ts.
 */
export async function startUpdater({ exports, onChange }: UpdaterOptions) {
  const updates = await createUpdates({
    backend: electronBackend(),
    isEnabled: app.isPackaged,
    currentVersion: app.getVersion(),
    store: fileChannelStore(join(app.getPath("userData"), "updates.json")),
    exports,
    onChange,
  });
  setInterval(() => updates.check(), CHECK_INTERVAL_MS).unref();

  return updates;
}

function electronBackend(): UpdateBackend {
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (error) => console.error("[updater]", error));

  return {
    /**
     * Stable takes GitHub's latest release. Beta takes the newest release, pre-release or not: beta.yml from a
     * beta, latest.yml from a stable one.
     */
    configure: ({ channel, allowPrerelease }) => {
      autoUpdater.channel = channel;
      autoUpdater.allowPrerelease = allowPrerelease;
      // Setting the channel allows downgrades; leaving beta must not install an older stable over a newer beta.
      autoUpdater.allowDowngrade = false;
    },
    check: () => autoUpdater.checkForUpdates(),
    onDownloaded: (listener) => autoUpdater.on("update-downloaded", ({ version }) => listener(version)),
    setInstallOnQuit: (install) => {
      autoUpdater.autoInstallOnAppQuit = install;
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}

function fileChannelStore(path: string): ChannelStore {
  return {
    load: async () => {
      const text = await readFile(path, "utf8").catch(() => undefined);

      if (text === undefined) {
        return undefined;
      }

      try {
        return SettingsSchema.parse(JSON.parse(text)).channel;
      } catch {
        return undefined;
      }
    },
    save: async (channel: UpdateChannel) => {
      const temporary = `${path}.tmp`;

      // Write-then-rename, so a crash never leaves half a file.
      await writeFile(temporary, JSON.stringify({ channel } satisfies z.infer<typeof SettingsSchema>))
        .then(() => rename(temporary, path))
        .catch((error: unknown) => console.error("[updater] the update channel wasn't saved", error));
    },
  };
}
