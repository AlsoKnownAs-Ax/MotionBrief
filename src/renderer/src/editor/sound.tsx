import { SlidersHorizontalIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";
import { Row, Segmented, Slider } from "@renderer/style/controls";
import { usePresets } from "@renderer/style/presets";
import type { PresetSound, SfxDensity, StylePreset, TimelineSound } from "../../../contract";
import { isGenerating, useGeneration } from "./generation";
import { isRevising, useRevision } from "./revision";
import { useStyleChange } from "./style-tab";

const SFX_OPTIONS: { value: SfxDensity; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "subtle", label: "Subtle" },
  { value: "lively", label: "Lively" },
];

/** The timeline's sound controls: each change is a swap, a re-render with no agent that saves a Version. */
export function SoundButton() {
  const video = useGeneration((state) => state.video);
  const preset = useGeneration((state) => state.stored?.preset);
  const generating = useGeneration((state) => isGenerating(state.status));
  const revising = useRevision((state) => isRevising(state.status));
  const { change, isChanging, error } = useStyleChange(video);
  const sound = useSoundOf(preset);

  if (!preset || !sound) {
    return null;
  }

  const isBusy = generating || revising || isChanging;
  const set = (changes: Partial<PresetSound>) => void change({ preset: { ...preset, sound: { ...sound, ...changes } } });

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

/** The video's sound: its snapshot's, or for a snapshot from before Presets had sound, its bundled Preset's. */
function useSoundOf(preset: StylePreset | undefined): PresetSound | undefined {
  const { data: presets = [] } = usePresets();

  return preset?.sound ?? (presets.find(({ id }) => id === preset?.id) ?? presets[0])?.sound;
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

/** The SFX lane's height, under the Transcript. */
export const SFX_LANE = 22;

/** The sound effects lane: a labelled chip at each sound, the Transition rule's apart from the agent's. */
export function SfxLane({ sounds, px, top }: { sounds: TimelineSound[]; px: number; top: number }) {
  return (
    <div role="group" aria-label="Sound effects" className="absolute inset-x-0" style={{ top, height: SFX_LANE }}>
      {sounds.map((sound) => (
        <span
          key={`${sound.start} ${sound.name}`}
          title={sound.source === "agent" ? `${sound.name}: placed by the agent; revise it by prompt` : `${sound.name}: the Style Preset's Transition sound`}
          className={cn(
            "absolute flex h-full items-center gap-1 rounded-sm px-1.5 text-[11px] whitespace-nowrap",
            sound.source === "agent" ? "bg-status-flagged-tint text-status-flagged" : "bg-surface-2 text-ink-muted",
          )}
          style={{ left: sound.start * px }}
        >
          <Volume2Icon className="size-3" aria-hidden="true" />
          {sound.name}
        </span>
      ))}
    </div>
  );
}
