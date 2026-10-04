import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { orpc } from "@renderer/core/connection";
import { cn } from "@renderer/lib/utils";
import {
  AccentRoleSchema,
  PaletteRoleSchema,
  StylePresetSchema,
  type AccentRole,
  type ContrastFinding,
  type Face,
  type Palette,
  type PaletteRole,
  type PresetTransition,
  type StylePreset,
  type Treatments,
  type Typography,
} from "../../../contract";
import { Row, Section, Segmented, Select, Slider } from "./controls";
import {
  BACKGROUND_OPTIONS,
  CANVAS_OPTIONS,
  CAPTION_OPTIONS,
  CHARACTER_OPTIONS,
  CONNECTOR_OPTIONS,
  ENERGY_OPTIONS,
  FACE_LABELS,
  findingMessage,
  ICON_OPTIONS,
  LINE_OPTIONS,
  presetErrorMessage,
  ROLE_LABELS,
  SURFACE_OPTIONS,
  TEXTURE_OPTIONS,
  TRANSITION_OPTIONS,
} from "./labels";
import { PresetSample } from "./preset-sample";
import { usePresetEditor, usePresets, useSavePreset } from "./presets";

/** The sample is drawn again once the creator pauses, not on every slider step. */
const SAMPLE_DELAY_MS = 500;

const DIRECTION_MAX = 600;

/** Edits one of the creator's own Style Presets with pickers only; the bundled ones are duplicated first. */
export function PresetEditorDialog() {
  const { editingId, edit } = usePresetEditor();
  const { data: presets = [] } = usePresets();
  const preset = presets.find(({ id, readOnly }) => id === editingId && !readOnly);

  return (
    <Dialog open={preset !== undefined} onOpenChange={(isOpen) => !isOpen && edit(undefined)}>
      <DialogContent className="max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Style Preset</DialogTitle>
          <DialogDescription>Videos already made with it keep their own copy, so nothing here changes them.</DialogDescription>
        </DialogHeader>
        {preset ? <PresetForm key={preset.id} preset={StylePresetSchema.parse(preset)} onDone={() => edit(undefined)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PresetForm({ preset, onDone }: { preset: StylePreset; onDone: () => void }) {
  const [draft, setDraft] = useState(preset);
  const save = useSavePreset();
  const sampled = useDebounced(draft, SAMPLE_DELAY_MS);
  const parsed = StylePresetSchema.safeParse(draft);
  const { data: contrast } = useQuery(orpc.style.contrast.queryOptions({ input: { palette: draft.palette }, placeholderData: keepPreviousData }));
  const findings = contrast?.findings ?? [];
  const isBlocked = findings.some(({ level }) => level === "block");
  const change = (changes: Partial<StylePreset>) => setDraft((current) => ({ ...current, ...changes }));

  return (
    <>
      <div className="-mx-5 grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-6 overflow-hidden px-5">
        <div className="-mr-3 flex min-h-0 flex-col gap-5 overflow-y-auto pr-3">
          <NameField value={draft.name} onChange={(name) => change({ name })} />
          <PaletteSection palette={draft.palette} onChange={(palette) => change({ palette })} />
          <TypographySection typography={draft.typography} onChange={(typography) => change({ typography })} />
          <TreatmentsSection treatments={draft.treatments} onChange={(treatments) => change({ treatments })} />
          <Section title="Motion" help="How energetically, and in what manner, elements move.">
            <Row label="Energy">{() => <Segmented label="Energy" value={draft.motion.energy} options={ENERGY_OPTIONS} onChange={(energy) => change({ motion: { ...draft.motion, energy } })} />}</Row>
            <Row label="Character">
              {() => <Segmented label="Character" value={draft.motion.character} options={CHARACTER_OPTIONS} onChange={(character) => change({ motion: { ...draft.motion, character } })} />}
            </Row>
          </Section>
          <DirectionSection value={draft.direction} onChange={(direction) => change({ direction })} />
          <Section title="Structure" help="Which Transitions the agent may use between Scenes, and how readily it lays Scenes out on a Canvas.">
            <TransitionsPicker value={draft.transitions} onChange={(transitions) => change({ transitions })} />
            <Row label="Canvas">{() => <Segmented label="Canvas" value={draft.canvas} options={CANVAS_OPTIONS} onChange={(canvas) => change({ canvas })} />}</Row>
          </Section>
          <Section title="Captions" help="How Captions show the word being spoken, when a video has them on.">
            <Row label="Style">{() => <Segmented label="Caption style" value={draft.captions} options={CAPTION_OPTIONS} onChange={(captions) => change({ captions })} />}</Row>
          </Section>
        </div>
        <aside aria-label="Preview and contrast" className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <SampleView preset={StylePresetSchema.safeParse(sampled).data ?? preset} />
          <ContrastReport findings={findings} />
        </aside>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-hairline-soft pt-4">
        <p role="status" className="mr-auto text-app-xs text-status-fallback-ink">
          {footerMessage({ error: save.error, issue: parsed.error?.issues[0]?.message, isBlocked })}
        </p>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!parsed.success || isBlocked || save.isPending} onClick={() => parsed.data && save.mutate(parsed.data, { onSuccess: onDone })}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );
}

function footerMessage({ error, issue, isBlocked }: { error: unknown; issue?: string; isBlocked: boolean }) {
  if (error) {
    return presetErrorMessage(error);
  }

  if (isBlocked) {
    return "Fix the colors the contrast rule blocks to save.";
  }

  return issue ?? "";
}

function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-app-sm font-medium">
        Name
      </label>
      <Input id={id} value={value} maxLength={40} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function PaletteSection({ palette, onChange }: { palette: Palette; onChange: (palette: Palette) => void }) {
  const { data: palettes = [] } = useQuery(orpc.style.palettes.queryOptions({ staleTime: Infinity }));
  const fills = palette.fills ?? [];

  function startFrom(name: string) {
    const bundled = palettes.find((candidate) => candidate.name === name);

    if (bundled) {
      onChange(structuredClone(bundled));
    }
  }

  function setFill(role: AccentRole, isFill: boolean) {
    const next = isFill ? [...fills, role] : fills.filter((fill) => fill !== role);

    onChange({ ...palette, fills: AccentRoleSchema.options.filter((option) => next.includes(option)) });
  }

  return (
    <Section title="Palette" help="Start from a bundled Palette, then change any role. Mark an accent fill only when it sits behind text rather than being text.">
      <Row label="Start from">
        {(id) => (
          <Select
            id={id}
            value={palettes.some(({ name }) => name === palette.name) ? palette.name : ""}
            options={[...(palettes.some(({ name }) => name === palette.name) ? [] : [{ value: "", label: "Your own colors" }]), ...palettes.map(({ name, mode }) => ({ value: name, label: `${name} · ${mode}` }))]}
            onChange={startFrom}
          />
        )}
      </Row>
      <Row label="Mode">
        {() => (
          <Segmented
            label="Palette mode"
            value={palette.mode}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(mode) => onChange({ ...palette, mode })}
          />
        )}
      </Row>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {PaletteRoleSchema.options.map((role) => (
          <ColorRole
            key={role}
            role={role}
            value={palette.colors[role]}
            onChange={(color) => onChange({ ...palette, name: customName(palette.name, palettes), colors: { ...palette.colors, [role]: color } })}
            fill={isAccent(role) ? { isFill: fills.includes(role), onChange: (isFill) => setFill(role, isFill) } : undefined}
          />
        ))}
      </div>
    </Section>
  );
}

/** Once a bundled Palette's colors change it is the creator's own, and named so. */
function customName(name: string, palettes: Palette[]) {
  return palettes.some((palette) => palette.name === name) ? `${name} (edited)`.slice(0, 40) : name;
}

function isAccent(role: PaletteRole): role is AccentRole {
  return (AccentRoleSchema.options as string[]).includes(role);
}

type FillToggle = { isFill: boolean; onChange: (isFill: boolean) => void };

function ColorRole({ role, value, onChange, fill }: { role: PaletteRole; value: string; onChange: (color: string) => void; fill?: FillToggle }) {
  const id = useId();

  return (
    <div className="flex h-9 items-center gap-2.5 rounded-md bg-surface-2 pr-2 pl-1.5">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="size-6 shrink-0 cursor-pointer rounded-sm border border-hairline bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
      />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-app-sm">{ROLE_LABELS[role]}</span>
        <span className="font-mono text-[11px] text-ink-muted uppercase">{value}</span>
      </label>
      {fill ? (
        <label className="flex shrink-0 items-center gap-1.5 text-app-xs text-ink-muted">
          <input type="checkbox" checked={fill.isFill} onChange={(event) => fill.onChange(event.target.checked)} className="accent-[var(--brand)]" />
          Fill only
        </label>
      ) : null}
    </div>
  );
}

function TypographySection({ typography, onChange }: { typography: Typography; onChange: (typography: Typography) => void }) {
  const { data: pairings = [] } = useQuery(orpc.style.typography.queryOptions({ staleTime: Infinity }));
  const { data: fonts = [] } = useQuery(orpc.style.fonts.queryOptions({ staleTime: Infinity }));
  const faces = Object.keys(FACE_LABELS) as (keyof typeof FACE_LABELS)[];

  function setWeight(face: keyof typeof FACE_LABELS, weight: number) {
    onChange({ ...typography, [face]: { ...typography[face], weight } satisfies Face });
  }

  return (
    <Section title="Typography" help="An OFL font pairing the frame bundles, in the weights it ships.">
      <Row label="Pairing">
        {(id) => (
          <Select
            id={id}
            value={typography.name}
            options={pairings.map(({ name }) => ({ value: name, label: name }))}
            onChange={(name) => {
              const pairing = pairings.find((candidate) => candidate.name === name);

              if (pairing) {
                onChange(structuredClone(pairing));
              }
            }}
          />
        )}
      </Row>
      {faces.map((face) => {
        const { family, weight } = typography[face];
        const weights = fonts.find((font) => font.family === family)?.weights ?? [weight];

        return (
          <Row key={face} label={FACE_LABELS[face]}>
            {(id) => (
              <>
                <span className="flex-1 truncate text-app-sm">{family}</span>
                <Select id={id} value={weight} options={weights.map((value) => ({ value, label: String(value) }))} onChange={(value) => setWeight(face, value)} className="w-24" />
              </>
            )}
          </Row>
        );
      })}
    </Section>
  );
}

function TreatmentsSection({ treatments, onChange }: { treatments: Treatments; onChange: (treatments: Treatments) => void }) {
  const change = (changes: Partial<Treatments>) => onChange({ ...treatments, ...changes });

  return (
    <Section title="Treatments" help="How the frame draws cards, backgrounds, connectors and icons. Scene code never restyles them.">
      <Row label="Surfaces">{() => <Segmented label="Surfaces" value={treatments.surface} options={SURFACE_OPTIONS} onChange={(surface) => change({ surface })} />}</Row>
      <Row label="Corners">{(id) => <Slider id={id} value={treatments.radius} min={0} max={48} unit=" px" onChange={(radius) => change({ radius })} />}</Row>
      <Row label="Background">{(id) => <Select id={id} value={treatments.background} options={BACKGROUND_OPTIONS} onChange={(background) => change({ background })} />}</Row>
      <Row label="Connectors">
        {() => <Segmented label="Connectors" value={treatments.connector.style} options={CONNECTOR_OPTIONS} onChange={(style) => change({ connector: { ...treatments.connector, style } })} />}
      </Row>
      <Row label="Line weight">
        {(id) => <Slider id={id} value={treatments.connector.weight} min={1} max={8} unit=" px" onChange={(weight) => change({ connector: { ...treatments.connector, weight } })} />}
      </Row>
      <Row label="Lines">{() => <Segmented label="Lines" value={treatments.line} options={LINE_OPTIONS} onChange={(line) => change({ line })} />}</Row>
      <Row label="Texture">{(id) => <Select id={id} value={treatments.texture} options={TEXTURE_OPTIONS} onChange={(texture) => change({ texture })} />}</Row>
      <Row label="Icons">{() => <Segmented label="Icons" value={treatments.icons} options={ICON_OPTIONS} onChange={(icons) => change({ icons })} />}</Row>
    </Section>
  );
}

function DirectionSection({ value, onChange }: { value: string; onChange: (direction: string) => void }) {
  const id = useId();

  return (
    <Section title="Direction" help="What the video should feel like, in your words. The agent reads it before every Scene.">
      <textarea
        id={id}
        aria-label="Direction"
        value={value}
        maxLength={DIRECTION_MAX}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md bg-surface-2 px-3 py-2 text-app-sm text-ink outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
      />
      <span className="self-end text-app-xs text-ink-muted tabular-nums">
        {value.length} / {DIRECTION_MAX}
      </span>
    </Section>
  );
}

function TransitionsPicker({ value, onChange }: { value: PresetTransition[]; onChange: (transitions: PresetTransition[]) => void }) {
  function toggle(transition: PresetTransition) {
    const next = value.includes(transition) ? value.filter((candidate) => candidate !== transition) : [...value, transition];

    onChange(TRANSITION_OPTIONS.map((option) => option.value).filter((option) => next.includes(option)));
  }

  return (
    <div role="group" aria-label="Allowed Transitions" className="flex flex-wrap gap-1.5">
      {TRANSITION_OPTIONS.map((option) => {
        const isOn = value.includes(option.value);
        // At least one Transition stays allowed.
        const isLast = isOn && value.length === 1;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isOn}
            disabled={isLast}
            onClick={() => toggle(option.value)}
            className={cn(
              "h-control-sm rounded-pill px-3 text-app-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:cursor-not-allowed",
              isOn ? "bg-surface-3 text-ink shadow-[0_0_0_1px_var(--brand)]" : "bg-surface-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SampleView({ preset }: { preset: StylePreset }) {
  return (
    <figure className="flex flex-col gap-2">
      <PresetSample preset={preset} className="rounded-lg" />
      <figcaption className="text-app-xs text-ink-muted">Drawn by the bundled frame in this Preset. Motion and Transitions show in the video.</figcaption>
    </figure>
  );
}

function ContrastReport({ findings }: { findings: ContrastFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-app-sm font-medium">Contrast</h3>
        <Badge status="success" className="self-start">
          Readable: text and lines pass WCAG AA
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-app-sm font-medium">Contrast</h3>
      <ul className="flex flex-col gap-2">
        {findings.map((finding) => (
          <li key={`${finding.use}-${finding.role}-${finding.against}`} className="flex flex-col gap-1">
            <Badge status={finding.level === "block" ? "fallback" : "flagged"} className="self-start">
              {finding.level === "block" ? "Blocks saving" : "Warning"}
            </Badge>
            <p className="text-app-xs text-ink-muted">{findingMessage(finding)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
