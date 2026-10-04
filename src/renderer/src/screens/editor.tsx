import { CircleAlertIcon, HouseIcon, LoaderCircleIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useEffect, useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { generationErrorMessage, useGeneration } from "@renderer/editor/generation";
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
import type { Format } from "../../../contract";

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

/** The generation's progress while it runs, and its failure. The Scenes carry their own badges. */
function GenerationBadge() {
  const status = useGeneration((state) => state.status);

  if (status?.state === "planning") {
    return (
      <Badge role="status" status="working" pulse>
        Planning the Storyboard
      </Badge>
    );
  }

  if (status?.state === "writing") {
    const finished = status.units.filter((unit) => unit.status === "ready" || unit.status === "fallback").length;

    return (
      <Badge role="status" status="working" pulse>
        Writing Scenes · {finished} of {status.units.length}
      </Badge>
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
    return <GenerationStage />;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
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

  if (video && stored?.state === "none" && (!status || status.state === "idle")) {
    return <MissingFormat video={video} />;
  }

  if (stored?.state === "failed" && (!status || status.state === "idle")) {
    return (
      <main className="flex flex-1 items-center justify-center p-10">
        <p role="alert" className="flex max-w-[60ch] items-start gap-2 text-app-body text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {stored.message}
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
  if (!status || status.state === "idle") {
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

  return null;
}
