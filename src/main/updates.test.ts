import { describe, expect, it, vi } from "vitest";
import type { UpdateChannel } from "../shared/ipc";
import { createUpdates, type ExportsHold } from "./updates";

/** electron-updater as updates.ts sees it: tests fire downloads and read what was configured. */
function fakeBackend(stagesNatively: boolean) {
  const listeners: ((version: string) => void)[] = [];
  const backend = {
    stagesNatively,
    installOnQuit: true,
    installs: 0,
    channel: "",
    configure: ({ channel }: { channel: "latest" | "beta" }) => {
      backend.channel = channel;
    },
    check: async () => undefined,
    onDownloaded: (listener: (version: string) => void) => listeners.push(listener),
    setInstallOnQuit: (install: boolean) => {
      backend.installOnQuit = install;
    },
    quitAndInstall: () => {
      backend.installs += 1;
    },
    download: (version: string) => listeners.forEach((listener) => listener(version)),
  };

  return backend;
}

/** The core's side of the hold: `running` exports, and whether new ones are held. */
function fakeExports(running = 0) {
  const exports: ExportsHold & { running: number; isHeld: boolean } = {
    running,
    isHeld: false,
    hold: async () => {
      exports.isHeld = true;
      return exports.running;
    },
    release: () => {
      exports.isHeld = false;
    },
  };

  return exports;
}

type Setup = { channel?: UpdateChannel; running?: number; abandonAfterMs?: number; stagesNatively?: boolean };

async function setup({ channel, running = 0, abandonAfterMs, stagesNatively = false }: Setup = {}) {
  const backend = fakeBackend(stagesNatively);
  const exports = fakeExports(running);
  const updates = await createUpdates({
    backend,
    isEnabled: true,
    currentVersion: "1.0.0",
    store: { load: async () => channel, save: async () => undefined },
    exports,
    onChange: () => undefined,
    abandonAfterMs,
  });

  return { backend, exports, updates };
}

describe("app updates", () => {
  it("offers a downloaded update and installs it on Restart", async () => {
    const { backend, exports, updates } = await setup();

    backend.download("1.1.0");

    expect(updates.state()).toMatchObject({ channel: "stable", readyVersion: "1.1.0" });
    expect(await updates.restart()).toBe(true);
    expect(backend.installs).toBe(1);
    expect(exports.isHeld).toBe(true);
  });

  describe("leaving beta", () => {
    it("drops a beta that had already downloaded: no Restart offer, no install on quit", async () => {
      const { backend, updates } = await setup({ channel: "beta" });
      backend.download("1.1.0-beta.1");
      expect(updates.state().readyVersion).toBe("1.1.0-beta.1");

      await updates.setChannel("stable");

      expect(backend.channel).toBe("latest");
      expect(updates.state().readyVersion).toBeUndefined();
      expect(backend.installOnQuit).toBe(false);
      expect(await updates.restart()).toBe(false);
      expect(backend.installs).toBe(0);
    });

    it("ignores a beta that finishes downloading afterwards", async () => {
      const { backend, updates } = await setup({ channel: "beta" });

      await updates.setChannel("stable");
      backend.download("1.1.0-beta.1");

      expect(updates.state().readyVersion).toBeUndefined();
      expect(backend.installOnQuit).toBe(false);
      expect(await updates.restart()).toBe(false);
    });

    it("says a beta the system installer already holds (macOS) still installs on quit, rather than pretend it's gone", async () => {
      const { backend, updates } = await setup({ channel: "beta", stagesNatively: true });
      backend.download("1.1.0-beta.1");

      await updates.setChannel("stable");

      expect(backend.channel).toBe("latest");
      expect(updates.state()).toMatchObject({ channel: "stable", readyVersion: "1.1.0-beta.1", stagedBeta: "1.1.0-beta.1" });

      // Stable takes over from the next update.
      backend.download("1.1.0");

      expect(updates.state()).toMatchObject({ channel: "stable", readyVersion: "1.1.0" });
      expect(updates.state().stagedBeta).toBeUndefined();
    });

    it("still takes a stable release that downloads later", async () => {
      const { backend, updates } = await setup({ channel: "beta" });
      backend.download("1.1.0-beta.1");
      await updates.setChannel("stable");

      backend.download("1.1.0");

      expect(updates.state().readyVersion).toBe("1.1.0");
      expect(backend.installOnQuit).toBe(true);
    });
  });

  describe("never restarts during an export", () => {
    it("refuses while the core reports an export running, and lets exports start again", async () => {
      const { backend, exports, updates } = await setup({ running: 1 });
      backend.download("1.1.0");

      expect(await updates.restart()).toBe(false);
      expect(backend.installs).toBe(0);
      expect(exports.isHeld).toBe(false);
    });

    it("refuses when the core doesn't answer", async () => {
      const { backend, exports, updates } = await setup();
      exports.hold = async () => undefined;
      backend.download("1.1.0");

      expect(await updates.restart()).toBe(false);
      expect(backend.installs).toBe(0);
    });

    it("lets exports start again when the install fails or the app doesn't quit", async () => {
      const failing = await setup();
      failing.backend.quitAndInstall = () => {
        throw new Error("no installer");
      };
      failing.backend.download("1.1.0");

      expect(await failing.updates.restart()).toBe(false);
      expect(failing.exports.isHeld).toBe(false);

      const stuck = await setup({ abandonAfterMs: 10 });
      stuck.backend.download("1.1.0");

      expect(await stuck.updates.restart()).toBe(true);
      expect(stuck.exports.isHeld).toBe(true);
      await vi.waitFor(() => expect(stuck.exports.isHeld).toBe(false));
    });
  });
});
