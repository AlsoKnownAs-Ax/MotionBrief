import type { Result, SetupError } from "../connector";

export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/** Any current model works: counting tokens is free and only proves the key is accepted. */
const CHECK_MODEL = "claude-opus-5-5";
const CHECK_TIMEOUT_MS = 15_000;

/** Checks a key with Anthropic's free `count_tokens` endpoint; never spends tokens and never logs the key. */
export async function checkApiKey(apiKey: string, baseUrl = ANTHROPIC_API_URL): Promise<Result<null, SetupError>> {
  const response = await fetch(`${baseUrl}/v1/messages/count_tokens`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: CHECK_MODEL, messages: [{ role: "user", content: "Hi" }] }),
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  }).catch(() => undefined);

  if (!response) {
    return { data: null, error: { code: "KEY_CHECK_FAILED", message: "Couldn't reach Anthropic to check the key" } };
  }

  if (response.ok) {
    return { data: null, error: null };
  }

  if (response.status === 401 || response.status === 403) {
    return { data: null, error: { code: "KEY_REJECTED", message: "Anthropic rejected this key" } };
  }

  return { data: null, error: { code: "KEY_CHECK_FAILED", message: `Anthropic couldn't check the key (HTTP ${response.status})` } };
}
