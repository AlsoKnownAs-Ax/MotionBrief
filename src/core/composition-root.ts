import { createCoreRouter } from "../modules/core-api";
import { createSystem, realClock, type Clock } from "../modules/system";

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
};

const DEFAULT_ADAPTERS: Adapters = {
  clock: realClock,
};

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({ appVersion, adapters }: CoreOptions) {
  const { clock } = { ...DEFAULT_ADAPTERS, ...adapters };
  const system = createSystem({ clock, appVersion, pid: process.pid });

  return { router: createCoreRouter({ system }) };
}
