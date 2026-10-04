import { RotateCcwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { useOpenVideo } from "./open-video";
import { useFrameUpdate } from "./stored-video";

/**
 * One strip across the editor after an app update changed the Scene frame: the Scenes whose code no longer passes
 * its checks play as flagged fallbacks, and nothing is regenerated until the creator retries them.
 */
export function FrameUpdateNotice() {
  const notice = useFrameUpdate((state) => state.notice);
  const retryError = useFrameUpdate((state) => state.retryError);
  const retry = useFrameUpdate((state) => state.retry);
  const dismiss = useFrameUpdate((state) => state.dismiss);
  const projectId = useOpenVideo((state) => state.projectId);
  const timeline = useOpenVideo((state) => state.preview?.timeline);

  if (!notice || notice.video.projectId !== projectId || timeline?.format !== notice.video.format) {
    return null;
  }

  const scenes = timeline.scenes.filter((scene) => notice.units.includes(scene.unit) && scene.status === "fallback");
  const count = scenes.length;

  if (count === 0) {
    return null;
  }

  const units = [...new Set(scenes.map((scene) => scene.unit))];
  const scenesLabel = count === 1 ? "1 Scene" : `${count} Scenes`;

  return (
    <div role="status" className="flex min-h-9 shrink-0 items-center gap-3 border-b border-hairline-soft bg-status-flagged-tint px-4 py-1.5 text-app-sm">
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-status-flagged" />
      <p className="min-w-0 flex-1">
        <span>This version of MotionBrief updated the Scene frame.</span>{" "}
        <span className="text-ink-muted">
          {count === 1 ? "1 Scene no longer passes its checks, so it plays as a fallback until you retry." : `${count} Scenes no longer pass its checks, so they play as fallbacks until you retry.`}
        </span>
        {retryError && <span className="text-status-fallback-ink"> {retryError}</span>}
      </p>
      <Button size="sm" onClick={() => void retry(units)}>
        <RotateCcwIcon aria-hidden="true" />
        Retry {scenesLabel}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <XIcon />
      </Button>
    </div>
  );
}
