import { createORPCClient, DynamicLink, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { CoreClient } from "../../../contract";
import { CORE_PORT_MESSAGE } from "../../../shared/ipc";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

type CorePort = {
  port: MessagePort;
  link: RPCLink<Record<never, never>>;
};

export const useCoreConnection = create<{ status: ConnectionStatus }>(() => ({ status: "connecting" }));

/**
 * Opens a MessageChannel, keeps one end for the core API client and posts the other to
 * the preload, which hands it via main to the core process.
 */
function openCorePort(): CorePort {
  const { port1, port2 } = new MessageChannel();
  window.postMessage(CORE_PORT_MESSAGE, "*", [port2]);
  port1.start();

  return { port: port1, link: new RPCLink({ port: port1 }) };
}

let corePort = openCorePort();

/** The typed core API. Calls always go to the current port, so a reconnect is invisible to callers. */
export const core: CoreClient = createORPCClient(new DynamicLink(() => corePort.link));
export const orpc = createTanstackQueryUtils(core);
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

async function confirmConnected() {
  const { error } = await safe(core.system.info());

  if (error) {
    console.error("[renderer] core did not answer", error);
    return;
  }

  useCoreConnection.setState({ status: "connected" });
}

/** Tracks the core process: marks the connection lost when it dies and reconnects when main restarts it. */
export function startCoreConnection() {
  window.motionbrief.onCoreExited(() => {
    useCoreConnection.setState({ status: "reconnecting" });
    corePort.port.close();
  });

  window.motionbrief.onCoreRestarted(() => {
    corePort = openCorePort();
    // Re-runs every query and stream against the new core.
    void queryClient.invalidateQueries();
    void confirmConnected();
  });

  void confirmConnected();
}
