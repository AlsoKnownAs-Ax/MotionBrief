import type { UpdateChannel, UpdateState } from "../shared/ipc";

/** What updates need from electron-updater; updater.ts adapts it, tests fake it. */
export type UpdateBackend = {
  configure: (options: { channel: "latest" | "beta"; allowPrerelease: boolean }) => void;
  check: () => Promise<unknown>;
  /** Called with each version electron-updater has downloaded and staged for installing. */
  onDownloaded: (listener: (version: string) => void) => void;
  /** Whether quitting the app installs the staged update. */
  setInstallOnQuit: (install: boolean) => void;
  /**
   * A downloaded update is handed to the system installer (Squirrel.Mac on macOS), which installs it on quit whatever
   * `setInstallOnQuit` says: once staged, it can't be taken back.
   */
  stagesNatively: boolean;
  quitAndInstall: () => void;
};

/** The core's exports, held while the app restarts into an update. */
export type ExportsHold = {
  /** Stops new exports and resolves to how many still run; undefined when the core didn't answer. */
  hold: () => Promise<number | undefined>;
  release: () => void;
};

export type ChannelStore = {
  load: () => Promise<UpdateChannel | undefined>;
  save: (channel: UpdateChannel) => Promise<void>;
};

type UpdatesOptions = {
  backend: UpdateBackend;
  /** False in development builds, which never update. */
  isEnabled: boolean;
  currentVersion: string;
  store: ChannelStore;
  exports: ExportsHold;
  onChange: (state: UpdateState) => void;
  /** How long a restart may take to quit before it counts as abandoned and exports may start again. */
  abandonAfterMs?: number;
};

const ABANDON_AFTER_MS = 30_000;

/**
 * App updates: checked and downloaded in the background, installed on "Restart to update" or on quit. A
 * staged update only counts while it fits the channel, so a beta downloaded before leaving beta (or still
 * downloading then) is never installed on the stable channel. Where the system installer already holds a
 * staged beta (macOS), it installs on quit regardless: it stays the ready version and the state says so,
 * and stable takes over from the next update. Restarting first holds the core's exports and goes ahead only
 * when none runs.
 */
export async function createUpdates({ backend, isEnabled, currentVersion, store, exports, onChange, abandonAfterMs = ABANDON_AFTER_MS }: UpdatesOptions) {
  let channel = (await store.load()) ?? defaultChannel(currentVersion);
  let staged: string | undefined;
  let runningExports = 0;
  let isRestarting = false;

  function readyVersion() {
    if (staged && (fitsChannel(staged, channel) || backend.stagesNatively)) {
      return staged;
    }

    return undefined;
  }

  /** A beta the system installer holds after the creator left beta: it still installs on quit. */
  function stagedBeta() {
    if (staged && !fitsChannel(staged, channel) && backend.stagesNatively) {
      return staged;
    }

    return undefined;
  }

  function state(): UpdateState {
    const version = readyVersion();
    const beta = stagedBeta();

    return { channel, isEnabled, isExporting: runningExports > 0, ...(version && { readyVersion: version }), ...(beta && { stagedBeta: beta }) };
  }

  /**
   * electron-updater reads its install-on-quit flag at quit time, but only arms its quit handler if the flag
   * is on when a download finishes, so it stays on except while a staged update doesn't fit the channel.
   */
  function changed() {
    backend.setInstallOnQuit(!staged || fitsChannel(staged, channel));
    onChange(state());
  }

  function configure() {
    backend.configure({ channel: channel === "beta" ? "beta" : "latest", allowPrerelease: channel === "beta" });
  }

  function check() {
    backend.check().catch((error: unknown) => console.error("[updater] the update check failed", error));
  }

  /** Lets exports start again after a restart that didn't happen. */
  function abandon() {
    if (!isRestarting) {
      return;
    }

    isRestarting = false;
    exports.release();
  }

  if (isEnabled) {
    configure();
    backend.onDownloaded((version) => {
      staged = version;
      changed();
    });
    changed();
    check();
  }

  return {
    state,
    check() {
      if (isEnabled) {
        check();
      }
    },
    setRunningExports(running: number) {
      runningExports = running;
      onChange(state());
    },
    async setChannel(next: UpdateChannel) {
      if (next !== channel) {
        channel = next;
        await store.save(next);

        if (isEnabled) {
          configure();
          changed();
          check();
        }
      }

      onChange(state());
      return state();
    },
    /** Restarts into the ready update, unless there is none, or an export runs or the core can't say. */
    async restart() {
      const version = readyVersion();

      if (!version || isRestarting) {
        return false;
      }

      isRestarting = true;
      const running = await exports.hold();

      if (running !== 0 || readyVersion() !== version) {
        abandon();
        return false;
      }

      try {
        backend.quitAndInstall();
      } catch (error) {
        console.error("[updater] the update couldn't be installed", error);
        abandon();
        return false;
      }

      // Still here after that: the installer didn't quit the app, so let exports start again.
      setTimeout(abandon, abandonAfterMs).unref?.();
      return true;
    },
  };
}

export type Updates = Awaited<ReturnType<typeof createUpdates>>;

/** Stable takes stable versions only; beta takes both. */
function fitsChannel(version: string, channel: UpdateChannel) {
  return channel === "beta" || !version.includes("-");
}

/** A beta build starts on the beta channel until the creator chooses. */
function defaultChannel(currentVersion: string): UpdateChannel {
  if (currentVersion.includes("-beta.")) {
    return "beta";
  }

  return "stable";
}
