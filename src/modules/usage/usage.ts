import type { AuthMethod, CostRange, ModelRole, PlanWindow, RoleUsage, UsageStatus, UsageTotals, VideoRef } from "../../contract";
import type { AgentEvent, Connector, ConnectorError, ModelUsage, PlanUsage, Session } from "../connector";
import { createStatusStore, type Projects } from "../projects";
import type { SettingsStore } from "../settings";
import type { Clock } from "../system";
import { createLedger } from "./ledger";
import { addTotals, cents, EMPTY, shown, usedSince, type Totals } from "./totals";

/** What a first generation costs per Voiceover minute before any has finished here: $3-5 in the spike (#7). */
const SEED_COST_PER_MINUTE = 4;

/** The estimate spans the running average ±25%, so the seed reads $3-5. */
const ESTIMATE_SPREAD = 0.25;

export type UsageOptions = {
  connector: Connector;
  settings: SettingsStore;
  projects: Projects;
  clock: Clock;
  appDataDir: string;
};

export type Usage = ReturnType<typeof createUsage>;

export type UsageError = { code: "UNKNOWN_PROJECT"; projectId: string };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** A run of agents for one video: a first generation or a Revision, its agents running in parallel. */
export type UsageRun = {
  /** The connector the run's agents in `role` start their sessions on, so their usage is counted for the role. */
  connector: (role: ModelRole) => Connector;
  /** The run reached the cost cap: its agents were stopped and no more start. */
  isCapped: () => boolean;
  /** The run ended; a first generation that `completed` adds its cost to the running cost per Voiceover minute. */
  finish: (outcome: { completed: boolean }) => Promise<void>;
};

type RunState = {
  state: "running" | "finished" | "capped";
  roles: Map<ModelRole, { model: string; totals: Totals }>;
  total: Totals;
  capUsd?: number;
};

/**
 * Usage: what agent runs use, summed per model role across a run's parallel agents, per video (stored with it) and
 * per day. On an API key it prices the next first generation, asks for approval when Settings say so, and stops a run
 * at the creator's cap, which the SDK's own per-agent budget can't do across parallel agents. On a subscription it
 * shows the plan's windows instead, and never dollars.
 */
export function createUsage({ connector, settings, projects, clock, appDataDir }: UsageOptions) {
  const ledger = createLedger(appDataDir);
  const runs = new Map<string, RunState>();
  const videoTotals = new Map<string, Totals>();
  const changes = createStatusStore({ count: 0 });
  let method: AuthMethod | undefined;

  const changed = () => changes.set({ count: changes.get().count + 1 });

  async function connectionMethod() {
    method = (await connector.status()).method;

    return method;
  }

  /** What a first generation of a Voiceover this long will cost: its minutes × the running cost per minute. */
  async function estimateCost(voiceoverSeconds: number): Promise<CostRange> {
    const samples = await ledger.costPerMinute();
    const average = (SEED_COST_PER_MINUTE + samples.reduce((sum, sample) => sum + sample, 0)) / (1 + samples.length);
    const minutes = voiceoverSeconds / 60;

    return { low: cents(minutes * average * (1 - ESTIMATE_SPREAD)), high: cents(minutes * average * (1 + ESTIMATE_SPREAD)) };
  }

  /** On an API key with "Approve cost before running" on, a run waits for the creator's approval; a subscription never asks. */
  async function needsApproval(): Promise<boolean> {
    const [connectedWith, { approveCost }] = await Promise.all([connectionMethod(), settings.get()]);

    return connectedWith === "api-key" && approveCost;
  }

  function startRun(ref: VideoRef, { voiceoverSeconds }: { voiceoverSeconds?: number } = {}): UsageRun {
    const key = videoKey(ref);
    const run: RunState = { state: "running", roles: new Map(), total: EMPTY };
    const inFlight = new Set<Session>();
    // The connection the run started on decides whether it is billed, even if the creator changes it meanwhile.
    const isBilled = connectionMethod().then(async (connectedWith) => {
      run.capUsd = connectedWith === "api-key" ? (await settings.get()).costCapUsd : undefined;

      return connectedWith === "api-key";
    });
    runs.set(key, run);
    changed();

    /**
     * Counts what a turn used: for the run's role, the video and today, then stops the run if that reached the cap.
     * Resolves to whether the run was still under the cap once this was counted. The cap is read each time, so
     * changing it in Settings applies to a run already going.
     */
    async function record(role: ModelRole, model: string, used: Totals): Promise<boolean> {
      const billed = await isBilled;
      const capUsd = billed ? (await settings.get()).costCapUsd : undefined;
      // Nothing awaits from here to the cap check, so parallel agents' reports are counted one at a time.
      const counted = billed ? used : { ...used, costUsd: 0 };
      const before = run.roles.get(role)?.totals ?? EMPTY;
      run.roles.set(role, { model, totals: addTotals(before, counted) });
      run.total = addTotals(run.total, counted);
      run.capUsd = capUsd;

      if (run.state === "running" && capUsd !== undefined && run.total.costUsd >= capUsd) {
        run.state = "capped";
        // A session that can't be interrupted ends its turn anyway, and that turn counts as stopped.
        [...inFlight].forEach((session) => void session.interrupt().catch(() => undefined));
      }

      const isUnderCap = run.state !== "capped";
      changed();
      await Promise.all([ledger.addToDay(today(), counted), addToVideo(ref, billed ? counted : withoutCost(counted))]);
      changed();

      return isUnderCap;
    }

    /** A function, since the cap can be reached by any of the run's agents while this one awaits. */
    const isCapped = () => run.state === "capped";

    function capError(): ConnectorError {
      return { code: "COST_CAP", message: `The run reached your $${(run.capUsd ?? 0).toFixed(2)} cap` };
    }

    /**
     * A turn whose usage didn't arrive before the cap was reached ends as stopped by the cap: Stop's rule that only
     * finished work is kept. Session usage is cumulative, so each report counts what was used since the one before.
     */
    async function* meteredTurn(session: Session, message: string, role: ModelRole, model: string, reported: Map<string, ModelUsage>): AsyncGenerator<AgentEvent> {
      if (isCapped()) {
        yield { type: "turn-completed", status: "failed", error: capError() };
        return;
      }

      let isCounted = false;
      inFlight.add(session);

      try {
        for await (const event of session.sendTurn(message)) {
          if (event.type === "usage") {
            isCounted = !isCapped();

            for (const used of event.usage) {
              const since = usedSince(used, reported.get(used.model));
              reported.set(used.model, used);
              isCounted = (await record(role, model, since)) && isCounted;
            }
          }

          if (event.type === "plan-usage") {
            await recordPlan(event.planUsage);
          }

          if (event.type === "turn-completed" && isCapped() && !isCounted) {
            yield { type: "turn-completed", status: "failed", error: capError() };
            return;
          }

          yield event;
        }
      } finally {
        inFlight.delete(session);
      }
    }

    function connectorFor(role: ModelRole): Connector {
      return {
        ...connector,
        startSession: async (options) => {
          if (isCapped()) {
            return { data: null, error: capError() };
          }

          const { data: session, error } = await connector.startSession(options);

          if (error) {
            return { data: null, error };
          }

          const reported = new Map<string, ModelUsage>();

          return { data: { ...session, sendTurn: (message) => meteredTurn(session, message, role, options.model, reported) }, error: null };
        },
      };
    }

    return {
      connector: connectorFor,
      isCapped,
      finish: async ({ completed }) => {
        if (completed && run.state === "running" && (await isBilled) && voiceoverSeconds && run.total.costUsd > 0) {
          await ledger.addCostPerMinute(run.total.costUsd / (voiceoverSeconds / 60));
        }

        if (run.state === "running") {
          run.state = "finished";
        }

        changed();
      },
    };
  }

  async function addToVideo(ref: VideoRef, used: UsageTotals) {
    const { data: totals } = await projects.addUsage(ref.projectId, ref.format, used);

    // A Project closed mid-run keeps what was saved before; the run still counts for today.
    if (totals) {
      videoTotals.set(videoKey(ref), { ...totals, costUsd: totals.costUsd ?? 0 });
    }
  }

  async function recordPlan(planUsage: PlanUsage) {
    if (planUsage.window === "other") {
      return;
    }

    await ledger.setPlanWindow({ window: planUsage.window, utilization: planUsage.utilization, resetsAt: planUsage.resetsAt, isRejected: planUsage.isRejected });
    changed();
  }

  async function storedVideoTotals(ref: VideoRef): Promise<Totals | undefined> {
    const key = videoKey(ref);
    const known = videoTotals.get(key);

    if (known) {
      return known;
    }

    const { data: totals } = await projects.usage(ref.projectId, ref.format);

    if (!totals) {
      return undefined;
    }

    const stored = { ...totals, costUsd: totals.costUsd ?? 0 };
    videoTotals.set(key, stored);

    return stored;
  }

  async function status(ref: VideoRef | undefined): Promise<UsageStatus> {
    // Dollars only where they are billed: on an API key.
    const withCost = method === "api-key";
    const run = ref ? runs.get(videoKey(ref)) : undefined;
    const video = ref ? await storedVideoTotals(ref) : undefined;
    const plan = method === "subscription" ? currentWindows(await ledger.plan()) : [];

    return {
      method,
      run: run && {
        state: run.state,
        roles: [...run.roles].map(([role, { model, totals }]): RoleUsage => ({ role, model, ...shown(totals, withCost) })),
        total: shown(run.total, withCost),
        ...(withCost && run.capUsd !== undefined ? { capUsd: run.capUsd } : {}),
      },
      video: video && shown(video, withCost),
      today: shown(await ledger.day(today()), withCost),
      plan,
    };
  }

  /** Streams the usage of a video's runs (the video of an open Project), today's and the plan's, now and after every change. */
  async function watch(ref: VideoRef | undefined, signal?: AbortSignal): Promise<Result<AsyncGenerator<UsageStatus>, UsageError>> {
    if (ref) {
      const { error } = await projects.video(ref.projectId, ref.format);

      if (error) {
        return { data: null, error: error.code === "UNKNOWN_PROJECT" ? error : { code: "UNKNOWN_PROJECT", projectId: ref.projectId } };
      }
    }

    await connectionMethod();

    async function* statuses() {
      // A change only says that something changed; the status is read anew.
      const ticks = changes.watch(signal);

      while (!(await ticks.next()).done) {
        yield await status(ref);
      }
    }

    return { data: statuses(), error: null };
  }

  /** Plan windows whose reset has passed say nothing about now. */
  function currentWindows(windows: PlanWindow[]) {
    return windows.filter(({ resetsAt }) => resetsAt === undefined || resetsAt > clock.now());
  }

  function today() {
    const now = new Date(clock.now());

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  return { estimateCost, needsApproval, startRun, watch };
}

function videoKey({ projectId, format }: VideoRef) {
  return `${projectId} ${format}`;
}

function withoutCost(totals: Totals) {
  return shown(totals, false);
}
