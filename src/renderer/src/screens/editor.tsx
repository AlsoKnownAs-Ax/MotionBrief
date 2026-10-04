import { HouseIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { DEFAULT_LAYOUT, PANE_LIMITS, useEditorLayout } from "@renderer/editor/layout";
import { FORMAT_LABELS } from "@renderer/editor/labels";
import { useOpenVideo } from "@renderer/editor/open-video";
import { usePlayback } from "@renderer/editor/playback";
import { Player, Transport } from "@renderer/editor/player";
import { SidePanel } from "@renderer/editor/side-panel";
import { Splitter } from "@renderer/editor/splitter";
import { Timeline } from "@renderer/editor/timeline";
import { useNavigation } from "@renderer/navigation";

/** The editor's part of the title bar: back to Home, the Project's name and the video's Format. */
export function EditorToolbar() {
  const projectName = useOpenVideo((state) => state.projectName);
  const format = useOpenVideo((state) => state.preview?.timeline.format);
  const openHome = useNavigation((state) => state.openHome);

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="h-5 w-px bg-hairline" />
      <Button variant="ghost" size="icon-sm" className="no-drag-region" aria-label="Home" title="Home" onClick={openHome}>
        <HouseIcon />
      </Button>
      <h1 className="min-w-0 truncate text-app-body font-medium">{projectName}</h1>
      {format && <span className="shrink-0 rounded-sm bg-surface-2 px-[7px] py-0.5 text-app-xs font-medium text-[#cfcfcf]">{FORMAT_LABELS[format]}</span>}
    </div>
  );
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
    return null;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <section aria-label="Player" className="flex min-w-0 flex-1 flex-col gap-3 px-5 pt-4 pb-3.5">
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
