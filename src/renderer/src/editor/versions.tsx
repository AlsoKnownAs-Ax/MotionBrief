import { ORPCError, safe } from "@orpc/client";
import { HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { core } from "@renderer/core/connection";
import { cn } from "@renderer/lib/utils";
import type { VersionOrigin, VersionSummary } from "../../../contract";
import { isGenerating, useGeneration } from "./generation";
import { isRevising, useRevision } from "./revision";

/** The Versions tab: the open video's Versions, newest first, each but the current one with Restore. */
export function Versions() {
  const video = useGeneration((state) => state.video);
  const current = useGeneration((state) => state.stored?.version);
  const generating = useGeneration((state) => isGenerating(state.status));
  const revising = useRevision((state) => isRevising(state.status));
  const reopen = useGeneration((state) => state.reopen);
  const [versions, setVersions] = useState<VersionSummary[]>();
  const [error, setError] = useState<string>();
  const [restoring, setRestoring] = useState<number>();
  const isBusy = generating || revising || restoring !== undefined;

  // Listed again whenever the video plays a newer Version.
  useEffect(() => {
    if (!video) {
      return;
    }

    let isCurrent = true;
    void safe(core.video.versions(video)).then(({ data, error: listError }) => {
      if (!isCurrent) {
        return;
      }

      setVersions(data ?? undefined);
      setError(listError ? "The Versions couldn't be read from the Project folder." : undefined);
    });

    return () => {
      isCurrent = false;
    };
  }, [video, current]);

  async function restore(version: number) {
    if (!video) {
      return;
    }

    setRestoring(version);
    setError(undefined);
    const { error: restoreError } = await safe(core.video.restore({ ...video, version }));
    setRestoring(undefined);

    if (restoreError) {
      setError(restoreErrorMessage(restoreError));
      return;
    }

    reopen();
  }

  if (!versions?.length) {
    return (
      <div className="m-auto flex max-w-[260px] flex-col items-center gap-2 px-3 py-6 text-center">
        <HistoryIcon className="size-5 text-ink-muted" aria-hidden="true" />
        <p className="text-app-sm font-medium">No Versions yet</p>
        <p className="text-app-xs leading-[1.45] text-ink-muted">{error ?? "Version 1 is saved when the first generation finishes or stops."}</p>
      </div>
    );
  }

  const newest = versions[0]?.version;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
      <p className="text-app-xs text-ink-muted">Restoring saves a new Version, so nothing is lost.</p>
      {error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {error}
        </p>
      ) : null}
      <ol aria-label="Versions" className="flex flex-col gap-0.5">
        {versions.map((version) => (
          <li
            key={version.version}
            className={cn("flex min-h-10 items-center gap-2.5 rounded-[10px] py-1 pr-1.5 pl-2.5 hover:bg-surface-1", version.version === newest && "bg-surface-2 hover:bg-surface-2")}
          >
            <span className="shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-app-xs font-medium tabular-nums">v{version.version}</span>
            <span className="min-w-0 flex-1 truncate text-app-sm" title={versionLabel(version)}>
              {versionLabel(version)}
            </span>
            <span className="shrink-0 text-app-xs text-ink-muted tabular-nums">{timeOf(version.createdAt)}</span>
            {version.version === newest ? (
              <span className="shrink-0 text-app-xs text-ink-muted">Current</span>
            ) : (
              <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => void restore(version.version)} aria-label={`Restore Version ${version.version}`}>
                <HistoryIcon />
                Restore
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What made each kind of Version, as the list says it. */
const ORIGIN_LABELS = {
  generation: () => "First generation",
  "frame-update": () => "Re-checked after an app update",
  retry: () => "Retried flagged Scenes",
  revision: ({ request }) => `Revision: “${request ?? ""}”`,
  restore: ({ restoredFrom }) => `Restored Version ${restoredFrom}`,
} satisfies Record<VersionOrigin, (version: VersionSummary) => string>;

function versionLabel(version: VersionSummary) {
  return ORIGIN_LABELS[version.origin](version);
}

/** "15:27" today, otherwise the date too. */
function timeOf(createdAt: string) {
  const at = new Date(createdAt);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (at.toDateString() === new Date().toDateString()) {
    return time;
  }

  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const RESTORE_ERRORS: Record<string, string> = {
  BUSY: "Wait for the run going now to finish, or stop it, then restore.",
  UNKNOWN_VERSION: "That Version isn't in the Project folder any more.",
  INVALID_VERSION: "That Version's file in the Project is damaged, so it can't be restored.",
  UNKNOWN_PROJECT: "This Project was closed. Go back to Home and open it again.",
};

function restoreErrorMessage(error: unknown) {
  if (!(error instanceof ORPCError) || !error.defined) {
    return "Something went wrong talking to the MotionBrief core. Try again.";
  }

  return RESTORE_ERRORS[error.code] ?? `Couldn't restore the Version: ${error.message}`;
}
