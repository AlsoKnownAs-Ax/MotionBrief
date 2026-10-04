import "@hyperframes/player";
import type { HyperframesPlayer } from "@hyperframes/player";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import type { Preview, SceneStatus, TimelineScene } from "../../../contract";
import { SCENE_STATUS, SCENE_TYPE_LABELS, sceneName } from "./labels";
import { formatTime, usePlayback } from "./playback";

/** The largest box of the video's aspect ratio that fits the stage. */
function useFittedSize(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const box = ref.current;

    if (!box) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const available = entry?.contentRect;

      if (!available) {
        return;
      }

      const scale = Math.min(available.width / width, available.height / height);
      setSize({ width: Math.floor(width * scale), height: Math.floor(height * scale) });
    });

    observer.observe(box);

    return () => observer.disconnect();
  }, [width, height]);

  return { ref, size };
}

/** The video in `<hyperframes-player>`, scaled to fit the stage. Clicking it plays or pauses. */
export function Player({ preview }: { preview: Preview }) {
  const { width, height } = preview.timeline;
  const { ref, size } = useFittedSize(width, height);
  const playerRef = useRef<HyperframesPlayer>(null);
  const attach = usePlayback((state) => state.attach);

  useEffect(() => {
    const player = playerRef.current;

    if (!player) {
      return;
    }

    return attach(player);
  }, [attach, preview.url]);

  return (
    <div ref={ref} className="grid min-h-0 min-w-0 flex-1 place-items-center">
      <div
        className="overflow-hidden rounded-md bg-black shadow-[0_0_0_1px_var(--hairline-soft)]"
        style={{ width: size.width, height: size.height }}
      >
        <hyperframes-player
          ref={playerRef}
          key={preview.url}
          src={preview.url}
          width={width}
          height={height}
          aria-label="Video preview"
          className="block size-full"
        />
      </div>
    </div>
  );
}

const SEGMENT_COLORS = {
  ready: "bg-[#3a3a3a]",
  fallback: "bg-status-fallback",
} satisfies Record<SceneStatus, string>;

/** Play / pause, the time, and a scrubber colored by each Scene's status. */
export function Transport({ preview }: { preview: Preview }) {
  const { time, isPlaying, isReady, seek, togglePlay } = usePlayback();
  const { duration, scenes } = preview.timeline;

  return (
    <div className="flex h-control shrink-0 items-center gap-3">
      <Button
        variant="tertiary"
        size="icon"
        aria-label={isPlaying ? "Pause (Space)" : "Play (Space)"}
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        disabled={!isReady}
        onClick={togglePlay}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <span className="w-[92px] shrink-0 text-app-sm tabular-nums">
        {formatTime(time)}
        <span className="text-ink-muted"> / {formatTime(duration)}</span>
      </span>
      <Scrubber scenes={scenes} duration={duration} time={time} onSeek={seek} />
    </div>
  );
}

type ScrubberProps = { scenes: TimelineScene[]; duration: number; time: number; onSeek: (time: number) => void };

function Scrubber({ scenes, duration, time, onSeek }: ScrubberProps) {
  const percent = (seconds: number) => `${(seconds / Math.max(duration, 0.001)) * 100}%`;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const bar = event.currentTarget;
    const seekTo = (clientX: number) => {
      const { left, width } = bar.getBoundingClientRect();
      onSeek(((clientX - left) / width) * duration);
    };

    bar.setPointerCapture(event.pointerId);
    seekTo(event.clientX);
    bar.onpointermove = (move) => seekTo(move.clientX);
    bar.onpointerup = () => {
      bar.onpointermove = null;
      bar.onpointerup = null;
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 1;
    const targets: Record<string, number> = { ArrowLeft: time - step, ArrowRight: time + step, Home: 0, End: duration };
    const target = targets[event.key];

    if (target !== undefined) {
      event.preventDefault();
      onSeek(target);
    }
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Playhead"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
      className="group relative h-6 flex-1 cursor-pointer touch-none rounded-xs"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {scenes.map((scene) => (
        <div
          key={scene.id}
          title={`${sceneName(scene)} · ${SCENE_TYPE_LABELS[scene.type]} · ${SCENE_STATUS[scene.status].label}`}
          className={cn(
            "absolute top-[9px] h-1.5 rounded-[2px] transition-[top,height] group-hover:top-2 group-hover:h-2",
            SEGMENT_COLORS[scene.status],
          )}
          style={{ left: percent(scene.start), width: `calc(${percent(scene.end - scene.start)} - 2px)` }}
        />
      ))}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 -ml-[1.5px] h-5 w-[3px] rounded-[2px] bg-ink shadow-[0_0_0_2px_var(--canvas)]"
        style={{ left: percent(time) }}
      />
    </div>
  );
}
