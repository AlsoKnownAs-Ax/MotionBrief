import type { AgentEvent, ConnectionStatus, Connector, SessionOptions } from "../../modules/connector";

export type ReplayedTurn = {
  /** What the agent was asked, recorded for assertions. */
  message: string;
  options: SessionOptions;
};

/**
 * A connector that replays committed agent outputs instead of running an agent: each turn
 * streams the next recorded list of events. It records what it was asked to do.
 */
export function createReplayConnector(turns: AgentEvent[][], status: ConnectionStatus = { isConnected: true, method: "api-key" }) {
  const remaining = [...turns];
  const asked: ReplayedTurn[] = [];
  const unsupported = async () => ({ data: null, error: { code: "SIGN_IN_FAILED" as const, message: "Replays don't sign in" } });

  const connector: Connector = {
    id: "replay",
    label: "Replay",
    capabilities: { authMethods: [], canResume: false, imagesInToolResults: false },
    status: async () => status,
    setup: { useLogin: unsupported, signIn: unsupported, setApiKey: unsupported, removeApiKey: unsupported },
    startSession: async (options) => ({
      data: {
        id: () => "replay-session",
        sendTurn: async function* (message) {
          asked.push({ message, options });
          yield* remaining.shift() ?? [{ type: "turn-completed", status: "failed", error: { code: "SERVICE_ERROR", message: "No recorded turn left" } }];
        },
        interrupt: async () => {},
        close: () => {},
      },
      error: null,
    }),
  };

  return { connector, asked };
}
