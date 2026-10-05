import type { z } from "zod";
import type { AuthMethod, ConnectionStatus, ConnectorError, SetupError } from "../../contract";

export type { AuthMethod, ConnectionStatus, ConnectorError, SetupError };

/**
 * What the rest of the core needs from an agent: auth that the connector owns, sessions,
 * turns streamed as normalized events, interrupt, host tools mounted via MCP and a sandbox.
 * v1 has one implementation, Claude; tests replay committed outputs through the same type.
 */
export type Connector = {
  id: string;
  /** The name the UI shows. */
  label: string;
  capabilities: ConnectorCapabilities;
  /** Where the connection stands. Never spends tokens. */
  status: () => Promise<ConnectionStatus>;
  setup: ConnectorSetup;
  /** Runs before every run: refuses with AUTHENTICATION_FAILED unless the connection is ready. */
  startSession: (options: SessionOptions) => Promise<Result<Session, ConnectorError>>;
};

/** The setup steps, owned by the connector so the UI never handles a vendor login itself. */
export type ConnectorSetup = {
  /** Chooses the subscription login found on this computer. */
  useLogin: () => Promise<Result<ConnectionStatus, SetupError>>;
  /** Runs the vendor's own sign-in flow; resolves when it ends or `signal` aborts. */
  signIn: (signal?: AbortSignal) => Promise<Result<ConnectionStatus, SetupError>>;
  /** Checks the key without spending tokens, then stores it and chooses it. */
  setApiKey: (apiKey: string) => Promise<Result<ConnectionStatus, SetupError>>;
  removeApiKey: () => Promise<Result<ConnectionStatus, SetupError>>;
};

export type ConnectorCapabilities = {
  authMethods: AuthMethod[];
  /** A session can be resumed by id after the app restarts. */
  canResume: boolean;
  /** Tool results can carry images (rendered stills for visual review). */
  imagesInToolResults: boolean;
};

export type SessionOptions = {
  /** What the run is for, such as `scene-code s03`; names it in logs and replays. */
  label?: string;
  /** The only folder the agent may write to; also its working directory. */
  workspaceDir: string;
  model: string;
  systemPrompt?: string;
  /** Continues an earlier session instead of starting a new one. */
  resumeSessionId?: string;
  hostTools?: HostTool[];
  sandbox?: SandboxPolicy;
};

/** What the agent may touch. Writes outside the workspace are always refused. */
export type SandboxPolicy = {
  /** Shell commands. Off unless a caller needs them. */
  allowShell: boolean;
};

/** A tool MotionBrief provides to the agent, mounted on every connector over MCP. */
export type HostTool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  input: Shape;
  run: (input: z.infer<z.ZodObject<Shape>>) => Promise<HostToolResult>;
};

export type HostToolResult = {
  text: string;
  isError?: boolean;
};

/**
 * Types a host tool's `run` from its input shape, then widens it for a session's tool list.
 * The connector validates input against `input` before calling `run`, which makes the widening safe.
 */
export function defineHostTool<Shape extends z.ZodRawShape>(tool: HostTool<Shape>): HostTool {
  return tool as unknown as HostTool;
}

export type Session = {
  /** The agent's own session id; known once the first turn has started. */
  id: () => string | undefined;
  /** Sends one message and streams the agent's turn; the stream ends with `turn-completed`. */
  sendTurn: (message: string) => AsyncIterable<AgentEvent>;
  /** Ends the current turn early; it completes with status `interrupted`. */
  interrupt: () => Promise<void>;
  close: () => void;
};

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolUseId: string; name: string; input: unknown }
  | { type: "file-changed"; path: string }
  | { type: "usage"; usage: ModelUsage[]; costUsd: number }
  | { type: "plan-usage"; planUsage: PlanUsage }
  | { type: "retrying"; attempt: number; delayMs: number }
  | { type: "login-expiring"; daysLeft: number }
  | { type: "turn-completed"; status: TurnStatus; text?: string; error?: ConnectorError };

export type TurnStatus = "completed" | "interrupted" | "failed";

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

/** A subscription plan's usage window, from the vendor's rate-limit reports. */
export type PlanUsage = {
  window: "five-hour" | "seven-day" | "other";
  isRejected: boolean;
  /** Epoch ms. */
  resetsAt?: number;
  /** 0–1. */
  utilization?: number;
};

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };
