import type { Clock } from "./clock";

export type SystemOptions = {
  clock: Clock;
  appVersion: string;
  pid: number;
};

export type Heartbeat = {
  seq: number;
  at: number;
};

export type System = ReturnType<typeof createSystem>;

const HEARTBEAT_INTERVAL_MS = 1_000;

/** Facts about the running core process, and a heartbeat the UI uses to see it is alive. */
export function createSystem({ clock, appVersion, pid }: SystemOptions) {
  const startedAt = clock.now();

  async function* heartbeat(signal?: AbortSignal): AsyncGenerator<Heartbeat> {
    for (let seq = 0; !signal?.aborted; seq += 1) {
      yield { seq, at: clock.now() };
      await clock.sleep(HEARTBEAT_INTERVAL_MS, signal);
    }
  }

  return {
    info: () => ({ appVersion, pid, startedAt }),
    heartbeat,
  };
}
