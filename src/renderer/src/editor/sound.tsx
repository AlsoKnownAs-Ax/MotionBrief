import { MusicIcon, SlidersHorizontalIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";
import { Row, Segmented, Slider } from "@renderer/style/controls";
import { NO_ASSET, type SfxDensity, type TimelineMusic, type TimelineSound } from "../../../contract";
import { useAssets, useVideoSound } from "./video-assets";

const SFX_OPTIONS: { value: SfxDensity; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "subtle", label: "Subtle" },
  { value: "lively", label: "Lively" },
];

/** How a sound effect's chip reads, by who placed it. */
const SOUND_SOURCES = {
  agent: { title: (name: string) => `${name}: placed by the agent; revise it by prompt`, className: "bg-status-flagged-tint text-status-flagged" },
  transition: { title: (name: string) => `${name}: the Style Preset's Transition sound`, className: "bg-surface-2 text-ink-muted" },
} satisfies Record<TimelineSound["source"], { title: (name: string) => string; className: string }>;

/** The timeline's sound controls. */
export function SoundButton() {
  const { sound, set, isBusy, error } = useVideoSound();

  if (!sound) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <SlidersHorizontalIcon />
          Sound
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="flex w-[340px] flex-col gap-3">
        <p className="text-app-xs text-ink-muted">No agent run and no cost. Each change saves a Version.</p>
        {error ? (
          <p role="alert" className="text-app-xs text-status-fallback-ink">
            {error}
          </p>
        ) : null}
        <fieldset disabled={isBusy} className="flex flex-col gap-3 disabled:opacity-40">
          <Row label="Sound effects">{() => <Segmented label="Sound effects" value={sound.sfx} options={SFX_OPTIONS} onChange={(sfx) => set({ sfx })} />}</Row>
          <Row label="Music level">{(id) => <LevelSlider id={id} value={sound.musicLevel} min={-40} max={0} onCommit={(musicLevel) => set({ musicLevel })} />}</Row>
          <Row label="Effects level">{(id) => <LevelSlider id={id} value={sound.sfxLevel} min={-24} max={12} onCommit={(sfxLevel) => set({ sfxLevel })} />}</Row>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

/** A dB slider that saves once the creator lets go, not on every step of a drag. */
function LevelSlider({ id, value, min, max, onCommit }: { id: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<number>();
  const commit = () => {
    if (draft !== undefined && draft !== value) {
      onCommit(draft);
    }

    setDraft(undefined);
  };

  return (
    <span className="contents" onPointerUp={commit} onKeyUp={commit}>
      <Slider id={id} value={draft ?? value} min={min} max={max} unit=" dB" onChange={setDraft} />
    </span>
  );
}

/** The Music lane's height, under the Transcript. */
export const MUSIC_LANE = 22;

/** The Music lane: the bed under the whole video with its fade shape; clicking it picks another bed, or None. */
export function MusicLane({ music, duration, px, top }: { music: TimelineMusic | null; duration: number; px: number; top: number }) {
  const { sound, set, isBusy, error } = useVideoSound();
  const { assets } = useAssets();
  // The same bed can be in this Project and in the Library.
  const beds = [...new Map(assets.filter(({ kind }) => kind === "music").map((asset) => [asset.id, asset])).values()];

  if (!sound) {
    return null;
  }

  const choices = [{ id: NO_ASSET, name: "None" }, ...beds];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={musicLabel(music)}
          className="absolute left-0 flex items-center rounded-sm text-left text-app-xs text-ink-muted outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
          style={{ top, height: MUSIC_LANE, width: duration * px }}
        >
          {music ? (
            <span
              title={`${music.name}: fades in, ducked under the Voiceover, fades out over the last Scene`}
              className="flex size-full items-center gap-1 overflow-hidden bg-surface-3 px-2 whitespace-nowrap"
              style={{ clipPath: `polygon(0 100%, ${music.fadeIn * px}px 0, calc(100% - ${music.fadeOut * px}px) 0, 100% 100%)` }}
            >
              <MusicIcon className="size-3 shrink-0" aria-hidden="true" />
              {music.name}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5">
              <MusicIcon className="size-3" aria-hidden="true" />
              No music
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="flex w-[280px] flex-col gap-2">
        <p className="text-app-xs text-ink-muted">Music for this video. No agent run and no cost; it saves a Version.</p>
        {error ? (
          <p role="alert" className="text-app-xs text-status-fallback-ink">
            {error}
          </p>
        ) : null}
        <fieldset disabled={isBusy} aria-label="Music bed" className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto disabled:opacity-40">
          {choices.map(({ id, name }) => (
            <button
              key={id}
              type="button"
              aria-pressed={sound.music === id}
              onClick={() => sound.music !== id && set({ music: id })}
              className={cn("flex h-7 items-center rounded-md px-2 text-left text-app-sm text-ink-muted hover:text-ink", sound.music === id && "bg-surface-2 text-ink")}
            >
              <span className="truncate">{name}</span>
            </button>
          ))}
        </fieldset>
        {beds.length === 0 ? <p className="text-app-xs text-ink-muted">Import music in the Library to use it here.</p> : null}
      </PopoverContent>
    </Popover>
  );
}

function musicLabel(music: TimelineMusic | null) {
  if (!music) {
    return "No music. Pick a bed";
  }

  return `Music: ${music.name}. Pick another bed`;
}

/** The SFX lane's height, under the Transcript. */
export const SFX_LANE = 22;

/** The sound effects lane: a labelled chip at each sound, the Transition rule's apart from the agent's. */
export function SfxLane({ sounds, px, top }: { sounds: TimelineSound[]; px: number; top: number }) {
  return (
    <div role="group" aria-label="Sound effects" className="absolute inset-x-0" style={{ top, height: SFX_LANE }}>
      {sounds.map((sound) => (
        <span
          key={`${sound.start} ${sound.name}`}
          title={SOUND_SOURCES[sound.source].title(sound.name)}
          className={cn("absolute flex h-full items-center gap-1 rounded-sm px-1.5 text-app-xs whitespace-nowrap", SOUND_SOURCES[sound.source].className)}
          style={{ left: sound.start * px }}
        >
          <Volume2Icon className="size-3" aria-hidden="true" />
          {sound.name}
        </span>
      ))}
    </div>
  );
}
