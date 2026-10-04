import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, ClockIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { useClaudeStatus, useRequireClaude } from "@renderer/claude/connection";
import { core, orpc } from "@renderer/core/connection";
import { FORMAT_LABELS } from "@renderer/editor/labels";
import type { CostRange, GenerationEstimate, Project, TranscriptionStatus } from "../../../contract";
import { projectErrorMessage } from "./project-errors";

type GenerateBarProps = {
  project: Project;
  transcription?: TranscriptionStatus;
  /** Generation started: the editor takes the Project over. */
  onGenerating: () => void;
};

/**
 * The New Project footer: what generating will take, then Generate, which waits for that estimate. Nothing is
 * generated until it's pressed; pressed while Claude isn't connected, it opens the Connect step instead. On an API key
 * with "Approve cost before running" on, Generate first asks the creator to approve the estimated cost.
 */
export function GenerateBar({ project, transcription, onGenerating }: GenerateBarProps) {
  const video = { projectId: project.id, format: project.format };
  const { data: estimate, error: estimateError, refetch, isFetching } = useQuery(orpc.video.estimate.queryOptions({ input: video }));
  const { data: connection } = useClaudeStatus();
  const requireClaude = useRequireClaude();
  const [approving, setApproving] = useState<CostRange>();
  const generate = useMutation({
    mutationFn: (approved: boolean) => core.video.generate({ ...video, approved }),
    onSuccess: onGenerating,
    onError: (error) => {
      // The estimate was older than the approval setting: ask now.
      if (error instanceof ORPCError && error.code === "APPROVAL_REQUIRED") {
        setApproving((error.data as { costUsd: CostRange }).costUsd);
      }
    },
  });
  const isTranscribed = transcription?.state === "done";

  function pressGenerate() {
    if (estimate?.needsApproval && estimate.costUsd) {
      setApproving(estimate.costUsd);
      return;
    }

    generate.mutate(false);
  }

  if (approving) {
    return (
      <footer role="group" aria-labelledby="approve-cost" className="flex h-14 shrink-0 items-center gap-3 border-t border-hairline-soft px-5">
        <ClockIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        <span id="approve-cost" className="min-w-0 flex-1 truncate text-app-sm">
          Approve about {costLabel(approving)} on your API key for this generation?
        </span>
        <Button size="sm" onClick={() => setApproving(undefined)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={generate.isPending}
          autoFocus
          onClick={() => {
            setApproving(undefined);
            requireClaude(() => generate.mutate(true));
          }}
        >
          Approve and generate
        </Button>
      </footer>
    );
  }

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-hairline-soft px-5">
      <ClockIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      {estimateError && !estimate ? (
        <span role="alert" className="flex min-w-0 flex-1 items-center gap-1.5 text-app-sm text-status-fallback-ink">
          <span className="truncate">Couldn't estimate the time this takes, so Generate waits. {projectErrorMessage(estimateError)}</span>
          <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>
            Try again
          </Button>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-app-sm text-ink-muted">{estimate ? estimateLine(estimate) : "Estimating the time this takes."}</span>
      )}
      {generate.error && !isApprovalRequest(generate.error) ? (
        <span role="alert" className="flex min-w-0 items-center gap-1.5 text-app-xs text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{generateErrorMessage(generate.error)}</span>
        </span>
      ) : null}
      {!generate.error && !isTranscribed ? <span className="text-app-xs text-ink-muted">Generate unlocks when the Transcript is done</span> : null}
      {!generate.error && isTranscribed && !connection?.isConnected ? <span className="text-app-xs text-ink-muted">Connect Claude to generate</span> : null}
      <Button variant="primary" disabled={!estimate || !isTranscribed || generate.isPending} onClick={() => requireClaude(pressGenerate)}>
        Generate {FORMAT_LABELS[project.format]} video
      </Button>
    </footer>
  );
}

function costLabel({ low, high }: CostRange) {
  return `$${low.toFixed(2)}-$${high.toFixed(2)}`;
}

function estimateLine({ minutes, costUsd, needsApproval }: GenerationEstimate) {
  const time = `About ${minutes.low}-${minutes.high} minutes`;

  if (costUsd) {
    return `${time} and ${costLabel(costUsd)} with the models in Settings.${needsApproval ? " You approve before it starts." : ""}`;
  }

  return `${time} with the models in Settings. It counts against your plan's usage limits.`;
}

function isApprovalRequest(error: unknown) {
  return error instanceof ORPCError && error.code === "APPROVAL_REQUIRED";
}

const GENERATE_MESSAGES: Record<string, string> = {
  GENERATING: "This video is already being generated.",
  ALREADY_GENERATED: "This video is already generated.",
  UNKNOWN_STYLE_PRESET: "This Style Preset isn't available any more. Pick another one.",
  TRANSCRIPT_NOT_READY: "Generate unlocks when the Transcript is done.",
};

function generateErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in GENERATE_MESSAGES) {
    return GENERATE_MESSAGES[error.code];
  }

  return projectErrorMessage(error);
}
