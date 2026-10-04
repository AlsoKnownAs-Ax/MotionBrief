import { z } from "zod";
import type { AgentEvent, ConnectionStatus, Connector, HostToolResult, SessionOptions } from "../../modules/connector";

export type ReplayedTurn = {
  /** What the agent was asked, recorded for assertions. */
  message: string;
  options: SessionOptions;
  /** What each host tool the turn called answered, in order. */
  toolResults: { name: string; result: HostToolResult }[];
};

/**
 * Recorded turns: one list for every session in order, or a list per session label, each session
 * replaying its label's turns from the first.
 */
export type ReplayScript = AgentEvent[][] | Record<string, AgentEvent[][]>;

const NO_TURN_LEFT: AgentEvent[] = [{ type: "turn-completed", status: "failed", error: { code: "SERVICE_ERROR", message: "No recorded turn left" } }];

/**
 * A connector that replays committed agent outputs instead of running an agent: each turn streams
 * the next recorded list of events. A recorded call to one of the session's host tools runs that
 * tool, as the agent's call would. It records what it was asked to do, and can hold a session's
 * turns until a test releases them.
 */
export function createReplayConnector(script: ReplayScript, status: ConnectionStatus = { isConnected: true, method: "api-key" }) {
  const shared = Array.isArray(script) ? [...script] : undefined;
  const asked: ReplayedTurn[] = [];
  const held = new Map<string, PromiseWithResolvers<void>>();
  // The labels of the sessions open now, and what was open each time one started.
  const open: (string | undefined)[] = [];
  const openings: (string | undefined)[][] = [];
  const unsupported = async () => ({ data: null, error: { code: "SIGN_IN_FAILED" as const, message: "Replays don't sign in" } });

  function turnsFor(label: string | undefined): AgentEvent[][] {
    if (shared) {
      return shared;
    }

    return [...((script as Record<string, AgentEvent[][]>)[label ?? ""] ?? [])];
  }

  const connector: Connector = {
    id: "replay",
    label: "Replay",
    capabilities: { authMethods: [], canResume: false, imagesInToolResults: false },
    status: async () => status,
    setup: { useLogin: unsupported, signIn: unsupported, setApiKey: unsupported, removeApiKey: unsupported },
    startSession: async (options) => {
      const turns = turnsFor(options.label);
      let isOpen = true;
      open.push(options.label);
      openings.push([...open]);

      return {
        data: {
          id: () => "replay-session",
          sendTurn: async function* (message) {
            const turn: ReplayedTurn = { message, options, toolResults: [] };
            asked.push(turn);
            await held.get(options.label ?? "")?.promise;

            for (const event of turns.shift() ?? NO_TURN_LEFT) {
              if (event.type === "tool-call") {
                await runHostTool(options, event, turn);
              }

              yield event;
            }
          },
          interrupt: async () => {},
          close: () => {
            if (isOpen) {
              isOpen = false;
              open.splice(open.indexOf(options.label), 1);
            }
          },
        },
        error: null,
      };
    },
  };

  return {
    connector,
    asked,
    /** The turns sessions with this label were asked, in order. */
    askedOf: (label: string) => asked.filter(({ options }) => options.label === label),
    /** Sessions open now, and the most that were ever open at once; only those whose label starts with `prefix`, if given. */
    sessions: (prefix = "") => {
      const count = (labels: (string | undefined)[]) => labels.filter((label) => (label ?? "").startsWith(prefix)).length;

      return { open: count(open), mostOpen: Math.max(0, ...openings.map(count)) };
    },
    /** Holds every turn of sessions with this label until `release`. */
    hold: (label: string) => void held.set(label, Promise.withResolvers()),
    release: (label: string) => {
      held.get(label)?.resolve();
      held.delete(label);
    },
  };
}

/** Runs the host tool a recorded call names, validating its input first, as the agent's connector does. */
async function runHostTool(options: SessionOptions, call: Extract<AgentEvent, { type: "tool-call" }>, turn: ReplayedTurn) {
  const tool = options.hostTools?.find(({ name }) => call.name === name || call.name.endsWith(`__${name}`));

  if (!tool) {
    return;
  }

  const { success, data, error } = z.object(tool.input).safeParse(call.input);
  const result = success ? await tool.run(data) : { text: error.message, isError: true };
  turn.toolResults.push({ name: tool.name, result });
}
