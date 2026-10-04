import { utilityProcess, type MessagePortMain, type UtilityProcess } from "electron";
import { CORE_APP_DATA_FLAG, CORE_APP_VERSION_FLAG } from "../shared/ipc";

type CoreProcessOptions = {
  entry: string;
  appVersion: string;
  appDataDir: string;
  /** The core died unexpectedly; a restart is scheduled. */
  onExit: () => void;
  /** A replacement core is up; windows should reconnect. */
  onRestart: () => void;
  /** A request from the core for something only main can do; the answer, if any, goes back to it. */
  onRequest: (message: unknown) => Promise<unknown>;
};

/** Delay before each restart, by how many crashes happened within CRASH_WINDOW_MS. */
const RESTART_DELAYS_MS = [0, 500, 2_000, 5_000];
const CRASH_WINDOW_MS = 60_000;

/**
 * Owns the single core utilityProcess: forks it, hands it window ports, and restarts it
 * when it dies so windows stay open and reconnect.
 */
export function startCoreProcess({ entry, appVersion, appDataDir, onExit, onRestart, onRequest }: CoreProcessOptions) {
  let isRunning = true;
  let isStopping = false;
  let crashTimes: number[] = [];
  let child = fork();

  function fork(): UtilityProcess {
    const proc = utilityProcess.fork(entry, [`${CORE_APP_VERSION_FLAG}${appVersion}`, `${CORE_APP_DATA_FLAG}${appDataDir}`], {
      serviceName: "MotionBrief Core",
      stdio: "inherit",
    });
    proc.once("exit", handleExit);
    proc.on("message", (message: unknown) => {
      void onRequest(message)
        .then((response) => {
          if (response !== undefined) {
            proc.postMessage(response);
          }
        })
        .catch((error: unknown) => console.error("[main] a core request failed", error));
    });

    return proc;
  }

  function handleExit(code: number) {
    isRunning = false;

    if (isStopping) {
      return;
    }

    const now = Date.now();
    crashTimes = [...crashTimes.filter((time) => now - time < CRASH_WINDOW_MS), now];
    const delay = RESTART_DELAYS_MS[Math.min(crashTimes.length, RESTART_DELAYS_MS.length) - 1] ?? 0;
    console.error(`[main] core exited with code ${code}; restarting in ${delay} ms`);
    onExit();
    setTimeout(restart, delay);
  }

  function restart() {
    if (isStopping) {
      return;
    }

    child = fork();
    isRunning = true;
    onRestart();
  }

  return {
    /**
     * Hands a window's port to the core. While the core is down the port is dropped:
     * every window reconnects with a fresh port when onRestart fires.
     */
    connect(port: MessagePortMain) {
      if (!isRunning) {
        port.close();
        return;
      }

      child.postMessage(null, [port]);
    },
    /** Kills the core as a crash would. Development only, to exercise the restart path. */
    crash() {
      child.kill();
    },
    stop() {
      isStopping = true;
      child.kill();
    },
  };
}

export type CoreProcess = ReturnType<typeof startCoreProcess>;
