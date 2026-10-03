import { createSdkMcpServer, query, tool, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, HostTool, Session, SessionOptions } from "../connector";
import type { BaseEnv } from "./environment";
import { createTurnMapper } from "./events";
import { FILE_TOOLS, sandboxPermissions } from "./sandbox";

/** Host tools reach the agent as `mcp__motionbrief__<name>`. */
const HOST_SERVER = "motionbrief";

type OpenSessionOptions = SessionOptions & {
  claudePath: string;
  env: BaseEnv;
  /** Claude warned that the subscription login expires soon. */
  onLoginExpiring: (daysLeft: number) => void;
};

/**
 * One agent process for the whole session: messages go in through a stream, turns come out
 * of the SDK's message iterator. One turn at a time.
 */
export function openClaudeSession(options: OpenSessionOptions): Session {
  const inbox = channel<SDKUserMessage>();
  const abort = new AbortController();
  const agent = query({ prompt: inbox.messages(), options: sdkOptions(options, abort) });
  const messages = agent[Symbol.asyncIterator]();
  let sessionId = options.resumeSessionId;
  let isInterrupting = false;

  async function* sendTurn(text: string): AsyncGenerator<AgentEvent> {
    const turn = createTurnMapper();
    isInterrupting = false;
    inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

    while (true) {
      const { data: next, error } = await nextMessage(messages);

      if (error || next.done) {
        yield { type: "turn-completed", status: "failed", error: { code: "AGENT_UNAVAILABLE", message: error?.message ?? "Claude exited mid-turn" } };
        return;
      }

      const message = next.value;
      sessionId = sessionIdOf(message) ?? sessionId;

      if (message.type === "result") {
        yield* turn.complete(message, isInterrupting);
        return;
      }

      for (const event of turn.map(message)) {
        if (event.type === "login-expiring") {
          options.onLoginExpiring(event.daysLeft);
        }

        yield event;
      }
    }
  }

  return {
    id: () => sessionId,
    sendTurn,
    interrupt: async () => {
      isInterrupting = true;
      await agent.interrupt();
    },
    close: () => {
      inbox.close();
      abort.abort();
      agent.close();
    },
  };
}

function sdkOptions(
  { claudePath, env, workspaceDir, model, systemPrompt, resumeSessionId, hostTools = [], sandbox = { allowShell: false } }: OpenSessionOptions,
  abortController: AbortController,
): Options {
  return {
    pathToClaudeCodeExecutable: claudePath,
    env,
    abortController,
    cwd: workspaceDir,
    model,
    systemPrompt,
    resume: resumeSessionId,
    includePartialMessages: true,
    // Predictable runs: none of the user's own Claude Code settings, hooks, plugins or MCP servers.
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: hostServers(hostTools),
    tools: [...FILE_TOOLS, ...shell(sandbox.allowShell)],
    permissionMode: "default",
    canUseTool: sandboxPermissions(workspaceDir, sandbox, `mcp__${HOST_SERVER}__`),
  };
}

function hostServers(hostTools: HostTool[]): Options["mcpServers"] {
  if (hostTools.length === 0) {
    return undefined;
  }

  const tools = hostTools.map((host) =>
    tool(host.name, host.description, host.input, async (input) => {
      const { text, isError } = await host.run(input);

      return { content: [{ type: "text", text }], isError };
    }),
  );

  return { [HOST_SERVER]: createSdkMcpServer({ name: HOST_SERVER, version: "1.0.0", tools }) };
}

function shell(allowShell: boolean) {
  if (!allowShell) {
    return [];
  }

  return ["Bash"];
}

function sessionIdOf(message: SDKMessage) {
  if (!("session_id" in message)) {
    return undefined;
  }

  return message.session_id;
}

/** The SDK's iterator throws when the agent process fails; that becomes a value here. */
async function nextMessage(messages: AsyncIterator<SDKMessage>) {
  try {
    return { data: await messages.next(), error: null };
  } catch (error) {
    return { data: null, error: toError(error) };
  }
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

/** An async queue: the agent's prompt stream, fed one message per turn. */
function channel<T>() {
  const items: T[] = [];
  let wake: (() => void) | undefined;
  let isClosed = false;

  return {
    push(item: T) {
      items.push(item);
      wake?.();
    },
    close() {
      isClosed = true;
      wake?.();
    },
    async *messages() {
      while (true) {
        const item = items.shift();

        if (item !== undefined) {
          yield item;
          continue;
        }

        if (isClosed) {
          return;
        }

        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
