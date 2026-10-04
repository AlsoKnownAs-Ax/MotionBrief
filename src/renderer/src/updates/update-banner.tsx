import { useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { useUpdateState } from "./update";

/**
 * A quiet strip once an update has downloaded. Restarting waits for every export to finish; dismissed, the
 * update installs the next time MotionBrief quits.
 */
export function UpdateBanner() {
  const { data: update } = useUpdateState();
  const [dismissedVersion, setDismissedVersion] = useState<string>();

  if (!update?.readyVersion || update.readyVersion === dismissedVersion) {
    return null;
  }

  const { readyVersion, isExporting } = update;

  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-3 border-b border-hairline-soft bg-surface-1 px-4 text-app-sm">
      <span className="flex-1 text-ink-muted">
        {isExporting ? `MotionBrief ${readyVersion} is ready. Restart once your export finishes.` : `MotionBrief ${readyVersion} is ready.`}
      </span>
      <Button variant="ghost" size="sm" onClick={() => setDismissedVersion(readyVersion)}>
        Later
      </Button>
      <Button size="sm" disabled={isExporting} onClick={() => void window.motionbrief.restartToUpdate()}>
        Restart to update
      </Button>
    </div>
  );
}
