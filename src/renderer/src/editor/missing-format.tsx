import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, FilmIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { useRequireClaude } from "@renderer/claude/connection";
import { core, orpc } from "@renderer/core/connection";
import { costLabel, estimateLine, generateErrorMessage, isApprovalRequest } from "@renderer/new-project/generate-bar";
import { cn } from "@renderer/lib/utils";
import type { CostRange, Format, GenerationEstimate, VideoRef } from "../../../contract";
import { FORMAT_LABELS } from "./labels";

const OTHER = { horizontal: "vertical", vertical: "horizontal" } as const satisfies Record<Format, Format>;

/** The empty frame's shape, in the Format's aspect. */
const FRAME_SHAPE = { horizontal: "h-9 w-16", vertical: "h-16 w-9" } satisfies Record<Format, string>;

/** As the core defaults them, until the creator turns Captions on or off. */
const CAPTIONS_BY_DEFAULT = { horizontal: false, vertical: true } satisfies Record<Format, boolean>;

function captionsLine(captions: boolean) {
  if (captions) {
    return "Captions are on.";
  }

  return "Captions are off.";
}

function estimateText(estimate: GenerationEstimate | undefined) {
  if (!estimate) {
    return "Estimating the time this takes…";
  }

  return estimateLine(estimate);
}

/**
 * A Format the Project has no video in yet: what generating it means, what it will take, and Generate. The new
 * video is a generation of its own from the same Transcript, drawn in the other video's current Style Preset.
 */
export function MissingFormat({ video, captions }: { video: VideoRef; captions?: boolean }) {
  const label = FORMAT_LABELS[video.format];
  const otherLabel = FORMAT_LABELS[OTHER[video.format]];
  const { data: estimate } = useQuery(orpc.video.estimate.queryOptions({ input: video }));
  const requireClaude = useRequireClaude();
  const [approving, setApproving] = useState<CostRange>();
  // The generation stream the editor follows takes over once it starts.
  const generate = useMutation({
    mutationFn: (approved: boolean) => core.video.generate({ ...video, approved }),
    onError: (error) => {
      // The estimate was older than the approval setting: ask now.
      if (error instanceof ORPCError && error.code === "APPROVAL_REQUIRED") {
        setApproving((error.data as { costUsd: CostRange }).costUsd);
      }
    },
  });

  // On an API key with "Approve cost before running" on, Generate first asks the creator to approve the estimate.
  function pressGenerate() {
    if (estimate?.needsApproval && estimate.costUsd) {
      setApproving(estimate.costUsd);
      return;
    }

    generate.mutate(false);
  }

  function approve() {
    setApproving(undefined);
    requireClaude(() => generate.mutate(true));
  }

  return (
    <main className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-[52ch] flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className={cn("flex items-center justify-center rounded-md border border-hairline bg-surface-1 text-ink-muted", FRAME_SHAPE[video.format])}>
          <FilmIcon className="size-4" />
        </span>
        <h2 className="text-app-title font-medium">No {label} video yet</h2>
        <p className="text-app-sm text-ink-muted">
          Generate one from the same Transcript and Style Preset. Its Scenes are laid out again for {video.format}, and the {otherLabel} video doesn&rsquo;t
          change. {captionsLine(captions ?? CAPTIONS_BY_DEFAULT[video.format])}
        </p>
        <p className="text-app-xs text-ink-muted">{estimateText(estimate)}</p>
        {generate.error && !isApprovalRequest(generate.error) ? (
          <p role="alert" className="flex items-center gap-1.5 text-app-xs text-status-fallback-ink">
            <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {generateErrorMessage(generate.error)}
          </p>
        ) : null}
        {approving ? (
          <div role="group" aria-labelledby="approve-format-cost" className="flex flex-col items-center gap-2">
            <p id="approve-format-cost" className="text-app-sm">
              Approve about {costLabel(approving)} on your API key for this generation?
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setApproving(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" autoFocus disabled={generate.isPending} onClick={approve}>
                Approve and generate
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" disabled={generate.isPending || generate.isSuccess} onClick={() => requireClaude(pressGenerate)}>
            Generate the {label} version
          </Button>
        )}
      </div>
    </main>
  );
}
