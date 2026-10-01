import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import type { SupportedMessagePort } from "@orpc/client/message-port";
import type { CoreRouter } from "../modules/core-api";

type ServablePort = SupportedMessagePort & { start?: () => void };

/** Serves the core API on one end of a MessagePort; the UI holds the other end. */
export function serveCore(router: CoreRouter, port: ServablePort) {
  const handler = new RPCHandler(router, {
    interceptors: [onError((error) => console.error("[core]", error))],
  });

  handler.upgrade(port);
  port.start?.();
}
