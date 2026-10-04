import { MODEL_CHOICES, type ModelRole, type PlanWindow, type UsageTotals } from "../../../contract";

export const ROLE_LABELS = {
  storyboard: "Storyboard",
  sceneCode: "Scene code",
  visualReview: "Visual review",
  revision: "Revision agent",
} satisfies Record<ModelRole, string>;

export const ROLES = Object.keys(ROLE_LABELS) as ModelRole[];

export const WINDOW_LABELS = {
  "five-hour": "5-hour window",
  "seven-day": "7-day window",
} satisfies Record<PlanWindow["window"], string>;

export function modelLabel(model: string) {
  return MODEL_CHOICES.find(({ id }) => id === model)?.label ?? model;
}

export function dollars(amount: number) {
  return `$${amount.toFixed(2)}`;
}

/** 950 tokens, 2.5k tokens, 1.2M tokens. */
export function tokensLabel({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }: UsageTotals) {
  const tokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  if (tokens < 1000) {
    return `${tokens} tokens`;
  }

  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}k tokens`;
  }

  return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

/** Tokens, with dollars where the connection reports them. */
export function totalsLabel(totals: UsageTotals) {
  if (totals.costUsd === undefined) {
    return tokensLabel(totals);
  }

  return `${dollars(totals.costUsd)} · ${tokensLabel(totals)}`;
}

/** Dollars where the connection reports them, tokens otherwise. */
export function amountLabel(totals: UsageTotals) {
  if (totals.costUsd === undefined) {
    return tokensLabel(totals);
  }

  return dollars(totals.costUsd);
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** "resets 17:40" today, "resets Thu 09:00" later. */
export function resetsLabel(resetsAt: number | undefined, now = Date.now()) {
  if (resetsAt === undefined) {
    return undefined;
  }

  if (new Date(resetsAt).toDateString() === new Date(now).toDateString()) {
    return `resets ${TIME.format(resetsAt)}`;
  }

  return `resets ${DAY_AND_TIME.format(resetsAt)}`;
}

export function percent(utilization: number | undefined) {
  if (utilization === undefined) {
    return undefined;
  }

  return Math.round(utilization * 100);
}

/** "34% used", or that the limit is reached. */
export function windowUsedLabel(utilization: number | undefined, isRejected: boolean) {
  if (isRejected) {
    return "Limit reached";
  }

  const used = percent(utilization);

  if (used === undefined) {
    return undefined;
  }

  return `${used}% used`;
}
