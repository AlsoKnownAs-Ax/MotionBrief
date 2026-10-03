/**
 * Agent SDK messages in the shapes the real `claude` emits, for the fake's scripted turns.
 * The fake fills in session_id and uuid.
 */

const MODEL = "claude-opus-5-5";

export function textDelta(text: string) {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  };
}

export function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return assistant([{ type: "tool_use", id, name, input }]);
}

export function toolResult(toolUseId: string, isError = false) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: isError }] },
  };
}

/** The synthetic assistant message Claude Code emits when an API call fails. */
export function apiError(error: string) {
  return { ...assistant([{ type: "text", text: "API Error" }]), error };
}

function assistant(content: unknown[]) {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: MODEL,
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
}

type SuccessOptions = {
  result?: string;
  costUsd?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export function success({ result = "", costUsd = 0, model = MODEL, inputTokens = 0, outputTokens = 0 }: SuccessOptions) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 10,
    duration_api_ms: 8,
    num_turns: 1,
    result,
    stop_reason: "end_turn",
    total_cost_usd: costUsd,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      [model]: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: costUsd,
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
      },
    },
    permission_denials: [],
  };
}

export function errorResult() {
  return {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    duration_ms: 10,
    duration_api_ms: 0,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: [],
  };
}

type RateLimit = {
  status: "allowed" | "allowed_warning" | "rejected";
  rateLimitType: string;
  /** Epoch seconds. */
  resetsAt: number;
  utilization: number;
};

export function rateLimit(info: RateLimit) {
  return { type: "rate_limit_event", rate_limit_info: info };
}

export function apiRetry(attempt: number, delayMs: number) {
  return { type: "system", subtype: "api_retry", attempt, max_retries: 10, retry_delay_ms: delayMs, error_status: 529, error: "overloaded" };
}

export function notification(key: string, text: string) {
  return { type: "system", subtype: "notification", key, text, priority: "high" };
}

/** Not a message: the fake asks the SDK whether the agent may use this tool, and records the answer. */
export function permission(toolName: string, input: Record<string, unknown>) {
  return { permission: { tool_name: toolName, input } };
}
