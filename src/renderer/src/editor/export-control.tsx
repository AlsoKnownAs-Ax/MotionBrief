import { CircleAlertIcon, CircleCheckIcon, DownloadIcon, FolderOpenIcon, XIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import type { ExportStatus } from "../../../contract";
import { useExport, type ExportJob } from "./export";
import { isGenerating, useGeneration } from "./generation";
import { useOpenVideo } from "./open-video";

const STAGE_LABELS = {
  preparing: "Preparing",
  capturing: "Rendering",
  encoding: "Encoding",
  finishing: "Finishing",
} satisfies Record<Extract<ExportStatus, { state: "rendering" }>["stage"], string>;

const ERROR_MESSAGES = {
  CHROME_MISSING: "The browser MotionBrief renders with is missing. Reinstall MotionBrief.",
  FFMPEG_MISSING: "FFmpeg is missing. Reinstall MotionBrief.",
  RENDER_FAILED: "The video couldn't be rendered.",
  SAVE_FAILED: "The MP4 couldn't be saved there. Try another folder.",
  UNEXPECTED: "The export stopped unexpectedly.",
} satisfies Record<Extract<ExportJob, { state: "failed" }>["error"]["code"], string>;

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
    const percent = Math.round(job.progress * 100);

    return (
      <div role="status" className="no-drag-region flex items-center gap-3" title={`Exporting to ${job.path}`}>
        <div className="flex w-[200px] flex-col gap-[5px]">
          <span className="flex justify-between gap-2 text-app-xs">
            <span className="truncate">
              Exporting MP4<span className="text-ink-muted"> · {STAGE_LABELS[job.stage]}</span>
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

function ExportOutcome({ job, onDismiss }: { job: ExportJob; onDismiss: () => void }) {
  if (job.state === "done") {
    return (
      <span role="status" className="flex items-center gap-1 text-app-xs text-status-success">
        <CircleCheckIcon className="size-3.5" />
        <span className="max-w-[200px] truncate" title={job.path}>
          Exported {fileName(job.path)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Show in folder" title="Show in folder" onClick={() => window.motionbrief.showInFolder(job.path)}>
          <FolderOpenIcon />
        </Button>
        <DismissButton onClick={onDismiss} />
      </span>
    );
  }

  if (job.state === "failed") {
    const detail = "message" in job.error ? job.error.message : job.error.path;

    return (
      <span role="alert" className="flex items-center gap-1 text-app-xs text-status-fallback-ink">
        <CircleAlertIcon className="size-3.5" />
        <span className="max-w-[280px] truncate" title={detail}>
          {ERROR_MESSAGES[job.error.code]}
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
