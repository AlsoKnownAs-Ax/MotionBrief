import type { AuthMethod, ConnectionStatus, Connector, ConnectorError, Result, Session, SessionOptions, SetupError } from "../connector";
import { checkApiKey } from "./api-key";
import { readAccount, readAuthStatus, type Account, type AuthStatus } from "./auth";
import { runClaude } from "./cli";
import { claudeEnv, type BaseEnv } from "./environment";
import { openClaudeSession } from "./session";
import type { ConnectionStore, StoredConnection } from "./store";

export type ClaudeConnectorOptions = {
  /** The bundled, unmodified Claude Code binary from the Agent SDK. */
  claudePath: string | undefined;
  store: ConnectionStore;
  /** The environment `claude` processes start from; defaults to the core's own. */
  env?: BaseEnv;
  /** Where API keys are checked; a local fake in tests. */
  apiBaseUrl?: string;
};

/** The v1 connector: Claude, on the Claude Agent SDK. Labelled "Claude", never "Claude Code". */
export function createClaudeConnector({ claudePath, store, env = process.env, apiBaseUrl }: ClaudeConnectorOptions): Connector {
  /** accountInfo() costs a process start, so its answer is kept per login. */
  let account: { email?: string; info?: Account } = {};
  /** Claude only warns that a login expires during a session; the warning lasts until the login changes. */
  let expiresInDays: number | undefined;

  async function labelled(status: AuthStatus, path: string, agentEnv: BaseEnv) {
    if (account.info && account.email !== status.email) {
      expiresInDays = undefined;
    }

    if (account.email !== status.email || !account.info) {
      account = { email: status.email, info: await readAccount(path, agentEnv) };
    }

    return { email: account.info?.email ?? status.email, plan: account.info?.plan ?? status.plan };
  }

  async function status(): Promise<ConnectionStatus> {
    if (!claudePath) {
      return { isConnected: false, error: { code: "AGENT_UNAVAILABLE", message: "The bundled Claude binary is missing" } };
    }

    const { data: stored, error: storeError } = await store.load();

    if (storeError) {
      return { isConnected: false, error: { code: "AGENT_UNAVAILABLE", message: storeError.message } };
    }

    const agentEnv = claudeEnv(env, stored.method, stored.apiKey);
    const { data: auth, error } = await readAuthStatus(claudePath, agentEnv);

    if (error) {
      return { ...fromStore(stored), isConnected: false, error };
    }

    const isConnected = isUsable(stored.method, auth);

    if (!auth.isLoggedIn || !auth.isSubscription) {
      return { ...fromStore(stored), isConnected };
    }

    const login = await labelled(auth, claudePath, agentEnv);

    return { ...fromStore(stored), isConnected, login, expiresInDays };
  }

  /** Saves the method (and key) after a step has checked it, then reports the new status. */
  async function choose(update: StoredConnection): Promise<Result<ConnectionStatus, SetupError>> {
    const { data: stored, error: loadError } = await store.load();

    if (loadError) {
      return { data: null, error: { code: "KEY_STORE_FAILED", message: loadError.message } };
    }

    const { error } = await store.save({ ...stored, ...update });

    if (error) {
      return { data: null, error: { code: "KEY_STORE_FAILED", message: error.message } };
    }

    return { data: await status(), error: null };
  }

  async function useLogin(): Promise<Result<ConnectionStatus, SetupError>> {
    if (!claudePath) {
      return { data: null, error: { code: "NO_LOGIN", message: "The bundled Claude binary is missing" } };
    }

    const { data: auth } = await readAuthStatus(claudePath, claudeEnv(env, "subscription", undefined));

    if (!auth?.isLoggedIn || !auth.isSubscription) {
      return { data: null, error: { code: "NO_LOGIN", message: "Claude isn't signed in to a subscription on this computer" } };
    }

    return choose({ method: "subscription" });
  }

  /** Anthropic's own browser sign-in, run by the unmodified binary; MotionBrief never sees the tokens. */
  async function signIn(signal?: AbortSignal): Promise<Result<ConnectionStatus, SetupError>> {
    if (!claudePath) {
      return { data: null, error: { code: "SIGN_IN_FAILED", message: "The bundled Claude binary is missing" } };
    }

    const limit = AbortSignal.any([AbortSignal.timeout(SIGN_IN_TIMEOUT_MS), ...optional(signal)]);
    const loginEnv = claudeEnv(env, "subscription", undefined);
    const { data: output, error } = await runClaude(claudePath, ["auth", "login", "--claudeai"], loginEnv, limit);

    if (error?.code === "ABORTED") {
      return { data: null, error: { code: "SIGN_IN_CANCELLED", message: "Sign-in was cancelled" } };
    }

    if (error) {
      return { data: null, error: { code: "SIGN_IN_FAILED", message: error.message } };
    }

    if (output.exitCode !== 0) {
      return { data: null, error: { code: "SIGN_IN_FAILED", message: lastLine(output.stderr) ?? `claude auth login exited with ${output.exitCode}` } };
    }

    return useLogin();
  }

  async function setApiKey(pasted: string): Promise<Result<ConnectionStatus, SetupError>> {
    const apiKey = pasted.trim();

    if (!apiKey) {
      return { data: null, error: { code: "KEY_REJECTED", message: "Paste a key first" } };
    }

    const { error } = await checkApiKey(apiKey, apiBaseUrl);

    if (error) {
      return { data: null, error };
    }

    return choose({ method: "api-key", apiKey });
  }

  async function removeApiKey(): Promise<Result<ConnectionStatus, SetupError>> {
    const { data: stored, error } = await store.load();

    if (error) {
      return { data: null, error: { code: "KEY_STORE_FAILED", message: error.message } };
    }

    return choose({ method: methodWithoutKey(stored.method), apiKey: undefined });
  }

  /** Every run starts here, so a run never starts on a broken login: the check spends no tokens. */
  async function startSession(options: SessionOptions): Promise<Result<Session, ConnectorError>> {
    if (!claudePath) {
      return { data: null, error: { code: "AGENT_UNAVAILABLE", message: "The bundled Claude binary is missing" } };
    }

    const { data: stored, error: storeError } = await store.load();

    if (storeError) {
      return { data: null, error: { code: "AGENT_UNAVAILABLE", message: storeError.message } };
    }

    const agentEnv = claudeEnv(env, stored.method, stored.apiKey);
    const { data: auth, error } = await readAuthStatus(claudePath, agentEnv);

    if (error) {
      return { data: null, error };
    }

    if (!isUsable(stored.method, auth)) {
      return { data: null, error: { code: "AUTHENTICATION_FAILED", message: "Claude isn't connected; reconnect to run" } };
    }

    const session = openClaudeSession({
      ...options,
      claudePath,
      env: agentEnv,
      onLoginExpiring: (daysLeft) => (expiresInDays = daysLeft),
    });

    return { data: session, error: null };
  }

  return {
    id: "claude",
    label: "Claude",
    capabilities: { authMethods: ["subscription", "api-key"], canResume: true, imagesInToolResults: true },
    status,
    setup: {
      useLogin,
      signIn,
      setApiKey,
      removeApiKey,
    },
    startSession,
  };
}

/** A run may start: the chosen method is the one Claude is signed in with. */
function isUsable(method: AuthMethod | undefined, auth: AuthStatus) {
  if (method === "subscription") {
    return auth.isLoggedIn && auth.isSubscription;
  }

  return method === "api-key" && auth.isLoggedIn;
}

/** Removing the key leaves no method unless the subscription was the one in use. */
function methodWithoutKey(method: AuthMethod | undefined) {
  if (method === "subscription") {
    return method;
  }

  return undefined;
}

/** Long enough to finish a browser sign-in, short enough that a forgotten one ends. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

function optional<T>(value: T | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return [value];
}

function lastLine(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
}

function fromStore({ method, apiKey }: StoredConnection): Pick<ConnectionStatus, "method" | "maskedKey"> {
  return { method, maskedKey: maskKey(apiKey) };
}

/** `sk-ant-api03-…` → `sk-ant-…WXYZ`: enough to recognize a key, never enough to use it. */
export function maskKey(apiKey: string | undefined) {
  if (!apiKey) {
    return undefined;
  }

  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}
