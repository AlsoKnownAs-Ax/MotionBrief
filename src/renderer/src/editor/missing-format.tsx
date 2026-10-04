import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, FilmIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { useRequireClaude } from "@renderer/claude/connection";
import { core, orpc } from "@renderer/core/connection";
import { estimateLine, generateErrorMessage } from "@renderer/new-project/generate-bar";
import { cn } from "@renderer/lib/utils";
import type { VideoRef } from "../../../contract";
import { FORMAT_LABELS } from "./labels";

const OTHER = { horizontal: "vertical", vertical: "horizontal" } as const;

/**
 * A Format the Project has no video in yet: what generating it means, what it will take, and Generate. The new
 * video is a generation of its own from the same Transcript, drawn in the other video's current Style Preset.
 */
export function MissingFormat({ video }: { video: VideoRef }) {
  const label = FORMAT_LABELS[video.format];
  const otherLabel = FORMAT_LABELS[OTHER[video.format]];
  const { data: estimate } = useQuery(orpc.video.estimate.queryOptions({ input: video }));
  const requireClaude = useRequireClaude();
  // The generation stream the editor follows takes over once it starts.
  const generate = useMutation({ mutationFn: () => core.video.generate(video) });

  return (
    <main className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-[52ch] flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-md border border-hairline bg-surface-1 text-ink-muted",
            video.format === "vertical" ? "h-16 w-9" : "h-9 w-16",
          )}
        >
          <FilmIcon className="size-4" />
        </span>
        <h2 className="text-app-title font-medium">No {label} video yet</h2>
        <p className="text-app-sm text-ink-muted">
          Generate one from the same Transcript and Style Preset. Its Scenes are laid out again for {video.format}, and the {otherLabel} video doesn&rsquo;t
          change.
          {video.format === "vertical" ? " Captions are on." : " Captions are off."}
        </p>
        <p className="text-app-xs text-ink-muted">{estimate ? estimateLine(estimate) : "Estimating the time this takes…"}</p>
        {generate.error ? (
          <p role="alert" className="flex items-center gap-1.5 text-app-xs text-status-fallback-ink">
            <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {generateErrorMessage(generate.error)}
          </p>
        ) : null}
        <Button variant="primary" disabled={generate.isPending || generate.isSuccess} onClick={() => requireClaude(() => generate.mutate())}>
          Generate the {label} version
        </Button>
      </div>
    </main>
  );
}
