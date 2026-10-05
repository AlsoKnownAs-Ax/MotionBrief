import { createORPCClient, DynamicLink, safe } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import type { CoreClient, OpenedProject, Project } from "../../../contract";
import { CORE_PORT_MESSAGE } from "../../../shared/ipc";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

type CorePort = {
  port: MessagePort;
  link: RPCLink<Record<never, never>>;
};

type CoreConnection = {
  status: ConnectionStatus;
  /** Bumped once a restarted core has the window's Project open again, so streams follow it anew. */
  restarts: number;
  /** Videos whose run the crash cut short, saved by Stop's rules when the new core opened the Project again. */
  recovered?: OpenedProject["recovered"];
};

export const useCoreConnection = create<CoreConnection>(() => ({ status: "connecting", restarts: 0 }));

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

/** The Project folder this window has open, so a restarted core can open it again. */
let windowProject: { id: string; path: string } | undefined;

/** Notes the Project this window has open, or its new folder after a rename. */
export function rememberOpenProject({ id, path }: Pick<Project, "id" | "path">) {
  windowProject = { id, path };
}

/** Releases the window's Project and its lock. */
export async function closeProject(projectId: string) {
  if (windowProject?.id === projectId) {
    windowProject = undefined;
  }

  await safe(core.project.close({ projectId }));
}

async function confirmConnected() {
  const { error } = await safe(core.system.info());

  if (error) {
    console.error("[renderer] core did not answer", error);
    return;
  }

  useCoreConnection.setState({ status: "connected" });
}

/**
 * Opens the window's Project in the restarted core, taking back the lock the crashed core left. Opening saves any run
 * the crash cut short by Stop's rules and pauses the chat's queue.
 */
async function reopenWindowProject(): Promise<OpenedProject["recovered"]> {
  if (!windowProject) {
    return undefined;
  }

  const { data: opened, error } = await safe(core.project.open({ path: windowProject.path, reclaim: true }));

  if (error) {
    console.error("[renderer] couldn't open the Project again after the core restarted", error);
    return undefined;
  }

  return opened.recovered;
}

async function reconnect() {
  corePort = openCorePort();
  const recovered = await reopenWindowProject();
  // Re-runs every query and stream against the new core.
  void queryClient.invalidateQueries();
  useCoreConnection.setState(({ restarts }) => ({ restarts: restarts + 1, recovered }));
  await confirmConnected();
}

/** Tracks the core process: marks the connection lost when it dies and reconnects when main restarts it. */
export function startCoreConnection() {
  window.motionbrief.onCoreExited(() => {
    useCoreConnection.setState({ status: "reconnecting" });
    corePort.port.close();
  });

  window.motionbrief.onCoreRestarted(() => void reconnect());

  void confirmConnected();
}
