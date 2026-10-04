import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSettingsDialog } from "@renderer/components/settings-dialog";
import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { Progress } from "@renderer/components/ui/progress";
import { orpc } from "@renderer/core/connection";
import type { AuthMethod, PlanWindow, Settings, UsageStatus, UsageTotals, VideoRef } from "../../../contract";
import { amountLabel, dollars, modelLabel, percent, resetsLabel, ROLE_LABELS, ROLES, totalsLabel, WINDOW_LABELS, windowUsedLabel } from "./labels";
import { useUsage } from "./usage";

/** A window this full is close to stopping runs. */
const NEARLY_FULL = 80;

/**
 * The title bar's usage control, always visible: what the current run (or the video, or today) costs on an API key,
 * or how full the plan's 5-hour window is on a subscription. Its details list usage per model role and the totals.
 */
export function UsageControl({ video }: { video?: VideoRef }) {
  const status = useUsage(video);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Usage details"
          className="no-drag-region flex h-control-sm items-center gap-2 rounded-pill border border-hairline px-3 text-app-sm whitespace-nowrap outline-none transition-colors hover:bg-surface-1 focus-visible:shadow-[0_0_0_1px_var(--brand)]"
        >
          <Summary status={status} />
          <ChevronDownIcon aria-hidden="true" className="size-3.5 text-ink-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" aria-label="Usage">
        <Details status={status} />
      </PopoverContent>
    </Popover>
  );
}

function Summary({ status }: { status: UsageStatus | undefined }) {
  if (!status) {
    return <span className="text-ink-muted">Usage</span>;
  }

  if (status.method === "subscription") {
    const fiveHour = status.plan.find(({ window }) => window === "five-hour");
    const used = percent(fiveHour?.utilization);

    if (used === undefined) {
      return <span className="text-ink-muted">Plan usage</span>;
    }

    return (
      <>
        <span className="text-app-xs text-ink-muted">5-hour window</span>
        <Progress value={used} status={windowStatus(used)} className="w-14" aria-label="5-hour window used" />
        <span className="tabular-nums">{used}%</span>
      </>
    );
  }

  const { totals, note } = summaryOf(status);

  return (
    <>
      <span className="tabular-nums">{amountLabel(totals)}</span>
      <span className="text-app-xs text-ink-muted tabular-nums">{note}</span>
    </>
  );
}

/** A window this full shows amber. */
function windowStatus(used: number) {
  if (used >= NEARLY_FULL) {
    return "flagged";
  }

  return "neutral";
}

/** The most current usage there is: the video's run, else the video's totals, else today's; and what it is out of. */
function summaryOf({ run, video, today }: UsageStatus): { totals: UsageTotals; note: string } {
  if (run?.capUsd !== undefined) {
    return { totals: run.total, note: `of ${dollars(run.capUsd)} cap` };
  }

  if (run) {
    return { totals: run.total, note: RUN_SCOPES[run.state] };
  }

  if (video) {
    return { totals: video, note: "this video" };
  }

  return { totals: today, note: "today" };
}

const RUN_SCOPES = {
  running: "this run",
  finished: "last run",
  capped: "last run",
} satisfies Record<NonNullable<UsageStatus["run"]>["state"], string>;

const CONNECTION_TITLES = {
  subscription: "Claude subscription",
  "api-key": "Anthropic API key",
} satisfies Record<AuthMethod, string>;

function connectionTitle(method: AuthMethod | undefined) {
  if (!method) {
    return "Usage";
  }

  return CONNECTION_TITLES[method];
}

function approvalLabel(settings: Settings) {
  if (!settings.approveCost) {
    return "Off";
  }

  return "Before each first generation";
}

function capLabel(settings: Settings) {
  if (settings.costCapUsd === undefined) {
    return "None";
  }

  return `${dollars(settings.costCapUsd)} per run`;
}

function Details({ status }: { status: UsageStatus | undefined }) {
  const { data: settings } = useQuery(orpc.settings.get.queryOptions());
  const openSettings = () => useSettingsDialog.getState().setIsOpen(true);
  const isSubscription = status?.method === "subscription";

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-app-sm font-medium">{connectionTitle(status?.method)}</h2>
      {status?.run ? <RunDetails run={status.run} /> : null}
      <dl className="flex flex-col">
        {status?.video ? <Line label="This video">{totalsLabel(status.video)}</Line> : null}
        {status ? <Line label="Today">{totalsLabel(status.today)}</Line> : null}
        {isSubscription ? <PlanWindows windows={status.plan} /> : null}
        {status?.method === "api-key" && settings ? (
          <>
            <Line label="Approval">{approvalLabel(settings)}</Line>
            <Line label="Cap">{capLabel(settings)}</Line>
          </>
        ) : null}
      </dl>
      {isSubscription ? <p className="text-app-xs text-ink-muted">Plan limits only. Claude doesn't report dollar costs for subscription logins.</p> : null}
      {settings ? (
        <dl className="flex flex-col border-t border-hairline-soft pt-2">
          {ROLES.map((role) => (
            <Line key={role} label={ROLE_LABELS[role]}>
              {modelLabel(settings.models[role])}
            </Line>
          ))}
        </dl>
      ) : null}
      <Button variant="ghost" size="sm" className="self-start" onClick={openSettings}>
        Change models in Settings
      </Button>
    </div>
  );
}

function RunDetails({ run }: { run: NonNullable<UsageStatus["run"]> }) {
  return (
    <section aria-label="This run" className="flex flex-col gap-1 rounded-md bg-surface-1 p-2.5">
      <p className="flex justify-between gap-2 text-app-xs">
        <span className="font-medium">{RUN_LABELS[run.state]}</span>
        <span className="text-ink-muted tabular-nums">{totalsLabel(run.total)}</span>
      </p>
      {run.state === "capped" && run.capUsd !== undefined ? (
        <p className="text-app-xs text-status-flagged">Stopped at your {dollars(run.capUsd)} cap. Finished Scenes were kept.</p>
      ) : null}
      {run.roles.length === 0 ? <p className="text-app-xs text-ink-muted">No agent has reported usage yet.</p> : null}
      <dl className="flex flex-col">
        {run.roles.map((role) => (
          <Line key={role.role} label={`${ROLE_LABELS[role.role]} · ${modelLabel(role.model)}`}>
            {totalsLabel(role)}
          </Line>
        ))}
      </dl>
    </section>
  );
}

const RUN_LABELS = {
  running: "This run",
  finished: "Last run",
  capped: "Last run",
} satisfies Record<NonNullable<UsageStatus["run"]>["state"], string>;

function PlanWindows({ windows }: { windows: PlanWindow[] }) {
  if (windows.length === 0) {
    return <Line label="Plan windows">Shown once a run reports them</Line>;
  }

  return windows.map(({ window, utilization, resetsAt, isRejected }) => {
    const parts = [windowUsedLabel(utilization, isRejected), resetsLabel(resetsAt)].filter(Boolean);

    return (
      <Line key={window} label={WINDOW_LABELS[window]}>
        {parts.join(" · ")}
      </Line>
    );
  });
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 text-app-xs">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
