import { createClaudeConnector, memoryConnectionStore, type ConnectionStore } from "../modules/claude";
import type { Connector } from "../modules/connector";
import { createCoreRouter } from "../modules/core-api";
import { createSystem, realClock, type Clock } from "../modules/system";
import { bundledClaudePath } from "./claude-binary";

/**
 * The implementations behind swappable boundaries. Tests replace these; nothing else does.
 * The clock is the time boundary (it paces streams); the connector is the agent boundary,
 * Claude in the app and a fake `claude` or a replay of committed outputs in tests.
 */
export type Adapters = {
  clock: Clock;
  connector: Connector;
};

export type CoreOptions = {
  appVersion: string;
  /** Where the Claude connection is kept: main's safeStorage in the app, memory when absent. */
  connectionStore?: ConnectionStore;
  adapters?: Partial<Adapters>;
};

/** The one place that picks implementations and wires the modules into the core API. */
export function createCore({ appVersion, connectionStore, adapters }: CoreOptions) {
  const clock = adapters?.clock ?? realClock;
  const connector =
    adapters?.connector ??
    createClaudeConnector({ claudePath: bundledClaudePath(), store: connectionStore ?? memoryConnectionStore() });
  const system = createSystem({ clock, appVersion, pid: process.pid });

  return { router: createCoreRouter({ system, connector }) };
}
