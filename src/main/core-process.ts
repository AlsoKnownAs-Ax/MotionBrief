import { utilityProcess, type MessagePortMain, type UtilityProcess } from "electron";

type CoreProcessOptions = {
  entry: string;
  appVersion: string;
  /** The core died unexpectedly; a restart is scheduled. */
  onExit: () => void;
  /** A replacement core is up; windows should reconnect. */
  onRestart: () => void;
};

/** Delay before each restart, by how many crashes happened within CRASH_WINDOW_MS. */
const RESTART_DELAYS_MS = [0, 500, 2_000, 5_000];
const CRASH_WINDOW_MS = 60_000;

/**
 * Owns the single core utilityProcess: forks it, hands it window ports, and restarts it
 * when it dies so windows stay open and reconnect.
 */
export function startCoreProcess({ entry, appVersion, onExit, onRestart }: CoreProcessOptions) {
  let isRunning = true;
  let isStopping = false;
  let crashTimes: number[] = [];
  let waitingPorts: MessagePortMain[] = [];
  let child = fork();

  function fork(): UtilityProcess {
    const proc = utilityProcess.fork(entry, [`--app-version=${appVersion}`], {
      serviceName: "MotionBrief Core",
      stdio: "inherit",
    });
    proc.once("exit", handleExit);

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
    waitingPorts.forEach((port) => child.postMessage(null, [port]));
    waitingPorts = [];
    onRestart();
  }

  return {
    /** Hands a window's port to the core; held until the core is back if it is restarting. */
    connect(port: MessagePortMain) {
      if (!isRunning) {
        waitingPorts = [...waitingPorts, port];
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
