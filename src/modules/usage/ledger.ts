import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PlanWindowSchema, type PlanWindow } from "../../contract";
import { addTotals, EMPTY, TotalsSchema, type Totals } from "./totals";

/** Days of totals kept; only today's is shown. */
const KEPT_DAYS = 31;

/** Cost-per-minute samples kept for the running average; the newest win. */
const KEPT_SAMPLES = 20;

const LedgerSchema = z.object({
  /** Totals per local calendar day, `YYYY-MM-DD`. */
  days: z.record(z.string(), TotalsSchema),
  /** US dollars per Voiceover minute of each finished first generation on an API key. */
  costPerMinute: z.array(z.number().nonnegative()),
  /** The plan's windows as Claude last reported them. */
  plan: z.array(PlanWindowSchema),
});

type Ledger = z.infer<typeof LedgerSchema>;

/**
 * `usage.json` in app data: what runs on this computer used per day, the running cost per Voiceover minute and the
 * plan's last reported windows. Best effort: losing it only resets today's total and the average.
 */
export function createLedger(appDataDir: string) {
  const path = join(appDataDir, "usage.json");
  let ledger: Promise<Ledger> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function read(): Promise<Ledger> {
    ledger ??= readFile(path, "utf8").then(
      (text) => LedgerSchema.safeParse(parseJson(text)).data ?? empty(),
      () => empty(),
    );

    return ledger;
  }

  /** Changes the ledger after the changes before, so parallel runs' reports all count, then saves it. */
  function change(edit: (current: Ledger) => Ledger): Promise<void> {
    const step = queue.then(async () => {
      const next = edit(await read());
      ledger = Promise.resolve(next);
      await save(next).catch(() => undefined);
    });
    queue = step;

    return step;
  }

  async function save(next: Ledger) {
    const staged = `${path}.${randomUUID()}.tmp`;

    try {
      await mkdir(appDataDir, { recursive: true });
      await writeFile(staged, JSON.stringify(next));
      await rename(staged, path);
    } finally {
      await rm(staged, { force: true });
    }
  }

  return {
    day: async (day: string) => (await read()).days[day] ?? EMPTY,
    addToDay: (day: string, delta: Totals) =>
      change((current) => {
        const days = { ...current.days, [day]: addTotals(current.days[day] ?? EMPTY, delta) };
        const kept = Object.keys(days).sort().slice(-KEPT_DAYS);

        return { ...current, days: Object.fromEntries(kept.map((key) => [key, days[key] as Totals])) };
      }),
    costPerMinute: async () => (await read()).costPerMinute,
    addCostPerMinute: (sample: number) => change((current) => ({ ...current, costPerMinute: [...current.costPerMinute, sample].slice(-KEPT_SAMPLES) })),
    plan: async () => (await read()).plan,
    setPlanWindow: (window: PlanWindow) =>
      change((current) => ({ ...current, plan: [...current.plan.filter((known) => known.window !== window.window), window] })),
  };
}

function empty(): Ledger {
  return { days: {}, costPerMinute: [], plan: [] };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
