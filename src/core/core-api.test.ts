import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { CoreClient } from "../contract";
import type { Clock } from "../modules/system";
import { createCore, type CoreOptions } from "./composition-root";
import { serveCore } from "./serve";

/** These tests never touch the transcription model, so nothing is written here. */
const APP_DATA_DIR = join(tmpdir(), "motionbrief-core-api-test");

function connect(options: Omit<CoreOptions, "appDataDir">) {
  const { router } = createCore({ ...options, appDataDir: APP_DATA_DIR });

  return createRouterClient(router);
}

describe("core API", () => {
  it("reports the app version and the process it runs in", async () => {
    const core = connect({ appVersion: "1.2.3" });

    const info = await core.system.info();

    expect(info.appVersion).toBe("1.2.3");
    expect(info.pid).toBe(process.pid);
  });

  it("streams a heartbeat every second, paced by the clock adapter", async () => {
    const core = connect({ appVersion: "1.2.3", adapters: { clock: manualClock(10_000) } });

    const beats = await take(await core.system.heartbeat(), 3);

    expect(beats).toEqual([
      { seq: 0, at: 10_000 },
      { seq: 1, at: 11_000 },
      { seq: 2, at: 12_000 },
    ]);
  });

  it("serves calls and streams over a MessagePort", async () => {
    const { router } = createCore({ appVersion: "1.2.3", appDataDir: APP_DATA_DIR, adapters: { clock: manualClock(10_000) } });
    const { port1, port2 } = new MessageChannel();
    serveCore(router, port1);
    const core: CoreClient = createORPCClient(new RPCLink({ port: port2 }));
    port2.start();

    const info = await core.system.info();
    const beats = await take(await core.system.heartbeat(), 2);

    expect(info.appVersion).toBe("1.2.3");
    expect(beats).toEqual([
      { seq: 0, at: 10_000 },
      { seq: 1, at: 11_000 },
    ]);

    port2.close();
  });
});

/**
 * A clock whose sleeps move time forward by exactly the time slept and return on the
 * next event-loop turn, so a stream pushing over a port still lets messages through.
 */
function manualClock(start: number): Clock {
  let now = start;

  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function take<T>(stream: AsyncIterator<T>, count: number) {
  const items: T[] = [];

  while (items.length < count) {
    const { done, value } = await stream.next();

    if (done) {
      break;
    }

    items.push(value);
  }

  await stream.return?.();

  return items;
}
