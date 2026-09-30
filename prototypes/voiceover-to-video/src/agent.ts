// PROTOTYPE: one Claude Agent SDK call with structured output; records wall-clock time, tokens and cost.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync } from "node:fs";

export const MODEL = process.env.SPIKE_MODEL ?? "claude-opus-5-5";
// model per agent role (decided in "Prototype: Voiceover to video spike"): review runs on Sonnet 5.5 by default
export const REVIEW_MODEL = process.env.SPIKE_REVIEW_MODEL ?? "claude-sonnet-5-5";

export type CallLog = { label: string; ms: number; costUsd: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number; turns: number; ok: boolean };
export const calls: CallLog[] = [];
let logFile: string | undefined;
export const setCallLog = (f: string) => (logFile = f);

export async function ask<T>(label: string, opts: { system: string; prompt: string; schema: Record<string, unknown>; images?: string[]; cwd?: string; model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max" }): Promise<T> {
  const t0 = performance.now();
  const imageNote = opts.images?.length ? `\n\nFirst use the Read tool to look at these images:\n${opts.images.map((p) => `- ${p}`).join("\n")}` : "";
  let result: any;
  for await (const m of query({
    prompt: opts.prompt + imageNote,
    options: {
      model: opts.model ?? MODEL,
      systemPrompt: opts.system,
      effort: opts.effort ?? "high",
      tools: opts.images?.length ? ["Read"] : [],
      allowedTools: opts.images?.length ? ["Read"] : [],
      settingSources: [],
      persistSession: false,
      cwd: opts.cwd,
      maxTurns: opts.images?.length ? 12 : 4,
      outputFormat: { type: "json_schema", schema: opts.schema },
    },
  })) {
    if (m.type === "result") result = m;
  }
  const ms = performance.now() - t0;
  const u = Object.values((result?.modelUsage ?? {}) as Record<string, any>);
  const sum = (k: string) => u.reduce((a, x) => a + (x[k] ?? 0), 0);
  const log: CallLog = {
    label, ms, costUsd: result?.total_cost_usd ?? 0, inTok: sum("inputTokens"), outTok: sum("outputTokens"),
    cacheRead: sum("cacheReadInputTokens"), cacheWrite: sum("cacheCreationInputTokens"), turns: result?.num_turns ?? 0, ok: result?.subtype === "success",
  };
  calls.push(log);
  if (logFile) appendFileSync(logFile, JSON.stringify(log) + "\n");
  if (result?.subtype !== "success" || result.structured_output === undefined)
    throw new Error(`${label}: agent call failed (${result?.subtype}): ${String(result?.result ?? "").slice(0, 400)}`);
  return result.structured_output as T;
}
