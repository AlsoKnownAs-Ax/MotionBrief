import type { SDKAssistantMessageError, SDKMessage, SDKRateLimitInfo, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, ConnectorError, ModelUsage, PlanUsage } from "../connector";

/** Built-in tools whose `file_path` is a file the agent writes. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const ERROR_CODES = {
  authentication_failed: "AUTHENTICATION_FAILED",
  oauth_org_not_allowed: "AUTHENTICATION_FAILED",
  verification_required: "AUTHENTICATION_FAILED",
  cloud_credential_error: "AUTHENTICATION_FAILED",
  account_on_hold: "BILLING",
  billing_error: "BILLING",
  rate_limit: "RATE_LIMITED",
  overloaded: "RATE_LIMITED",
  model_not_found: "MODEL_UNAVAILABLE",
  invalid_request: "SERVICE_ERROR",
  max_output_tokens: "SERVICE_ERROR",
  server_error: "SERVICE_ERROR",
  unknown: "SERVICE_ERROR",
} satisfies Record<SDKAssistantMessageError, ConnectorError["code"]>;

const PLAN_WINDOWS: Partial<Record<NonNullable<SDKRateLimitInfo["rateLimitType"]>, PlanUsage["window"]>> = {
  five_hour: "five-hour",
  seven_day: "seven-day",
  seven_day_opus: "seven-day",
  seven_day_sonnet: "seven-day",
};

const LOGIN_EXPIRY = /expires in (\d+) day/i;

/**
 * Turns the Agent SDK's messages for one turn into normalized events. It is stateful: an
 * API error or a plan rejection seen mid-turn decides how the turn's result is reported.
 */
export function createTurnMapper() {
  const pendingWrites = new Map<string, string>();
  let apiError: SDKAssistantMessageError | undefined;
  let planRejection: PlanUsage | undefined;

  const handlers: Partial<Record<SDKMessage["type"], (message: SDKMessage) => AgentEvent[]>> = {
    stream_event: (message) => textDeltas(message),
    assistant: (message) => {
      if (message.type !== "assistant" || message.parent_tool_use_id) {
        return [];
      }

      apiError = message.error ?? apiError;

      return message.message.content.flatMap((block) => {
        if (block.type !== "tool_use") {
          return [];
        }

        const path = writtenPath(block.name, block.input);

        if (path) {
          pendingWrites.set(block.id, path);
        }

        return [{ type: "tool-call", toolUseId: block.id, name: block.name, input: block.input }];
      });
    },
    user: (message) => {
      if (message.type !== "user" || typeof message.message.content === "string") {
        return [];
      }

      return message.message.content.flatMap((block) => {
        const path = block.type === "tool_result" && !block.is_error ? pendingWrites.get(block.tool_use_id) : undefined;

        if (!path) {
          return [];
        }

        return [{ type: "file-changed", path }];
      });
    },
    rate_limit_event: (message) => {
      if (message.type !== "rate_limit_event") {
        return [];
      }

      const planUsage = toPlanUsage(message.rate_limit_info);

      if (planUsage.isRejected) {
        planRejection = planUsage;
      }

      return [{ type: "plan-usage", planUsage }];
    },
    system: (message) => systemEvents(message),
  };

  return {
    map: (message: SDKMessage): AgentEvent[] => handlers[message.type]?.(message) ?? [],
    /** The turn's last events, from its result message. */
    complete(result: SDKResultMessage, wasInterrupted: boolean): AgentEvent[] {
      const usage = toUsage(result);

      if (wasInterrupted) {
        return [...usage, { type: "turn-completed", status: "interrupted" }];
      }

      if (!result.is_error && result.subtype === "success") {
        return [...usage, { type: "turn-completed", status: "completed", text: result.result }];
      }

      return [...usage, { type: "turn-completed", status: "failed", error: turnError(result, apiError, planRejection) }];
    },
  };
}

function textDeltas(message: SDKMessage): AgentEvent[] {
  if (message.type !== "stream_event" || message.parent_tool_use_id) {
    return [];
  }

  const { event } = message;

  if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") {
    return [];
  }

  return [{ type: "text-delta", text: event.delta.text }];
}

function systemEvents(message: SDKMessage): AgentEvent[] {
  if (message.type !== "system") {
    return [];
  }

  if (message.subtype === "api_retry") {
    return [{ type: "retrying", attempt: message.attempt, delayMs: message.retry_delay_ms }];
  }

  if (message.subtype !== "notification" || !message.key.startsWith("oauth-expiry")) {
    return [];
  }

  const daysLeft = LOGIN_EXPIRY.exec(message.text)?.[1];

  if (daysLeft === undefined) {
    return [];
  }

  return [{ type: "login-expiring", daysLeft: Number(daysLeft) }];
}

function writtenPath(toolName: string, input: unknown) {
  if (!WRITE_TOOLS.has(toolName)) {
    return undefined;
  }

  const { file_path: filePath, notebook_path: notebookPath } = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
  const path = filePath ?? notebookPath;

  if (typeof path !== "string") {
    return undefined;
  }

  return path;
}

function toPlanUsage({ status, rateLimitType, resetsAt, utilization }: SDKRateLimitInfo): PlanUsage {
  return {
    window: PLAN_WINDOWS[rateLimitType ?? "overage"] ?? "other",
    isRejected: status === "rejected",
    resetsAt: epochMs(resetsAt),
    utilization,
  };
}

/** Rate-limit resets arrive in epoch seconds; everything in MotionBrief is epoch ms. */
function epochMs(time: number | undefined) {
  if (time === undefined || time > 1e12) {
    return time;
  }

  return time * 1_000;
}

function toUsage(result: SDKResultMessage): AgentEvent[] {
  const usage: ModelUsage[] = Object.entries(result.modelUsage).map(([model, used]) => ({
    model,
    inputTokens: used.inputTokens,
    outputTokens: used.outputTokens,
    cacheReadTokens: used.cacheReadInputTokens,
    cacheWriteTokens: used.cacheCreationInputTokens,
    costUsd: used.costUSD,
  }));

  if (usage.length === 0) {
    return [];
  }

  return [{ type: "usage", usage, costUsd: result.total_cost_usd }];
}

function turnError(result: SDKResultMessage, apiError: SDKAssistantMessageError | undefined, planRejection: PlanUsage | undefined): ConnectorError {
  if (planRejection) {
    return { code: "PLAN_LIMIT", message: "The Claude plan's usage limit was reached", resetsAt: planRejection.resetsAt };
  }

  if (apiError) {
    return { code: ERROR_CODES[apiError], message: `Claude stopped: ${apiError}` };
  }

  return { code: "SERVICE_ERROR", message: resultErrors(result) };
}

function resultErrors(result: SDKResultMessage) {
  if (result.subtype === "success") {
    return result.result;
  }

  return result.errors.join("; ") || `Claude stopped: ${result.subtype}`;
}
