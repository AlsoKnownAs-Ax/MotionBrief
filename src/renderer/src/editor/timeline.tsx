import { useQuery } from "@tanstack/react-query";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { WordEditor } from "@renderer/components/word-editor";
import { orpc } from "@renderer/core/connection";
import { cn } from "@renderer/lib/utils";
import type { Preview, TimelineScene, TimelineWord, VideoTimeline } from "../../../contract";
import { SCENE_STATUS, SCENE_TYPE_LABELS, sceneName, TRANSITIONS } from "./labels";
import { useOpenVideo } from "./open-video";
import { formatTime, usePlayback } from "./playback";

/** Zoom limits, in pixels per second. */
const MIN_ZOOM = 8;
const MAX_ZOOM = 240;
const ZOOM_STEP = 1.4;

/** Rows inside the scrolling area, in pixels. */
const HEADER = 44;
const RULER = 22;
const WORD_LANE = 26;
const GAP = 8;
const SCROLLBAR = 10;
/** Room after the last second, so the end of the video isn't under the edge. */
const TAIL = 24;

/** The Scene timeline: a time ruler, a card per Scene sized to its length, Transition markers, and the Transcript's words. */
export function Timeline({ preview, height }: { preview: Preview; height: number }) {
  const { timeline } = preview;
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportWidth = useWidth(scrollRef);
  /** Pixels per second; until the creator zooms, and after Fit, the whole video fits the pane. */
  const [zoom, setZoom] = useState<number>();
  const seek = usePlayback((state) => state.seek);
  const px = zoom ?? clampZoom((viewportWidth - TAIL) / Math.max(timeline.duration, 1));
  const area = height - HEADER - SCROLLBAR;
  const cardTop = RULER + GAP;
  const cardHeight = Math.max(40, area - RULER - WORD_LANE - 3 * GAP);
  const wordTop = cardTop + cardHeight + GAP;
  const thumbnails = useThumbnails(preview.id);
  const fixError = useOpenVideo((state) => state.fixError);

  return (
    <section aria-label="Scene timeline" className="flex shrink-0 flex-col bg-[#0b0b0b]" style={{ height }}>
      <header className="flex shrink-0 items-center gap-3.5 pr-3 pl-4 whitespace-nowrap" style={{ height: HEADER }}>
        <span className="text-app-sm">
          <span className="font-medium">{timeline.scenes.length} Scenes</span>
          <span className="text-ink-muted tabular-nums"> · {formatTime(timeline.duration)}</span>
        </span>
        {fixError ? (
          <span role="alert" title={fixError} className="min-w-0 truncate text-app-xs text-status-fallback-ink">
            {fixError}
          </span>
        ) : (
          <span className="min-w-0 truncate text-app-xs text-ink-muted">Click a Scene or a word to go to it. Double-click a word to fix it.</span>
        )}
        <span className="flex-1" />
        <ZoomControls zoom={px} onZoom={(next) => setZoom(clampZoom(next))} onFit={() => setZoom(undefined)} />
      </header>
      <div ref={scrollRef} className="timeline-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative" style={{ width: timeline.duration * px + TAIL, height: area }}>
          <Ruler duration={timeline.duration} px={px} onSeek={seek} />
          {timeline.scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              timeline={timeline}
              px={px}
              top={cardTop}
              height={cardHeight}
              thumbnail={thumbnails.get(scene.id)}
              onSeek={seek}
            />
          ))}
          {timeline.scenes.map((scene) => (
            <TransitionMarker key={scene.id} scene={scene} px={px} top={cardTop + cardHeight / 2} />
          ))}
          <WordLane words={timeline.words} px={px} top={wordTop} />
          <Playhead px={px} scrollRef={scrollRef} />
        </div>
      </div>
    </section>
  );
}

function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/** An element's width, kept up to date as its pane resizes. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/** Each Scene's still, by Scene id, as they stream in. */
function useThumbnails(previewId: string) {
  const { data } = useQuery(orpc.preview.thumbnails.experimental_streamedOptions({ input: { id: previewId }, staleTime: Infinity, retry: false }));

  return useMemo(() => new Map((data ?? []).map(({ sceneId, image }) => [sceneId, image])), [data]);
}

function ZoomControls({ zoom, onZoom, onFit }: { zoom: number; onZoom: (zoom: number) => void; onFit: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => onZoom(zoom / ZOOM_STEP)}>
        <ZoomOutIcon />
      </Button>
      <input
        type="range"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        value={Math.round(zoom)}
        aria-label="Timeline zoom"
        className="w-[88px] accent-ink-muted"
        onChange={(event) => onZoom(Number(event.target.value))}
      />
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(zoom * ZOOM_STEP)}>
        <ZoomInIcon />
      </Button>
      <Button variant="ghost" size="sm" onClick={onFit}>
        Fit
      </Button>
    </div>
  );
}

/** Seconds between ticks, and between labelled ticks, that leave room at this zoom. */
function tickSteps(px: number) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const tick = steps.find((step) => step * px >= 10) ?? 600;
  const label = steps.find((step) => step * px >= 64 && step % tick === 0) ?? 600;

  return { tick, label };
}

function Ruler({ duration, px, onSeek }: { duration: number; px: number; onSeek: (time: number) => void }) {
  const { tick, label } = tickSteps(px);
  const ticks = Array.from({ length: Math.floor(duration / tick) + 1 }, (_, index) => index * tick);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 cursor-pointer touch-none border-b border-hairline-soft"
      style={{ height: RULER }}
      onPointerDown={(event) => dragToSeek(event, px, onSeek)}
    >
      {ticks.map((second) => {
        const isLabelled = second % label === 0;

        return (
          <span
            key={second}
            className={cn("absolute bottom-0 w-px", isLabelled ? "h-2 bg-[#555]" : "h-1 bg-[#333]")}
            style={{ left: second * px }}
          >
            {isLabelled && <span className="absolute bottom-[9px] left-1 text-[11px] text-ink-muted tabular-nums">{formatTime(second)}</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Seeks to the pointer while it drags across the ruler. */
function dragToSeek(event: PointerEvent<HTMLElement>, px: number, onSeek: (time: number) => void) {
  const ruler = event.currentTarget;
  const seekTo = (clientX: number) => onSeek((clientX - ruler.getBoundingClientRect().left) / px);

  ruler.setPointerCapture(event.pointerId);
  seekTo(event.clientX);
  ruler.onpointermove = (move) => seekTo(move.clientX);
  ruler.onpointerup = () => {
    ruler.onpointermove = null;
    ruler.onpointerup = null;
  };
}

type SceneCardProps = {
  scene: TimelineScene;
  timeline: VideoTimeline;
  px: number;
  top: number;
  height: number;
  thumbnail?: string;
  onSeek: (time: number) => void;
};

function SceneCard({ scene, timeline, px, top, height, thumbnail, onSeek }: SceneCardProps) {
  const width = (scene.end - scene.start) * px - 3;
  const aspect = timeline.width / timeline.height;
  const thumbHeight = Math.min(height - 12, 150);
  const thumbWidth = Math.min(thumbHeight * aspect, width - 12);
  const status = SCENE_STATUS[scene.status];
  const showsMeta = width > thumbWidth + 88;
  // Without room beside the thumbnail, the status badge sits on it.
  const badge = status.badge && (
    <Badge status={status.badge} pulse={status.badge === "working"} className={cn(!showsMeta && "absolute top-1 left-1")}>
      {(showsMeta || thumbWidth > 72) && status.badgeLabel}
    </Badge>
  );

  return (
    <button
      type="button"
      title={`${sceneName(scene)} · ${SCENE_TYPE_LABELS[scene.type]} · ${formatTime(scene.start)} to ${formatTime(scene.end)}${scene.note ? `\nReview note: ${scene.note}` : ""}`}
      aria-label={`${sceneName(scene)}, ${SCENE_TYPE_LABELS[scene.type]}, ${status.label}${scene.note ? `: ${scene.note}` : ""}, from ${formatTime(scene.start)}`}
      className="absolute flex items-center gap-2 overflow-hidden rounded-md bg-surface-1 p-1.5 text-left transition-colors hover:bg-surface-2"
      style={{ left: scene.start * px, width, top, height }}
      onClick={() => onSeek(scene.start)}
    >
      {thumbWidth > 8 && (
        <span className="relative shrink-0 overflow-hidden rounded-sm bg-[#111]" style={{ width: thumbWidth, height: thumbWidth / aspect }}>
          {thumbnail ? <img src={thumbnail} alt="" className="block size-full object-cover" /> : <span className="block size-full animate-pulse bg-surface-2" />}
          {!showsMeta && badge}
        </span>
      )}
      {showsMeta && (
        <span className="flex min-w-0 flex-col items-start gap-[5px]">
          <span className="max-w-full truncate text-app-xs font-medium">
            <span className="text-ink-muted tabular-nums">{scene.number}</span> {SCENE_TYPE_LABELS[scene.type]}
          </span>
          {badge}
          {scene.note && <span className="max-w-full truncate text-app-xs text-ink-muted">{scene.note}</span>}
        </span>
      )}
    </button>
  );
}

function TransitionMarker({ scene, px, top }: { scene: TimelineScene; px: number; top: number }) {
  if (!scene.transitionIn) {
    return null;
  }

  const { label, icon: Icon } = TRANSITIONS[scene.transitionIn];
  const description = `${label} into ${sceneName(scene)}`;

  return (
    <span
      role="img"
      aria-label={description}
      title={description}
      className="absolute z-[2] -mt-[9px] -ml-[9px] grid size-[18px] place-items-center rounded-full bg-surface-3 text-[#cfcfcf] shadow-[0_0_0_2px_#0b0b0b]"
      style={{ left: scene.start * px - 1.5, top }}
    >
      <Icon className="size-2.5" aria-hidden="true" />
    </span>
  );
}

/** Words grouped into phrases at punctuation, at most a few words each, so a phrase sits where it is spoken. */
function phrasesOf(words: TimelineWord[]) {
  const phrases: number[][] = [];
  let phrase: number[] = [];

  words.forEach(({ text }, index) => {
    phrase.push(index);

    if (/[.,;:!?]$/.test(text) || phrase.length >= 4) {
      phrases.push(phrase);
      phrase = [];
    }
  });

  if (phrase.length > 0) {
    phrases.push(phrase);
  }

  return phrases;
}

/** The index of the word being spoken at `time`, or -1 between words and outside them. */
function wordAt(words: TimelineWord[], time: number) {
  let low = 0;
  let high = words.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const word = words[middle]!;

    if (time < word.start) {
      high = middle - 1;
    } else if (time >= word.end) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return -1;
}

/**
 * The Transcript's words under the Scenes. Click a word to go to it; double-click it, or press F2,
 * to fix its text. Arrow keys move between words.
 */
function WordLane({ words, px, top }: { words: TimelineWord[]; px: number; top: number }) {
  const phrases = useMemo(() => phrasesOf(words), [words]);
  const current = usePlayback((state) => wordAt(words, state.time));
  const seek = usePlayback((state) => state.seek);
  const { wordFixes, fixWord } = useOpenVideo();
  const [focused, setFocused] = useState(0);
  const [editing, setEditing] = useState<number>();
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const returnFocusTo = useRef<number>(undefined);

  // A finished edit hands the keyboard back to its word.
  useEffect(() => {
    if (editing === undefined && returnFocusTo.current !== undefined) {
      buttons.current.get(returnFocusTo.current)?.focus();
      returnFocusTo.current = undefined;
    }
  }, [editing]);

  function moveFocus(index: number) {
    const next = Math.max(0, Math.min(words.length - 1, index));

    setFocused(next);
    buttons.current.get(next)?.focus();
    buttons.current.get(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function finishEditing(index: number, text: string | undefined) {
    if (text !== undefined && text.trim()) {
      void fixWord(index, text.trim());
    }

    returnFocusTo.current = index;
    setEditing(undefined);
  }

  return (
    <div role="group" aria-label="Transcript" className="absolute inset-x-0" style={{ top, height: WORD_LANE }}>
      {phrases.map((phrase, index) => {
        const first = words[phrase[0]!]!;
        const nextStart = words[phrases[index + 1]?.[0] ?? -1]?.start ?? first.end;
        const isEditing = editing !== undefined && phrase.includes(editing);

        return (
          <div
            key={phrase[0]}
            className={cn(
              "absolute flex h-full items-center whitespace-nowrap",
              isEditing ? "z-[6] overflow-visible" : "overflow-hidden [mask-image:linear-gradient(90deg,#000_calc(100%-16px),transparent)]",
            )}
            style={{ left: first.start * px, width: Math.max(8, (nextStart - first.start) * px - 4) }}
          >
            {phrase.map((wordIndex) => {
              const text = wordFixes[wordIndex] ?? words[wordIndex]!.text;

              if (editing === wordIndex) {
                return <WordEditor key={wordIndex} text={text} className="h-[26px] text-app-xs" onDone={(fixed) => finishEditing(wordIndex, fixed)} />;
              }

              return (
                <button
                  key={wordIndex}
                  ref={(button) => {
                    if (button) {
                      buttons.current.set(wordIndex, button);
                    } else {
                      buttons.current.delete(wordIndex);
                    }
                  }}
                  type="button"
                  tabIndex={wordIndex === focused ? 0 : -1}
                  aria-current={wordIndex === current ? "true" : undefined}
                  title={wordFixes[wordIndex] ? `Fixed from "${words[wordIndex]!.text}"` : undefined}
                  className={cn(
                    "h-[22px] shrink-0 cursor-pointer rounded-[5px] px-0.5 text-app-xs leading-[22px] text-ink-muted hover:bg-surface-2 hover:text-ink",
                    wordFixes[wordIndex] !== undefined && "text-ink underline decoration-dotted underline-offset-[3px]",
                    wordIndex === current && "text-primary hover:text-primary",
                  )}
                  onFocus={() => setFocused(wordIndex)}
                  onClick={() => seek(words[wordIndex]!.start)}
                  onDoubleClick={() => setEditing(wordIndex)}
                  onKeyDown={(event) => {
                    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

                    if (event.key === "F2") {
                      event.preventDefault();
                      setEditing(wordIndex);
                    } else if (moves[event.key] !== undefined) {
                      event.preventDefault();
                      moveFocus(wordIndex + moves[event.key]!);
                    } else if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      moveFocus(event.key === "Home" ? 0 : words.length - 1);
                    }
                  }}
                >
                  {text}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The playhead across the ruler, the Scenes and the words; while playing, the pane scrolls to keep it in view. */
function Playhead({ px, scrollRef }: { px: number; scrollRef: RefObject<HTMLDivElement | null> }) {
  const time = usePlayback((state) => state.time);
  const isPlaying = usePlayback((state) => state.isPlaying);
  const x = time * px;

  useEffect(() => {
    const scroll = scrollRef.current;

    if (!scroll || !isPlaying) {
      return;
    }

    if (x < scroll.scrollLeft + 40 || x > scroll.scrollLeft + scroll.clientWidth - 120) {
      scroll.scrollLeft = x - 80;
    }
  }, [x, isPlaying, scrollRef]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[5] -ml-px w-0.5 bg-ink" style={{ left: x }}>
      <span className="absolute top-0 -left-[5px] h-[9px] w-3 bg-ink [clip-path:polygon(0_0,100%_0,50%_100%)]" />
    </div>
  );
}
