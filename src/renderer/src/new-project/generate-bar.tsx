import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, ClockIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { useClaudeStatus, useRequireClaude } from "@renderer/claude/connection";
import { core, orpc } from "@renderer/core/connection";
import { FORMAT_LABELS } from "@renderer/editor/labels";
import type { GenerationEstimate, Project, TranscriptionStatus } from "../../../contract";
import { projectErrorMessage } from "./project-errors";

type GenerateBarProps = {
  project: Project;
  transcription?: TranscriptionStatus;
  /** Generation started: the editor takes the Project over. */
  onGenerating: () => void;
};

/**
 * The New Project footer: what generating will take, then Generate. Nothing is generated until it's pressed;
 * pressed while Claude isn't connected, it opens the Connect step instead.
 */
export function GenerateBar({ project, transcription, onGenerating }: GenerateBarProps) {
  const video = { projectId: project.id, format: project.format };
  const { data: estimate } = useQuery(orpc.video.estimate.queryOptions({ input: video }));
  const { data: connection } = useClaudeStatus();
  const requireClaude = useRequireClaude();
  const generate = useMutation({ mutationFn: () => core.video.generate(video), onSuccess: onGenerating });
  const isTranscribed = transcription?.state === "done";

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-hairline-soft px-5">
      <ClockIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1 truncate text-app-sm text-ink-muted">{estimate ? estimateLine(estimate) : null}</span>
      {generate.error ? (
        <span role="alert" className="flex min-w-0 items-center gap-1.5 text-app-xs text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{generateErrorMessage(generate.error)}</span>
        </span>
      ) : null}
      {!generate.error && !isTranscribed ? <span className="text-app-xs text-ink-muted">Generate unlocks when the Transcript is done</span> : null}
      {!generate.error && isTranscribed && !connection?.isConnected ? <span className="text-app-xs text-ink-muted">Connect Claude to generate</span> : null}
      <Button variant="primary" disabled={!isTranscribed || generate.isPending} onClick={() => requireClaude(() => generate.mutate())}>
        Generate {FORMAT_LABELS[project.format]} video
      </Button>
    </footer>
  );
}

function estimateLine({ minutes, costUsd }: GenerationEstimate) {
  const time = `About ${minutes.low}–${minutes.high} minutes`;

  if (costUsd) {
    return `${time} and $${costUsd.low.toFixed(2)}–$${costUsd.high.toFixed(2)} with the default models.`;
  }

  return `${time} with the default models. It counts against your plan’s usage limits.`;
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
