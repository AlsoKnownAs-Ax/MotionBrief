import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ConnectorError, Result } from "../connector";
import { runClaude } from "./cli";
import type { BaseEnv } from "./environment";

export type AuthStatus = {
  isLoggedIn: boolean;
  /** True when the login is a Claude subscription rather than an API key. */
  isSubscription: boolean;
  email?: string;
  plan?: string;
};

const AuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  email: z.string().nullish(),
  subscriptionType: z.string().nullish(),
});

/** `claude auth status`: exit 0 means logged in, 1 means not. Spends no tokens. */
export async function readAuthStatus(claudePath: string, env: BaseEnv): Promise<Result<AuthStatus, ConnectorError>> {
  const { data: output, error } = await runClaude(claudePath, ["auth", "status", "--json"], env);

  if (error) {
    return { data: null, error: { code: "AGENT_UNAVAILABLE", message: `Claude couldn't start: ${error.message}` } };
  }

  const { success, data: status } = AuthStatusSchema.safeParse(parseJson(output.stdout));

  if (!success) {
    return { data: null, error: { code: "AGENT_UNAVAILABLE", message: `Claude's auth status was unreadable (exit ${output.exitCode})` } };
  }

  return {
    data: {
      isLoggedIn: status.loggedIn && output.exitCode === 0,
      isSubscription: status.authMethod === "claude.ai",
      email: status.email ?? undefined,
      plan: status.subscriptionType ?? undefined,
    },
    error: null,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const ACCOUNT_TIMEOUT_MS = 30_000;

export type Account = {
  email?: string;
  plan?: string;
};

/**
 * The logged-in account as the agent itself reports it (the SDK's `accountInfo()`). Starts a
 * session without sending a message, so it spends no tokens; undefined if that fails.
 */
export async function readAccount(claudePath: string, env: BaseEnv): Promise<Account | undefined> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ACCOUNT_TIMEOUT_MS);
  const session = query({
    prompt: idle(abort.signal),
    options: { pathToClaudeCodeExecutable: claudePath, env, abortController: abort, settingSources: [], persistSession: false },
  });

  try {
    const account = await session.accountInfo();

    return { email: account.email, plan: planId(account.subscriptionType) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    abort.abort();
    session.close();
  }
}

/** Account info names the plan "Claude Max" where auth status says "max"; the core always uses the latter. */
function planId(subscriptionType: string | undefined) {
  return subscriptionType?.replace(/^claude\s+/i, "").toLowerCase();
}

/** A prompt stream that sends nothing and ends when `signal` aborts. */
function idle(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  const ended = new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
    signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true }),
  );

  return { [Symbol.asyncIterator]: () => ({ next: () => ended }) };
}
