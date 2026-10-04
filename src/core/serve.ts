import { randomUUID } from "node:crypto";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import type { SupportedMessagePort } from "@orpc/client/message-port";
import type { CoreRouter } from "../modules/core-api";

type ServablePort = SupportedMessagePort & {
  start?: () => void;
  /** Electron's MessagePortMain says when the window at the other end is gone. */
  on?: (event: "close", listener: () => void) => void;
};

type ServedCore = {
  router: CoreRouter;
  disconnect: (connection: string) => Promise<void>;
};

/**
 * Serves the core API on one end of a MessagePort; a window holds the other end. Each port is its own connection, so
 * the core knows which window opened which Project and closes it when the window goes.
 */
export function serveCore({ router, disconnect }: ServedCore, port: ServablePort) {
  const connection = randomUUID();
  const handler = new RPCHandler(router, {
    interceptors: [onError((error) => console.error("[core]", error))],
  });

  handler.upgrade(port, { context: { connection } });
  port.on?.("close", () => void disconnect(connection));
  port.start?.();
}
