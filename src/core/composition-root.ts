import { createChecker } from "../modules/checker";
import { createCoreRouter } from "../modules/core-api";
import { createSystem, realClock, type Clock } from "../modules/system";
import { chromeHeadlessShellPath } from "./native";

/**
 * The implementations behind swappable boundaries. Tests replace these; nothing else does.
 * The clock is the time boundary (it paces streams); the Connector and Transcriber join it here.
 */
export type Adapters = {
  clock: Clock;
};

export type CoreOptions = {
  appVersion: string;
  adapters?: Partial<Adapters>;
  /** The chrome-headless-shell the frame runs in; the pinned one in vendor/ by default. */
  chromePath?: string;
};

const DEFAULT_ADAPTERS: Adapters = {
  clock: realClock,
};

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({ appVersion, adapters, chromePath = chromeHeadlessShellPath() }: CoreOptions) {
  const { clock } = { ...DEFAULT_ADAPTERS, ...adapters };
  const system = createSystem({ clock, appVersion, pid: process.pid });
  const checker = createChecker({ chromePath });

  return { router: createCoreRouter({ system, checker }) };
}
