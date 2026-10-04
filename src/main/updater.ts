import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import { z } from "zod";
import type { UpdateChannel, UpdateState } from "../shared/ipc";

// electron-updater is CommonJS; its named exports aren't visible to an ES module.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const SettingsSchema = z.object({ channel: z.enum(["stable", "beta"]) });

type UpdaterOptions = {
  /** The state changed: a new channel, a downloaded update, or an export starting or ending. */
  onChange: (state: UpdateState) => void;
};

/**
 * App updates from GitHub Releases (electron-builder.yml's publish): checked in the background, downloaded
 * as blockmap differences from the installed version, and installed on the creator's "Restart to update" or
 * on the next quit. A restart never happens while an export runs. Development builds never update.
 */
export async function startUpdater({ onChange }: UpdaterOptions) {
  const isEnabled = app.isPackaged;
  let channel = (await loadChannel()) ?? defaultChannel();
  let readyVersion: string | undefined;
  let runningExports = 0;

  function state(): UpdateState {
    return { channel, isEnabled, isExporting: runningExports > 0, ...(readyVersion && { readyVersion }) };
  }

  function check() {
    autoUpdater.checkForUpdates().catch((error: unknown) => console.error("[updater] the update check failed", error));
  }

  if (isEnabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    configure(channel);
    autoUpdater.on("error", (error) => console.error("[updater]", error));
    autoUpdater.on("update-downloaded", ({ version }) => {
      readyVersion = version;
      onChange(state());
    });
    check();
    setInterval(check, CHECK_INTERVAL_MS).unref();
  }

  return {
    state,
    setRunningExports(running: number) {
      runningExports = running;
      onChange(state());
    },
    async setChannel(next: UpdateChannel) {
      if (next !== channel) {
        channel = next;
        await saveChannel(next);

        if (isEnabled) {
          configure(next);
          check();
        }
      }

      onChange(state());
      return state();
    },
    /** Quits and installs the downloaded update, unless there is none or an export is running. */
    restart() {
      if (!readyVersion || runningExports > 0) {
        return false;
      }

      autoUpdater.quitAndInstall();
      return true;
    },
  };
}

export type Updater = Awaited<ReturnType<typeof startUpdater>>;

/**
 * Stable takes GitHub's latest release. Beta takes the newest release, pre-release or not: beta.yml from a
 * beta, latest.yml from a stable one. Leaving beta never installs an older stable over a newer beta.
 */
function configure(channel: UpdateChannel) {
  autoUpdater.channel = channel === "beta" ? "beta" : "latest";
  autoUpdater.allowPrerelease = channel === "beta";
  // Setting the channel allows downgrades; switching back to stable must not.
  autoUpdater.allowDowngrade = false;
}

/** A beta build starts on the beta channel until the creator chooses. */
function defaultChannel(): UpdateChannel {
  if (app.getVersion().includes("-beta.")) {
    return "beta";
  }

  return "stable";
}

function settingsPath() {
  return join(app.getPath("userData"), "updates.json");
}

async function loadChannel() {
  const text = await readFile(settingsPath(), "utf8").catch(() => undefined);

  if (text === undefined) {
    return undefined;
  }

  try {
    return SettingsSchema.parse(JSON.parse(text)).channel;
  } catch {
    return undefined;
  }
}

async function saveChannel(channel: UpdateChannel) {
  const path = settingsPath();
  const temporary = `${path}.tmp`;

  // Write-then-rename, so a crash never leaves half a file.
  await writeFile(temporary, JSON.stringify({ channel } satisfies z.infer<typeof SettingsSchema>))
    .then(() => rename(temporary, path))
    .catch((error: unknown) => console.error("[updater] the update channel wasn't saved", error));
}
