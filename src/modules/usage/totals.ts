import { z } from "zod";
import type { UsageTotals } from "../../contract";
import type { ModelUsage } from "../connector";

/** Usage as the core keeps it: always with dollars, which are left out of what a subscription is shown. */
export const TotalsSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export type Totals = z.infer<typeof TotalsSchema>;

export const EMPTY: Totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** What a model used since `before`; never negative, since a crashed run may report zeros. */
export function usedSince(now: ModelUsage, before: ModelUsage | undefined): Totals {
  const since = (key: keyof Totals) => Math.max(0, now[key] - (before?.[key] ?? 0));

  return {
    inputTokens: since("inputTokens"),
    outputTokens: since("outputTokens"),
    cacheReadTokens: since("cacheReadTokens"),
    cacheWriteTokens: since("cacheWriteTokens"),
    costUsd: since("costUsd"),
  };
}

/** The highest of each counter a session has reported, so a report that went down doesn't count again what it lost. */
export function highWater(now: ModelUsage, before: ModelUsage | undefined): ModelUsage {
  const highest = (key: keyof Totals) => Math.max(now[key], before?.[key] ?? 0);

  return {
    model: now.model,
    inputTokens: highest("inputTokens"),
    outputTokens: highest("outputTokens"),
    cacheReadTokens: highest("cacheReadTokens"),
    cacheWriteTokens: highest("cacheWriteTokens"),
    costUsd: highest("costUsd"),
  };
}

/** The totals as the creator sees them: without dollars on a subscription. */
export function shown(totals: Totals, withCost: boolean): UsageTotals {
  const { costUsd, ...tokens } = totals;

  if (!withCost) {
    return tokens;
  }

  return { ...tokens, costUsd };
}

export function cents(dollars: number): number {
  return Math.round(dollars * 100) / 100;
}
