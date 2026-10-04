import { CircleAlertIcon, CirclePauseIcon, HouseIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useEffect, useState } from "react";
import { ConnectClaude } from "@renderer/claude/connect-claude";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Progress } from "@renderer/components/ui/progress";
import { FrameUpdateNotice } from "@renderer/editor/frame-update-notice";
import { generationErrorMessage, stopHeadline, useGeneration } from "@renderer/editor/generation";
import { DEFAULT_LAYOUT, PANE_LIMITS, useEditorLayout } from "@renderer/editor/layout";
import { FORMAT_LABELS } from "@renderer/editor/labels";
import { MissingFormat } from "@renderer/editor/missing-format";
import { useOpenVideo } from "@renderer/editor/open-video";
import { usePlayback } from "@renderer/editor/playback";
import { Player, Transport } from "@renderer/editor/player";
import { SidePanel } from "@renderer/editor/side-panel";
import { Splitter } from "@renderer/editor/splitter";
import { Timeline } from "@renderer/editor/timeline";
import { useNavigation } from "@renderer/navigation";
import type { Format, GenerationStatus, GenerationStop } from "../../../contract";

/** The editor's part of the title bar: back to Home, the Project's name, its Formats and the video's generation. */
export function EditorToolbar() {
  const projectName = useOpenVideo((state) => state.projectName);
  const openHome = useNavigation((state) => state.openHome);
  const leave = useGeneration((state) => state.leave);

  function goHome() {
    leave();
    openHome();
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="h-5 w-px bg-hairline" />
      <Button variant="ghost" size="icon-sm" className="no-drag-region" aria-label="Home" title="Home" onClick={goHome}>
        <HouseIcon />
      </Button>
      <h1 className="min-w-0 truncate text-app-body font-medium">{projectName}</h1>
      <FormatTabs />
      <GenerationBadge />
    </div>
  );
}

/** A Project has at most one video in each Format: the tabs switch between them, or to the Generate empty state. */
function FormatTabs() {
  const format = useGeneration((state) => state.video?.format);
  const showFormat = useGeneration((state) => state.showFormat);

  if (!format) {
    return null;
  }

  return (
    <RadioGroup.Root
      aria-label="Format"
      value={format}
      onValueChange={(value) => showFormat(value as Format)}
      orientation="horizontal"
      className="no-drag-region flex shrink-0 gap-0.5 rounded-pill border border-hairline-soft bg-surface-1 p-[3px]"
    >
      {FORMATS.map((option) => (
        <RadioGroup.Item
          key={option}
          value={option}
          className="h-[24px] rounded-pill px-2.5 text-app-xs font-medium text-ink-muted tabular-nums outline-none transition-colors hover:text-ink focus-visible:shadow-[0_0_0_1px_var(--brand)] data-[state=checked]:bg-surface-3 data-[state=checked]:text-ink"
        >
          {FORMAT_LABELS[option]}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

const FORMATS = ["horizontal", "vertical"] as const satisfies Format[];

/** The job status: the run's progress and Stop while it runs, and its failure. The Scenes carry their own badges. */
function GenerationBadge() {
  const status = useGeneration((state) => state.status);
  const isStopping = useGeneration((state) => state.isStopping);
  const stop = useGeneration((state) => state.stop);

  if (status?.state === "planning" || status?.state === "writing") {
    return (
      <div className="no-drag-region flex min-w-0 items-center gap-2.5 pl-1">
        <div role="status" className="flex w-[200px] min-w-[120px] flex-col gap-[5px]">
          <span className="flex items-center gap-1.5 text-app-xs">
            <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-status-working" />
            <span className="truncate">{jobLabel(status, isStopping)}</span>
          </span>
          <Progress value={jobPercent(status)} aria-label="Generation progress" />
        </div>
        <Button size="sm" disabled={isStopping} onClick={() => void stop()} title="Stop: finished Scenes are kept, the rest play as fallbacks">
          <SquareIcon />
          Stop
        </Button>
      </div>
    );
  }

  if (status?.state === "failed") {
    return (
      <Badge role="status" status="fallback">
        Generation failed
      </Badge>
    );
  }

  return null;
}

function finishedUnits({ units }: GenerationStatus) {
  return units.filter(({ status }) => status === "ready" || status === "flagged" || status === "fallback").length;
}

function jobLabel(status: GenerationStatus, isStopping: boolean) {
  if (isStopping) {
    return "Stopping, saving finished Scenes";
  }

  if (status.state === "planning") {
    return "Planning the Storyboard";
  }

  return `Writing Scenes · ${finishedUnits(status)} of ${status.units.length}`;
}

/** A Storyboard counts as the first tenth of the run. */
function jobPercent(status: GenerationStatus) {
  if (status.state === "planning") {
    return 4;
  }

  return Math.round(10 + (90 * finishedUnits(status)) / Math.max(status.units.length, 1));
}

/** The window's size, for the panes' limits. */
function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  return size;
}

/** Space plays and pauses, unless a field, button or slider has the key. */
function useSpaceToPlay() {
  const togglePlay = usePlayback((state) => state.togglePlay);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (event.key !== " " || event.repeat || target?.closest("input, textarea, button, select, [role=slider], [contenteditable]")) {
        return;
      }

      event.preventDefault();
      togglePlay();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);
}

/**
 * The editor (Variant A): the player and its transport in the centre, the Chat / Style / Versions
 * panel on the right and the Scene timeline below, with panes resized by their dividers.
 */
export function Editor() {
  const preview = useOpenVideo((state) => state.preview);
  const { panelWidth, timelineHeight, resize } = useEditorLayout();
  const windowSize = useWindowSize();
  const maxPanel = Math.round(windowSize.width * PANE_LIMITS.panelWidth.maxShare);
  const maxTimeline = Math.round(windowSize.height * PANE_LIMITS.timelineHeight.maxShare);

  useSpaceToPlay();

  if (!preview) {
    return (
      <>
        <GenerationStage />
        <ReconnectDialog />
      </>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <FrameUpdateNotice />
      <ReconnectDialog />
      <div className="flex min-h-0 flex-1">
        <section aria-label="Player" className="flex min-w-0 flex-1 flex-col gap-3 px-5 pt-4 pb-3.5">
          <GenerationNotice />
          <Player preview={preview} />
          <Transport preview={preview} />
        </section>
        <Splitter
          axis="x"
          label="Resize the side panel"
          value={Math.min(panelWidth, maxPanel)}
          min={PANE_LIMITS.panelWidth.min}
          max={maxPanel}
          growsTowardsStart
          onChange={(width) => resize({ panelWidth: width })}
          onReset={() => resize({ panelWidth: DEFAULT_LAYOUT.panelWidth })}
        />
        <SidePanel width={Math.min(panelWidth, maxPanel)} />
      </div>
      <Splitter
        axis="y"
        label="Resize the Scene timeline"
        value={Math.min(timelineHeight, maxTimeline)}
        min={PANE_LIMITS.timelineHeight.min}
        max={maxTimeline}
        growsTowardsStart
        onChange={(height) => resize({ timelineHeight: height })}
        onReset={() => resize({ timelineHeight: DEFAULT_LAYOUT.timelineHeight })}
      />
      <Timeline preview={preview} height={Math.min(timelineHeight, maxTimeline)} />
    </main>
  );
}

/**
 * Where the player goes while the Storyboard is planned, or why the generation stopped before there was a video;
 * in a Format without a video, its empty state.
 */
function GenerationStage() {
  const status = useGeneration((state) => state.status);
  const stored = useGeneration((state) => state.stored);
  const video = useGeneration((state) => state.video);
  const lostError = useGeneration((state) => state.lostError);
  const backToProject = useGeneration((state) => state.backToProject);

  if (status?.stopped && status.state === "idle") {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <div role="status" className="flex max-w-[52ch] flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-app-body">
            <CirclePauseIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            {stopHeadline(status.stopped)}
          </p>
          <p className="text-app-sm text-ink-muted">
            It stopped before the Storyboard was planned, so there’s no video yet. The Project keeps its Voiceover and Transcript; Generate again
            whenever you’re ready.
          </p>
          <Button onClick={backToProject}>Back to the Project</Button>
        </div>
      </main>
    );
  }

  const isIdle = !status || status.state === "idle";

  if (video && stored && isIdle && !stored.isLoading && !stored.version && !stored.error) {
    return <MissingFormat video={video} captions={stored.captions} />;
  }

  if (stored?.error && isIdle) {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <p role="alert" className="flex max-w-[60ch] items-start gap-2 text-app-body text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {stored.error}
        </p>
      </main>
    );
  }

  if (status?.error) {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <p role="alert" className="flex max-w-[60ch] items-start gap-2 text-app-body text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {generationErrorMessage(status.error)}
        </p>
      </main>
    );
  }

  if (lostError || status?.previewError) {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <div className="w-full max-w-[72ch]">
          <GenerationNotice />
        </div>
      </main>
    );
  }

  // Not generating: still finding out whether the Format has a video, or about to show it.
  if (isIdle) {
    return null;
  }

  return (
    <main className="flex flex-1 items-center justify-center p-10">
      <div role="status" className="flex max-w-[52ch] flex-col items-center gap-2 text-center">
        <p className="flex items-center gap-2.5 text-app-body">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-ink-muted" />
          The agent is planning the Storyboard
        </p>
        <p className="text-app-sm text-ink-muted">
          The video plays here as soon as it is planned. Scenes not yet written play as the Storyboard animatic, and each one appears as it is finished.
        </p>
      </div>
    </main>
  );
}

/**
 * What keeps the creator from seeing the generation as it is: the window lost touch with it, or the newest
 * preview couldn't be built. Either way the core carries on and saves every finished Scene.
 */
function GenerationNotice() {
  const previewError = useGeneration((state) => state.status?.previewError);
  const lostError = useGeneration((state) => state.lostError);
  const reconnect = useGeneration((state) => state.reconnect);

  if (lostError) {
    return (
      <div role="alert" className="flex items-center gap-2.5 rounded-md bg-status-fallback-tint px-3 py-2 text-app-sm text-status-fallback-ink">
        <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          Lost touch with the generation, so the video here may be out of date: {lostError} The generation may still be running.
        </span>
        <Button size="sm" onClick={reconnect}>
          Reconnect
        </Button>
      </div>
    );
  }

  if (previewError) {
    return (
      <div role="alert" className="flex items-center gap-2.5 rounded-md bg-status-fallback-tint px-3 py-2 text-app-sm text-status-fallback-ink">
        <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          The newest Scenes can’t be shown: {previewError.message} Finished Scenes are still saved in the Project.
        </span>
      </div>
    );
  }

  return <StopNotice />;
}

/** A stop the creator didn't ask for is announced at once. */
const STOP_ROLES = {
  stopped: "status",
  closed: "status",
  "plan-limit": "alert",
  authentication: "alert",
} satisfies Record<GenerationStop["cause"], "status" | "alert">;

/** Why the run ended early, once its Version is saved: finished Scenes are kept and the rest are flagged fallbacks. */
function StopNotice() {
  const status = useGeneration((state) => state.status);
  const setReconnectOpen = useGeneration((state) => state.setReconnectOpen);
  const stopped = status?.stopped;

  if (status?.state !== "done" || !stopped) {
    return null;
  }

  return (
    <div
      role={STOP_ROLES[stopped.cause]}
      className="flex items-center gap-2.5 rounded-md bg-status-flagged-tint px-3 py-2 text-app-sm text-status-flagged"
    >
      <CirclePauseIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {stopHeadline(stopped)}. Finished Scenes are kept and the rest play as flagged fallbacks; Retry them when you’re ready.
      </span>
      {stopped.cause === "authentication" ? (
        <Button size="sm" onClick={() => setReconnectOpen(true)}>
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}

/** Opens by itself when Claude's login fails mid-run, so the creator can reconnect before retrying. */
function ReconnectDialog() {
  const isOpen = useGeneration((state) => state.isReconnectOpen);
  const setReconnectOpen = useGeneration((state) => state.setReconnectOpen);

  return (
    <Dialog open={isOpen} onOpenChange={setReconnectOpen}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reconnect Claude</DialogTitle>
          <DialogDescription>
            Claude’s login failed, so the run stopped and kept every finished Scene. Reconnect, then Retry the flagged Scenes.
          </DialogDescription>
        </DialogHeader>
        <ConnectClaude />
      </DialogContent>
    </Dialog>
  );
}
