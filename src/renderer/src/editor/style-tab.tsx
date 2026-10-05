import { isDefinedError, ORPCError, safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, PaletteIcon } from "lucide-react";
import { Switch } from "radix-ui";
import { useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { core, orpc } from "@renderer/core/connection";
import { cn } from "@renderer/lib/utils";
import { costLabel } from "@renderer/new-project/generate-bar";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import { Row, Section, Select } from "@renderer/style/controls";
import { CAPTION_OPTIONS } from "@renderer/style/labels";
import { PresetSample } from "@renderer/style/preset-sample";
import { usePresets } from "@renderer/style/presets";
import { StylePresetSchema, type CaptionStyle, type CostRange, type ListedPreset, type Palette, type StylePreset, type VideoRef } from "../../../contract";
import { isGenerating, useGeneration } from "./generation";
import { isRevising, useRevision } from "./revision";

/** A change from the Style tab, as `video.changeStyle` takes it. */
type StyleRequest = { preset?: StylePreset; captions?: boolean };

/** A restyle waiting for the creator's go-ahead, inline under the Preset list. */
type PendingRestyle = { preset: StylePreset; replans: boolean; costUsd?: CostRange };

/**
 * The Style tab: the Style Preset list, whose other Presets restyle the video after confirming, then the instant
 * changes (Palette, typography, caption style, Captions), each a re-render with no agent that saves a Version.
 */
export function StyleTab() {
  const video = useGeneration((state) => state.video);
  const stored = useGeneration((state) => state.stored);
  const generating = useGeneration((state) => isGenerating(state.status));
  const revising = useRevision((state) => isRevising(state.status));
  const { change, confirm, cancel, pending, isChanging, error } = useStyleChange(video);
  const preset = stored?.preset;

  if (!video || !preset) {
    return (
      <div className="m-auto flex max-w-[260px] flex-col items-center gap-2 px-3 py-6 text-center">
        <PaletteIcon className="size-5 text-ink-muted" aria-hidden="true" />
        <p className="text-app-sm font-medium">No video yet</p>
        <p className="text-app-xs leading-[1.45] text-ink-muted">The Style Preset and instant changes show here once the first Version is saved.</p>
      </div>
    );
  }

  const isBusy = generating || revising || isChanging;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-0.5">
      {error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {error}
        </p>
      ) : null}
      <Section title="Style Preset" help="Another Preset regenerates every Scene with the agent.">
        <PresetList current={preset} isBusy={isBusy} onChoose={(next) => void change({ preset: next })} />
        {pending ? <RestyleConfirm pending={pending} version={stored.version} isBusy={isChanging} onConfirm={() => void confirm()} onCancel={cancel} /> : null}
      </Section>
      <Section title="Instant changes" help="No agent run and no cost. Each change saves a Version.">
        <InstantChanges preset={preset} captions={stored.captions ?? false} isBusy={isBusy} onChange={(request) => void change(request)} />
      </Section>
    </div>
  );
}

/** Sends a style change; a restyle comes back unconfirmed first, and waits in `pending` until confirmed or cancelled. */
function useStyleChange(video: VideoRef | undefined) {
  const reopen = useGeneration((state) => state.reopen);
  const [pending, setPending] = useState<PendingRestyle>();
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string>();

  async function send(request: StyleRequest & { confirmed?: boolean }) {
    if (!video) {
      return;
    }

    setIsChanging(true);
    setError(undefined);
    const { data: changed, error: changeError } = await safe(core.video.changeStyle({ ...video, ...request }));
    setIsChanging(false);

    if (isDefinedError(changeError) && changeError.code === "RESTYLE_UNCONFIRMED" && request.preset) {
      setPending({ preset: request.preset, ...changeError.data });
      return;
    }

    setPending(undefined);

    if (changeError) {
      setError(styleErrorMessage(changeError));
      return;
    }

    // A restyle streams through the generation; a swap's Version plays at once.
    if (changed.change === "swap") {
      reopen();
    }
  }

  return {
    pending,
    isChanging,
    error,
    change: (request: StyleRequest) => send(request),
    confirm: () => send({ preset: pending?.preset, confirmed: true }),
    cancel: () => setPending(undefined),
  };
}

/** The Style Presets, bundled first; the video's is checked. Its snapshot keeps the look even if the Preset changed since. */
function PresetList({ current, isBusy, onChoose }: { current: StylePreset; isBusy: boolean; onChoose: (preset: StylePreset) => void }) {
  const { data: presets = [] } = usePresets();

  return (
    <ul aria-label="Style Presets" className="flex flex-col gap-0.5">
      {presets.map((listed) => (
        <li key={listed.id}>
          <button
            type="button"
            aria-pressed={listed.id === current.id}
            disabled={isBusy}
            onClick={() => onChoose(snapshotOf(listed))}
            className={cn(
              "flex w-full items-center gap-3 rounded-[10px] p-1.5 text-left outline-none transition-colors hover:not-disabled:bg-surface-2 focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:cursor-not-allowed disabled:opacity-40",
              listed.id === current.id && "bg-surface-2",
            )}
          >
            <PresetSample preset={listed} className="w-16 shrink-0 rounded-sm" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-app-sm">{listed.name}</span>
              {listed.readOnly ? null : <Badge>Yours</Badge>}
            </span>
            {listed.id === current.id ? <CheckIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

type RestyleConfirmProps = { pending: PendingRestyle; version?: number; isBusy: boolean; onConfirm: () => void; onCancel: () => void };

/** A restyle always asks first: it regenerates every Scene, at about the cost of a first generation. */
function RestyleConfirm({ pending, version, isBusy, onConfirm, onCancel }: RestyleConfirmProps) {
  return (
    <div role="group" aria-labelledby="confirm-restyle" className="flex flex-col gap-2 rounded-lg border border-hairline-soft bg-surface-1 p-3">
      <p id="confirm-restyle" className="text-app-sm font-medium">
        Restyle to {pending.preset.name}?
      </p>
      <p className="text-app-sm leading-[1.45] text-ink-muted">{restyleLine(pending, version)}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={isBusy} onClick={onConfirm}>
          Restyle
        </Button>
      </div>
    </div>
  );
}

function restyleLine({ replans, costUsd }: PendingRestyle, version: number | undefined) {
  const scope = replansLine(replans);
  const cost = costLine(costUsd);
  const kept = version === undefined ? "" : ` Version ${version} stays restorable.`;

  return `${scope}${cost}${kept}`;
}

function replansLine(replans: boolean) {
  if (replans) {
    return "Its Transitions or Canvas rule out this Storyboard, so the agent plans it again and regenerates every Scene.";
  }

  return "The Storyboard stays; the agent regenerates every Scene.";
}

function costLine(costUsd: CostRange | undefined) {
  if (!costUsd) {
    return "";
  }

  return ` About ${costLabel(costUsd)} on your API key.`;
}

type InstantChangesProps = { preset: StylePreset; captions: boolean; isBusy: boolean; onChange: (request: StyleRequest) => void };

function InstantChanges({ preset, captions, isBusy, onChange }: InstantChangesProps) {
  const { data: palettes = [] } = useQuery(orpc.style.palettes.queryOptions());
  const { data: pairings = [] } = useQuery(orpc.style.typography.queryOptions());
  // The snapshot's own pairing stays choosable when it isn't a bundled one, such as one edited in a Preset.
  const typography = [...pairings.filter(({ name }) => name !== preset.typography.name), preset.typography];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Palette" className="grid grid-cols-2 gap-1.5">
        {palettes.map((palette) => (
          <PaletteChoice
            key={palette.name}
            palette={palette}
            isCurrent={isSamePalette(palette, preset.palette)}
            isBusy={isBusy}
            onChoose={() => onChange({ preset: { ...preset, palette } })}
          />
        ))}
      </div>
      <Row label="Typography">
        {(id) => (
          <Select
            id={id}
            value={preset.typography.name}
            options={typography.map(({ name }) => ({ value: name, label: name }))}
            onChange={(name) => onChange({ preset: { ...preset, typography: typography.find((pairing) => pairing.name === name) ?? preset.typography } })}
            disabled={isBusy}
          />
        )}
      </Row>
      <Row label="Caption style">
        {(id) => (
          <Select<CaptionStyle>
            id={id}
            value={preset.captions}
            options={CAPTION_OPTIONS}
            onChange={(captionStyle) => onChange({ preset: { ...preset, captions: captionStyle } })}
            disabled={isBusy}
          />
        )}
      </Row>
      <Row label="Captions">
        {(id) => (
          <Switch.Root
            id={id}
            checked={captions}
            disabled={isBusy}
            onCheckedChange={(isOn) => onChange({ captions: isOn })}
            className="relative h-5 w-9 shrink-0 rounded-pill bg-surface-3 outline-none transition-colors focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:opacity-40 data-[state=checked]:bg-primary"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-canvas" />
          </Switch.Root>
        )}
      </Row>
    </div>
  );
}

const SWATCH_ROLES = ["bg", "surface", "ink", "accent", "accent2"] as const;

function PaletteChoice({ palette, isCurrent, isBusy, onChoose }: { palette: Palette; isCurrent: boolean; isBusy: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={isCurrent}
      disabled={isBusy}
      onClick={onChoose}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-[10px] bg-surface-1 p-2 text-left outline-none transition-colors hover:not-disabled:bg-surface-2 focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:cursor-not-allowed disabled:opacity-40",
        isCurrent && "bg-surface-2 shadow-[0_0_0_1px_var(--brand)]",
      )}
    >
      <span aria-hidden="true" className="flex h-4 overflow-hidden rounded-sm">
        {SWATCH_ROLES.map((role) => (
          <span key={role} className="flex-1" style={{ background: palette.colors[role] }} />
        ))}
      </span>
      <span className="truncate text-app-xs">{palette.name}</span>
    </button>
  );
}

/** The Preset as a video's snapshot holds it, without the list's read-only mark. */
function snapshotOf(listed: ListedPreset): StylePreset {
  return StylePresetSchema.parse(listed);
}

function isSamePalette(a: Palette, b: Palette) {
  return a.name === b.name && JSON.stringify(a.colors) === JSON.stringify(b.colors);
}

const STYLE_MESSAGES: Record<string, string> = {
  BUSY: "Wait for the run going now to finish, or stop it, then change the style.",
  NO_VIDEO: "This video has no Version yet. Generate it first.",
  INVALID_VERSION: "This video's files in the Project are damaged, so its style can't change.",
  VOICEOVER_MISSING: "The Project's Voiceover file is missing, so the video can't play. Put it back in the Project folder.",
};

function styleErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in STYLE_MESSAGES) {
    return STYLE_MESSAGES[error.code];
  }

  return projectErrorMessage(error);
}
