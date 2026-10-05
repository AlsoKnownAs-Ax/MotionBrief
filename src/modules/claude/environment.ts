import type { AuthMethod } from "../connector";

export type BaseEnv = Record<string, string | undefined>;

/**
 * The environment every `claude` process gets. The auto-updater is off: the bundled binary is
 * pinned and must stay unmodified. CLAUDE_CONFIG_DIR is never set, so Claude Code finds the
 * user's own login. A subscription drops ANTHROPIC_API_KEY, which would override that login;
 * an API key is passed to this process only, never to MotionBrief's own environment.
 */
export function claudeEnv(base: BaseEnv, method: AuthMethod | undefined, apiKey: string | undefined): BaseEnv {
  const inherited = Object.fromEntries(Object.entries(base).filter(([name]) => name !== "ANTHROPIC_API_KEY"));
  const env = { ...inherited, DISABLE_AUTOUPDATER: "1", CLAUDE_AGENT_SDK_CLIENT_APP: "motionbrief" };

  if (method === "api-key" && apiKey) {
    return { ...env, ANTHROPIC_API_KEY: apiKey };
  }

  return env;
}
