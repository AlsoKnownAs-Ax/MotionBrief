import { CircleAlertIcon, CircleCheckIcon, DownloadIcon, FolderOpenIcon, XIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import type { ExportStage } from "../../../contract";
import { useExport, type ExportJob, type ExportJobError } from "./export";
import { isGenerating, useGeneration } from "./generation";
import { useOpenVideo } from "./open-video";

const STAGE_LABELS = {
  preparing: "Preparing",
  capturing: "Rendering",
  encoding: "Encoding",
  finishing: "Finishing",
} satisfies Record<ExportStage, string>;

const ERROR_MESSAGES = {
  CHROME_MISSING: "The browser MotionBrief renders with is missing. Reinstall MotionBrief.",
  FFMPEG_MISSING: "FFmpeg is missing. Reinstall MotionBrief.",
  RENDER_FAILED: "The video couldn't be rendered.",
  SAVE_FAILED: "The MP4 couldn't be saved there. Try another folder.",
  UPDATING: "MotionBrief is restarting to update. Export again once it reopens.",
  UNEXPECTED: "The export stopped unexpectedly.",
} satisfies Record<ExportJobError["code"], string>;

/** What the error's tooltip adds: the producer's message or the path involved. */
function errorDetail(error: ExportJobError) {
  if ("message" in error) {
    return error.message;
  }

  if ("path" in error) {
    return error.path;
  }

  return undefined;
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

/** The editor's Export MP4 button, and the export's progress, outcome and Cancel while one runs. */
export function ExportControl() {
  const job = useExport((state) => state.job);
  const { start, cancel, dismiss } = useExport();
  const hasVideo = useOpenVideo((state) => state.preview !== undefined);
  // A video still being generated isn't complete yet.
  const isWriting = useGeneration((state) => isGenerating(state.status));

  if (job.state === "rendering") {
    const percent = Math.round((job.progress ?? 0) * 100);

    return (
      <div role="status" className="no-drag-region flex items-center gap-3" title={`Exporting to ${job.path ?? ""}`}>
        <div className="flex w-[200px] flex-col gap-[5px]">
          <span className="flex justify-between gap-2 text-app-xs">
            <span className="truncate">
              Exporting MP4<span className="text-ink-muted"> · {STAGE_LABELS[job.stage ?? "preparing"]}</span>
            </span>
            <span className="text-ink-muted tabular-nums">{percent}%</span>
          </span>
          <Progress value={percent} aria-label="Export progress" />
        </div>
        <Button size="sm" onClick={cancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="no-drag-region flex items-center gap-2">
      <ExportOutcome job={job} onDismiss={dismiss} />
      <Button variant="primary" size="sm" disabled={!hasVideo || isWriting} onClick={() => void start()}>
        <DownloadIcon />
        Export MP4
      </Button>
    </div>
  );
}

function ExportOutcome({ job: { state, path, error }, onDismiss }: { job: ExportJob; onDismiss: () => void }) {
  if (state === "done" && path) {
    return (
      <span role="status" className="flex items-center gap-1 text-app-xs text-status-success">
        <CircleCheckIcon className="size-3.5" />
        <span className="max-w-[200px] truncate" title={path}>
          Exported {fileName(path)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Show in folder" title="Show in folder" onClick={() => window.motionbrief.showInFolder(path)}>
          <FolderOpenIcon />
        </Button>
        <DismissButton onClick={onDismiss} />
      </span>
    );
  }

  if (state === "failed" && error) {
    return (
      <span role="alert" className="flex items-center gap-1 text-app-xs text-status-fallback-ink">
        <CircleAlertIcon className="size-3.5" />
        <span className="max-w-[280px] truncate" title={errorDetail(error)}>
          {ERROR_MESSAGES[error.code]}
        </span>
        <DismissButton onClick={onDismiss} />
      </span>
    );
  }

  return null;
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" onClick={onClick}>
      <XIcon />
    </Button>
  );
}
