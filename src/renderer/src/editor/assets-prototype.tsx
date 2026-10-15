/**
 * PROTOTYPE, throwaway (Prototype: Assets UX, #71). Three variants of Assets in the editor, switched by
 * `?variant=A|B|C` or the floating bar (← → keys). Open the fixture Project in a dev build to see them.
 * Everything here is stub data in memory: no import reaches the core, no sound plays, no Version is saved.
 *
 * A "Assets tab": a fourth side-panel tab, Sound in the Style tab, one Sound lane under the words.
 * B "Library drawer": a left drawer of tiles beside the player, Music and SFX lanes, sound controls in the timeline.
 * C "Library window": a full Library dialog from the title bar, Sound in the Style tab, sounds as marks on Scene cards.
 */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  LibraryIcon,
  MusicIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  SparklesIcon,
  UploadIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";
import { Row, Section, Segmented, Select, Slider } from "@renderer/style/controls";
import type { TimelineScene, VideoTimeline } from "../../../contract";

export type Variant = "A" | "B" | "C" | "D" | "E";
const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Assets tab" },
  { key: "B", name: "Library drawer" },
  { key: "C", name: "Library window" },
  { key: "D", name: "Library workspace" },
  { key: "E", name: "Docked browser" },
];

/** B, D and E share the Music and SFX lanes and the timeline's Sound button. */
const hasLanes = (variant: Variant | undefined) => variant === "B" || variant === "D" || variant === "E";

function matches(asset: Asset, query: string) {
  const needle = query.trim().toLowerCase();
  return !needle || `${asset.name} ${asset.notes} ${KINDS[asset.kind].label}`.toLowerCase().includes(needle);
}

/* ───────────────────────── audition: a stub tone stands in for the real file ───────────────────────── */

type Audition = { id?: string; started: number; length: number; play: (asset: Asset) => void; stop: () => void };

let context: AudioContext | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let source: OscillatorNode | undefined;

export const useAudition = create<Audition>((set, get) => ({
  started: 0,
  length: 0,
  stop: () => {
    source?.stop();
    source = undefined;
    clearTimeout(timer);
    set({ id: undefined });
  },
  play: (asset) => {
    const wasSame = get().id === asset.id;
    get().stop();
    if (wasSame) return;
    const length = asset.kind === "music" ? 6 : 0.7;
    context ??= new AudioContext();
    const gain = context.createGain();
    source = context.createOscillator();
    source.frequency.value = asset.kind === "music" ? 196 : 880 - asset.name.length * 12;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + length);
    source.connect(gain).connect(context.destination);
    source.start();
    timer = setTimeout(() => get().stop(), length * 1000);
    set({ id: asset.id, started: performance.now(), length });
  },
}));

type Kind = "sfx" | "music" | "image" | "logo";
type Scope = "bundled" | "library" | "project";
type Asset = { id: string; kind: Kind; name: string; notes: string; scope: Scope; facts: string; tint?: string };
type Sfx = "off" | "subtle" | "lively";

const KINDS: Record<Kind, { label: string; plural: string; icon: LucideIcon }> = {
  sfx: { label: "Sound effect", plural: "Sound effects", icon: Volume2Icon },
  music: { label: "Music", plural: "Music", icon: MusicIcon },
  image: { label: "Image", plural: "Images", icon: ImageIcon },
  logo: { label: "Logo", plural: "Logos", icon: SparklesIcon },
};

const SCOPES: Record<Scope, string> = { bundled: "Bundled", library: "Your Library", project: "This Project" };

const STUB_ASSETS: Asset[] = [
  { id: "bundled:whoosh-soft", kind: "sfx", name: "Soft whoosh", notes: "Push and zoom Transitions.", scope: "bundled", facts: "0.6 s · −14 LUFS" },
  { id: "bundled:click-soft", kind: "sfx", name: "Soft click", notes: "Crossfades.", scope: "bundled", facts: "0.1 s · −16 LUFS" },
  { id: "bundled:impact-low", kind: "sfx", name: "Low impact", notes: "A number or stat landing.", scope: "bundled", facts: "1.2 s · −12 LUFS" },
  { id: "bundled:sting-bong", kind: "sfx", name: "Bong sting", notes: "The closing line.", scope: "bundled", facts: "2.0 s · −13 LUFS" },
  { id: "a91c…", kind: "sfx", name: "Keyboard clack", notes: "When code appears on screen.", scope: "library", facts: "0.4 s · −15 LUFS" },
  { id: "bundled:bed-lofi", kind: "music", name: "Lo-fi bed (HoliznaCC0)", notes: "Calm explainers.", scope: "bundled", facts: "3:28 · −19 LUFS" },
  { id: "bundled:bed-pulse", kind: "music", name: "Pulse bed (HoliznaCC0)", notes: "Upbeat launches.", scope: "bundled", facts: "2:12 · −17 LUFS" },
  { id: "4be0…", kind: "music", name: "Our brand theme", notes: "Company videos only.", scope: "library", facts: "1:05 · −14 LUFS" },
  { id: "77d2…", kind: "logo", name: "Acme logo", notes: "Our company mark; the outro and title.", scope: "library", facts: "SVG · transparent", tint: "#6d5ef7" },
  { id: "c03f…", kind: "image", name: "Dashboard screenshot", notes: "The new usage dashboard, for the hook.", scope: "project", facts: "2880×1800 · PNG", tint: "#1f6f5c" },
  { id: "e1aa…", kind: "logo", name: "Postgres logo", notes: "Whenever Postgres is named.", scope: "project", facts: "PNG · transparent", tint: "#336791" },
];

type ProtoState = {
  variant: Variant;
  assets: Asset[];
  music: string;
  sfx: Sfx;
  musicLevel: number;
  sfxLevel: number;
  isLibraryOpen: boolean;
  /** The Library dialog picks a music bed rather than browsing. */
  isPickingMusic: boolean;
  set: (patch: Partial<ProtoState>) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
};

function initialVariant(): Variant {
  const param = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.some(({ key }) => key === param) ? (param as Variant) : "A";
}

export const useAssetsProto = create<ProtoState>((set) => ({
  variant: initialVariant(),
  assets: STUB_ASSETS,
  music: "bundled:bed-lofi",
  sfx: "subtle",
  musicLevel: -18,
  sfxLevel: -6,
  isLibraryOpen: false,
  isPickingMusic: false,
  set: (patch) => set(patch),
  addAsset: (asset) => set((state) => ({ assets: [...state.assets, asset] })),
  updateAsset: (id, patch) => set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)) })),
}));

export function useVariant(): Variant | undefined {
  const variant = useAssetsProto((state) => state.variant);
  return import.meta.env.DEV ? variant : undefined;
}

/* ───────────────────────── stub placements, derived from the real timeline ───────────────────────── */

type Placed = { at: number; asset: Asset; source: "transition" | "agent" };

function placedSounds(scenes: TimelineScene[], assets: Asset[], sfx: Sfx): Placed[] {
  if (sfx === "off") {
    return [];
  }

  const byId = (id: string) => assets.find((asset) => asset.id === id)!;
  const rules: Placed[] = scenes.flatMap((scene) => {
    const type = scene.transitionIn;
    if (type === "crossfade") return [{ at: scene.start, asset: byId("bundled:click-soft"), source: "transition" as const }];
    if (type?.startsWith("push") || type === "zoom-through") return [{ at: scene.start, asset: byId("bundled:whoosh-soft"), source: "transition" as const }];
    return [];
  });
  const agent: Placed[] = scenes.flatMap((scene) => {
    if (scene.type === "stat-chart") return [{ at: scene.start + 0.8, asset: byId("bundled:impact-low"), source: "agent" as const }];
    if (scene.type === "outro") return [{ at: scene.start + 0.4, asset: byId("bundled:sting-bong"), source: "agent" as const }];
    return [];
  });

  return [...rules, ...(sfx === "lively" ? agent : agent.slice(-1))];
}

/** The stub images a Scene shows: the screenshot on the hook, the logo on the outro. */
function placedMedia(scene: TimelineScene, assets: Asset[]): Asset[] {
  if (scene.type === "hook") return assets.filter(({ id }) => id === "c03f…");
  if (scene.type === "outro") return assets.filter(({ id }) => id === "77d2…");
  return [];
}

/* ───────────────────────── floating switcher ───────────────────────── */

export function PrototypeSwitcher() {
  const variant = useAssetsProto((state) => state.variant);
  const set = useAssetsProto((state) => state.set);
  const index = VARIANTS.findIndex(({ key }) => key === variant);

  function go(step: number) {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    set({ variant: next, isLibraryOpen: false });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], [role=slider]")) return;
      if (event.key === "ArrowLeft" && event.altKey) go(-1);
      if (event.key === "ArrowRight" && event.altKey) go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-pill bg-[#ffe14d] px-1.5 py-1 text-[13px] font-medium text-black shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
      <button type="button" aria-label="Previous variant" className="grid size-7 place-items-center rounded-full hover:bg-black/10" onClick={() => go(-1)}>
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="px-1 tabular-nums">
        PROTOTYPE {variant} ({VARIANTS[index]!.name}) · Alt+←/→
      </span>
      <button type="button" aria-label="Next variant" className="grid size-7 place-items-center rounded-full hover:bg-black/10" onClick={() => go(1)}>
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

function KindMark({ asset, size = 32 }: { asset: Asset; size?: number }) {
  const Icon = KINDS[asset.kind].icon;
  const isVisual = asset.kind === "image" || asset.kind === "logo";

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-sm bg-surface-3 text-ink-muted"
      style={{ width: size, height: size, background: isVisual ? asset.tint : undefined, color: isVisual ? "#fff" : undefined }}
    >
      <Icon className="size-[45%]" />
    </span>
  );
}

function PreviewButton({ asset }: { asset: Asset }) {
  const isPlaying = useAudition((state) => state.id === asset.id);
  const play = useAudition((state) => state.play);
  if (asset.kind !== "sfx" && asset.kind !== "music") return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${isPlaying ? "Stop" : "Play"} ${asset.name}`}
      aria-pressed={isPlaying}
      className={cn(isPlaying && "text-primary")}
      onClick={(event) => {
        event.stopPropagation();
        play(asset);
      }}
    >
      {isPlaying ? <SquareIcon /> : <PlayIcon />}
    </Button>
  );
}

function SearchField({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={cn("flex h-control-sm items-center gap-2 rounded-md bg-surface-2 px-2.5 focus-within:shadow-[0_0_0_1px_var(--brand)]", className)}>
      <SearchIcon className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search names and notes"
        aria-label="Search Assets"
        className="min-w-0 flex-1 bg-transparent text-app-sm outline-none placeholder:text-ink-muted"
      />
    </label>
  );
}

/** Import: a stub file picker, then name, kind and notes; notes are required for images and logos. */
function ImportForm({ scope, onDone }: { scope: Scope; onDone: () => void }) {
  const addAsset = useAssetsProto((state) => state.addAsset);
  const [kind, setKind] = useState<Kind>("image");
  const [name, setName] = useState("architecture.png");
  const [notes, setNotes] = useState("");
  const needsNotes = kind === "image" || kind === "logo";

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-hairline-soft bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        addAsset({ id: `${Math.random().toString(16).slice(2, 6)}…`, kind, name, notes, scope, facts: "1920×1080 · PNG (stub)", tint: "#8a4b2f" });
        onDone();
      }}
    >
      <p className="text-app-xs text-ink-muted">Copied into {SCOPES[scope]}. The original file is never used again.</p>
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" className="h-control-sm rounded-md bg-surface-2 px-2.5 text-app-sm outline-none" />
      <Select id="proto-kind" value={kind} options={Object.entries(KINDS).map(([value, { label }]) => ({ value: value as Kind, label }))} onChange={setKind} />
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
        placeholder={needsNotes ? "What it shows and when to use it (required)" : "When to use it (optional)"}
        className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none"
      />
      <div className="flex gap-2">
        <Button size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={needsNotes && !notes.trim()}>
          Import
        </Button>
      </div>
    </form>
  );
}

function soundOptions(assets: Asset[]) {
  return [{ value: "none", label: "None" }, ...assets.filter(({ kind }) => kind === "music").map(({ id, name }) => ({ value: id, label: name }))];
}

const SFX_OPTIONS = [
  { value: "off" as const, label: "Off" },
  { value: "subtle" as const, label: "Subtle" },
  { value: "lively" as const, label: "Lively" },
];

/** The sound controls, every one a swap: re-render only, no agent run. */
function SoundControls({ musicPicker }: { musicPicker: React.ReactNode }) {
  const { sfx, musicLevel, sfxLevel, set } = useAssetsProto();

  return (
    <div className="flex flex-col gap-3">
      {musicPicker}
      <Row label="Sound effects">{() => <Segmented label="Sound effects" value={sfx} options={SFX_OPTIONS} onChange={(next) => set({ sfx: next })} />}</Row>
      <Row label="Music level">{(id) => <Slider id={id} value={musicLevel} min={-30} max={-6} unit=" dB" onChange={(next) => set({ musicLevel: next })} />}</Row>
      <Row label="Effects level">{(id) => <Slider id={id} value={sfxLevel} min={-20} max={0} unit=" dB" onChange={(next) => set({ sfxLevel: next })} />}</Row>
    </div>
  );
}

/* ───────────────────────── A: Assets tab ───────────────────────── */

export function AssetsTab() {
  const assets = useAssetsProto((state) => state.assets);
  const [importing, setImporting] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-app-xs text-ink-muted">The agent sees every Asset here with its notes.</p>
        <Button size="sm" onClick={() => setImporting(true)}>
          <UploadIcon />
          Import
        </Button>
      </div>
      {importing ? <ImportForm scope="project" onDone={() => setImporting(false)} /> : null}
      {(["project", "library", "bundled"] as const).map((scope) => (
        <Section key={scope} title={SCOPES[scope]} help={scope === "bundled" ? "Ships with MotionBrief." : undefined}>
          {(Object.keys(KINDS) as Kind[]).map((kind) => {
            const rows = assets.filter((asset) => asset.scope === scope && asset.kind === kind);
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="flex flex-col gap-0.5">
                <p className="text-[11px] tracking-wide text-ink-muted uppercase">{KINDS[kind].plural}</p>
                {rows.map((asset) => (
                  <AssetRow key={asset.id} asset={asset} />
                ))}
              </div>
            );
          })}
        </Section>
      ))}
    </div>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  const updateAsset = useAssetsProto((state) => state.updateAsset);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col gap-1 rounded-[10px] p-1.5 hover:bg-surface-1">
      <div className="flex items-center gap-2.5">
        <KindMark asset={asset} />
        <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => setIsEditing(!isEditing)} title="Edit notes">
          <span className="truncate text-app-sm">{asset.name}</span>
          <span className="truncate text-app-xs text-ink-muted">{asset.notes || "No notes"}</span>
        </button>
        <PreviewButton asset={asset} />
        {asset.scope === "project" ? (
          <Button variant="ghost" size="icon-sm" aria-label="Add to Library" title="Add to Library" onClick={() => updateAsset(asset.id, { scope: "library" })}>
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {isEditing ? (
        <div className="flex flex-col gap-1.5 pl-[42px]">
          <span className="text-app-xs text-ink-muted tabular-nums">{asset.facts}</span>
          {asset.scope === "bundled" ? null : (
            <textarea
              value={asset.notes}
              rows={2}
              onChange={(event) => updateAsset(asset.id, { notes: event.target.value })}
              className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A and C: the Sound section at the end of the Style tab. */
export function StyleSound() {
  const variant = useVariant();
  const { assets, music, set } = useAssetsProto();

  if (variant !== "A" && variant !== "C") return null;

  const picker =
    variant === "A" ? (
      <Row label="Music">{(id) => <Select id={id} value={music} options={soundOptions(assets)} onChange={(next) => set({ music: next })} />}</Row>
    ) : (
      <MusicCard />
    );

  return (
    <Section title="Sound" help="No agent run and no cost. Each change saves a Version.">
      <SoundControls musicPicker={picker} />
    </Section>
  );
}

/** C: the chosen bed as a card; Change… opens the Library on Music. */
function MusicCard() {
  const { assets, music, set } = useAssetsProto();
  const bed = assets.find(({ id }) => id === music);

  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-surface-1 p-2">
      {bed ? <KindMark asset={bed} size={36} /> : <span className="grid size-9 place-items-center rounded-sm bg-surface-2 text-ink-muted">–</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-app-sm">{bed?.name ?? "No music"}</span>
        <span className="truncate text-app-xs text-ink-muted">{bed ? `${bed.facts} · fitted, looped and ducked` : "Voice and effects only"}</span>
      </span>
      <Button size="sm" onClick={() => set({ isLibraryOpen: true, isPickingMusic: true })}>
        Change…
      </Button>
    </div>
  );
}

/* ───────────────────────── B: Library drawer ───────────────────────── */

const FILTERS: { value: Kind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sfx", label: "SFX" },
  { value: "music", label: "Music" },
  { value: "image", label: "Images" },
  { value: "logo", label: "Logos" },
];

export function LibraryDrawer() {
  const variant = useVariant();
  const assets = useAssetsProto((state) => state.assets);
  const [isOpen, setIsOpen] = useState(true);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [where, setWhere] = useState<"project" | "library">("project");
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");

  if (variant !== "B") return null;

  if (!isOpen) {
    return (
      <aside className="flex shrink-0 flex-col items-center border-r border-hairline-soft px-1.5 pt-4">
        <Button variant="ghost" size="icon-sm" aria-label="Open the Library" title="Library" onClick={() => setIsOpen(true)}>
          <LibraryIcon />
        </Button>
      </aside>
    );
  }

  const shown = assets.filter(
    (asset) => matches(asset, query) && (filter === "all" || asset.kind === filter) && (where === "project" ? asset.scope === "project" || isUsed(asset) : asset.scope !== "project"),
  );

  return (
    <aside aria-label="Library" className="flex w-[280px] shrink-0 flex-col gap-3 border-r border-hairline-soft p-3">
      <div className="flex items-center gap-2">
        <LibraryIcon className="size-4 text-ink-muted" aria-hidden="true" />
        <h2 className="flex-1 text-app-sm font-medium">Assets</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setIsOpen(false)}>
          <XIcon />
        </Button>
      </div>
      <Segmented
        label="Where"
        value={where}
        options={[
          { value: "project", label: "This video" },
          { value: "library", label: "Library" },
        ]}
        onChange={setWhere}
      />
      <SearchField value={query} onChange={setQuery} />
      <div className="flex flex-wrap gap-1">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn("h-6 rounded-pill px-2.5 text-app-xs text-ink-muted hover:text-ink", filter === value && "bg-surface-3 text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setImporting(true)}
        className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-hairline text-app-xs text-ink-muted hover:text-ink"
      >
        <UploadIcon className="size-4" />
        Drop files or click to import
      </button>
      {importing ? <ImportForm scope={where} onDone={() => setImporting(false)} /> : null}
      <div className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto">
        {shown.map((asset) => (
          <AssetTile key={asset.id} asset={asset} />
        ))}
        {shown.length === 0 ? <p className="col-span-2 py-6 text-center text-app-xs text-ink-muted">Nothing matches “{query}”.</p> : null}
      </div>
    </aside>
  );
}

/** Stub: what the open video uses besides Project Assets. */
function isUsed(asset: Asset) {
  return ["bundled:whoosh-soft", "bundled:click-soft", "bundled:sting-bong", "bundled:bed-lofi", "77d2…"].includes(asset.id);
}

function AssetTile({ asset }: { asset: Asset }) {
  const updateAsset = useAssetsProto((state) => state.updateAsset);
  const isVisual = asset.kind === "image" || asset.kind === "logo";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-surface-1 p-1.5 text-left hover:bg-surface-2">
          <span className="grid aspect-video w-full place-items-center rounded-sm" style={{ background: isVisual ? asset.tint : "var(--surface-3)" }}>
            {isVisual ? <KindMark asset={asset} size={28} /> : <Waveform />}
          </span>
          <span className="truncate text-app-xs">{asset.name}</span>
          <span className="truncate text-[11px] text-ink-muted">{KINDS[asset.kind].label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" className="flex w-[260px] flex-col gap-2">
        <p className="text-app-sm font-medium">{asset.name}</p>
        <p className="text-app-xs text-ink-muted tabular-nums">
          {SCOPES[asset.scope]} · {asset.facts}
        </p>
        <textarea
          value={asset.notes}
          rows={3}
          disabled={asset.scope === "bundled"}
          onChange={(event) => updateAsset(asset.id, { notes: event.target.value })}
          className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none disabled:opacity-60"
        />
        <div className="flex gap-2">
          <PreviewButton asset={asset} />
          {asset.scope === "project" ? (
            <Button size="sm" onClick={() => updateAsset(asset.id, { scope: "library" })}>
              Add to Library
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Waveform() {
  return (
    <span aria-hidden="true" className="flex h-6 items-center gap-[2px]">
      {[3, 7, 12, 9, 16, 11, 6, 13, 8, 4, 10, 5].map((height, index) => (
        <span key={index} className="w-[3px] rounded-full bg-ink-muted" style={{ height }} />
      ))}
    </span>
  );
}

/** B: the sound controls behind a timeline header button. */
export function TimelineSoundButton() {
  const variant = useVariant();
  if (!hasLanes(variant)) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <SlidersHorizontalIcon />
          Sound
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-[340px]">
        <SoundControls musicPicker={null} />
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── timeline lanes (A one lane, B two) ───────────────────────── */

const LANE = 24;

export function soundLanesHeight(variant: Variant | undefined) {
  if (variant === "A") return LANE + 8;
  if (hasLanes(variant)) return 2 * LANE + 12;
  return 0;
}

export function SoundLanes({ timeline, px, top }: { timeline: VideoTimeline; px: number; top: number }) {
  const variant = useVariant();
  const { assets, music, sfx, set } = useAssetsProto();
  const bed = assets.find(({ id }) => id === music);
  const sounds = placedSounds(timeline.scenes, assets, sfx);

  if (variant === "A") {
    return (
      <div role="group" aria-label="Sound" className="absolute inset-x-0" style={{ top, height: LANE }}>
        {bed ? <MusicBar bed={bed} duration={timeline.duration} px={px} height={LANE} /> : null}
        {sounds.map((sound) => (
          <SoundDot key={`${sound.at}`} sound={sound} px={px} top={LANE / 2} />
        ))}
      </div>
    );
  }

  if (!hasLanes(variant)) return null;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="absolute left-0 text-left" style={{ top, height: LANE, width: timeline.duration * px }} aria-label="Change the music">
            {bed ? (
              <MusicBar bed={bed} duration={timeline.duration} px={px} height={LANE} labelled />
            ) : (
              <span className="flex h-full items-center rounded-sm border border-dashed border-hairline px-2 text-app-xs text-ink-muted">
                <PlusIcon className="mr-1 size-3" /> Add music
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="flex w-[280px] flex-col gap-0.5 p-1.5">
          {soundOptions(assets).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => set({ music: option.value })}
              className={cn("rounded-md px-2.5 py-1.5 text-left text-app-sm hover:bg-surface-2", option.value === music && "bg-surface-2")}
            >
              {option.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <div role="group" aria-label="Sound effects" className="absolute inset-x-0" style={{ top: top + LANE + 4, height: LANE }}>
        {sounds.map((sound) => (
          <SoundChip key={`${sound.at}`} sound={sound} px={px} />
        ))}
      </div>
    </>
  );
}

function MusicBar({ bed, duration, px, height, labelled }: { bed: Asset; duration: number; px: number; height: number; labelled?: boolean }) {
  const fade = Math.min(1, duration) * px;

  return (
    <span
      title={`${bed.name}: fade in, ducked under the Voiceover, fade out over the last Scene`}
      className="absolute left-0 flex items-center overflow-hidden rounded-sm bg-[#2a2440] px-2 text-[11px] text-[#c9c0ff]"
      style={{ width: duration * px, height, clipPath: `polygon(0 100%, ${fade}px 0, calc(100% - ${fade * 4}px) 0, 100% 100%)` }}
    >
      {labelled ? (
        <>
          <MusicIcon className="mr-1.5 size-3" aria-hidden="true" />
          {bed.name}
        </>
      ) : null}
    </span>
  );
}

function SoundDot({ sound, px, top }: { sound: Placed; px: number; top: number }) {
  return (
    <span
      title={`${sound.asset.name} · ${sound.source === "agent" ? "placed by the agent" : "Transition rule"}`}
      className={cn("absolute -mt-[5px] -ml-[5px] size-2.5 rounded-full shadow-[0_0_0_2px_#0b0b0b]", sound.source === "agent" ? "bg-[#ffb547]" : "bg-ink-muted")}
      style={{ left: sound.at * px, top }}
    />
  );
}

function SoundChip({ sound, px }: { sound: Placed; px: number }) {
  return (
    <span
      title={sound.source === "agent" ? "Placed by the agent; revise by prompt" : "From the Style Preset's Transition rule"}
      className={cn(
        "absolute flex h-full items-center gap-1 rounded-sm px-1.5 text-[11px] whitespace-nowrap",
        sound.source === "agent" ? "bg-[#3d2a10] text-[#ffcf8a]" : "bg-surface-2 text-ink-muted",
      )}
      style={{ left: sound.at * px }}
    >
      <Volume2Icon className="size-3" aria-hidden="true" />
      {sound.asset.name}
    </span>
  );
}

/* ───────────────────────── C: marks on Scene cards, and the Library window ───────────────────────── */

export function SceneMarks({ scene, px, top, height }: { scene: TimelineScene; px: number; top: number; height: number }) {
  const variant = useVariant();
  const { assets, sfx } = useAssetsProto();

  if (variant !== "C") return null;

  const sounds = placedSounds([scene], assets, sfx).filter(({ source }) => source === "agent");
  const media = placedMedia(scene, assets);
  const marks = [...sounds.map(({ asset }) => asset), ...media];
  if (marks.length === 0 || (scene.end - scene.start) * px < 60) return null;

  return (
    <span className="pointer-events-none absolute z-[3] flex gap-1" style={{ left: scene.start * px + 8, top: top + height - 26 }}>
      {marks.map((asset) => (
        <span key={asset.id} title={asset.name} className="flex h-5 items-center gap-1 rounded-pill bg-black/70 px-1.5 text-[11px] text-ink">
          {(() => {
            const Icon = KINDS[asset.kind].icon;
            return <Icon className="size-3" aria-hidden="true" />;
          })()}
          <span className="max-w-[90px] truncate">{asset.name}</span>
        </span>
      ))}
    </span>
  );
}

export function LibraryButton() {
  const variant = useVariant();
  const set = useAssetsProto((state) => state.set);
  if (variant !== "C") return null;

  return (
    <Button size="sm" className="no-drag-region" onClick={() => set({ isLibraryOpen: true, isPickingMusic: false })}>
      <LibraryIcon />
      Library
    </Button>
  );
}

export function LibraryWindow() {
  const variant = useVariant();
  const { assets, isLibraryOpen, isPickingMusic, music, set, updateAsset } = useAssetsProto();
  const [kind, setKind] = useState<Kind>("image");
  const [selected, setSelected] = useState<string>();
  const [importing, setImporting] = useState(false);
  const shownKind = isPickingMusic ? "music" : kind;
  const rows = assets.filter((asset) => asset.kind === shownKind);
  const current = assets.find(({ id }) => id === selected) ?? rows[0];

  if (variant !== "C") return null;

  return (
    <Dialog open={isLibraryOpen} onOpenChange={(open) => set({ isLibraryOpen: open })}>
      <DialogContent className="flex h-[min(620px,calc(100vh-4rem))] flex-col gap-3 sm:max-w-[880px]">
        <DialogHeader>
          <DialogTitle>{isPickingMusic ? "Choose the music bed" : "Library"}</DialogTitle>
          <DialogDescription>Assets the agent can use, with the notes it reads. Imports are copied; the Project keeps its own copy of every Asset a Version uses.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3">
          <nav className="flex w-[150px] shrink-0 flex-col gap-0.5">
            {(Object.keys(KINDS) as Kind[]).map((value) => {
              const Icon = KINDS[value].icon;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={isPickingMusic && value !== "music"}
                  onClick={() => setKind(value)}
                  className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-app-sm text-ink-muted hover:text-ink disabled:opacity-40", shownKind === value && "bg-surface-2 text-ink")}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {KINDS[value].plural}
                  <span className="ml-auto text-app-xs tabular-nums">{assets.filter((asset) => asset.kind === value).length}</span>
                </button>
              );
            })}
            <Button size="sm" className="mt-3" onClick={() => setImporting(true)}>
              <UploadIcon />
              Import…
            </Button>
          </nav>
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {importing ? <ImportForm scope="library" onDone={() => setImporting(false)} /> : null}
            {rows.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => setSelected(asset.id)}
                  className={cn("flex w-full items-center gap-2.5 rounded-[10px] p-1.5 text-left hover:bg-surface-1", current?.id === asset.id && "bg-surface-2")}
                >
                  <KindMark asset={asset} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-app-sm">{asset.name}</span>
                    <span className="truncate text-app-xs text-ink-muted">{SCOPES[asset.scope]}</span>
                  </span>
                  {asset.id === music ? <span className="text-app-xs text-primary">In use</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {current ? (
            <section className="flex w-[260px] shrink-0 flex-col gap-2 rounded-lg bg-surface-1 p-3">
              <span className="grid aspect-video w-full place-items-center rounded-sm" style={{ background: current.tint ?? "var(--surface-3)" }}>
                {current.tint ? <KindMark asset={current} size={36} /> : <Waveform />}
              </span>
              <p className="text-app-sm font-medium">{current.name}</p>
              <p className="text-app-xs text-ink-muted tabular-nums">
                {KINDS[current.kind].label} · {current.facts} · {SCOPES[current.scope]}
              </p>
              <label className="text-app-xs text-ink-muted" htmlFor="proto-notes">
                Notes for the agent
              </label>
              <textarea
                id="proto-notes"
                value={current.notes}
                rows={4}
                disabled={current.scope === "bundled"}
                onChange={(event) => updateAsset(current.id, { notes: event.target.value })}
                className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none disabled:opacity-60"
              />
              <div className="mt-auto flex gap-2">
                <PreviewButton asset={current} />
                {isPickingMusic ? (
                  <Button size="sm" variant="primary" onClick={() => set({ music: current.id, isLibraryOpen: false })}>
                    Use as music
                  </Button>
                ) : null}
                {isPickingMusic ? (
                  <Button size="sm" onClick={() => set({ music: "none", isLibraryOpen: false })}>
                    No music
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── D: Library workspace, a non-modal pane beside the player ───────────────────────── */

type ScopeFilter = Scope | "all";

/** A waveform that fills with progress while it auditions; images show their swatch instead. */
function AuditionWave({ asset, bars = 40 }: { asset: Asset; bars?: number }) {
  const audition = useAudition();
  const isPlaying = audition.id === asset.id;
  const seed = asset.name.length;

  return (
    <span aria-hidden="true" className="relative flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className="w-[2px] shrink-0 rounded-full bg-[#3a3a3a]" style={{ height: 4 + ((index * 7 + seed * 3) % 17) }} />
      ))}
      {isPlaying ? (
        <span
          key={audition.started}
          className="absolute inset-y-0 left-0 bg-primary/25 mix-blend-screen"
          style={{ animation: `proto-fill ${audition.length}s linear forwards` }}
        />
      ) : null}
      <style>{"@keyframes proto-fill { from { width: 0 } to { width: 100% } }"}</style>
    </span>
  );
}

function useFiltered(kind: Kind | "all", scope: ScopeFilter, query: string) {
  const assets = useAssetsProto((state) => state.assets);
  return assets.filter((asset) => matches(asset, query) && (kind === "all" || asset.kind === kind) && (scope === "all" || asset.scope === scope));
}

function KindNav({ kind, onKind, scope, onScope }: { kind: Kind | "all"; onKind: (kind: Kind | "all") => void; scope: ScopeFilter; onScope: (scope: ScopeFilter) => void }) {
  const assets = useAssetsProto((state) => state.assets);
  const item = (isOn: boolean) =>
    cn("flex h-7 items-center gap-2 rounded-md px-2 text-left text-app-sm text-ink-muted transition-colors hover:text-ink", isOn && "bg-surface-2 text-ink");

  return (
    <nav aria-label="Filter Assets" className="flex w-[148px] shrink-0 flex-col gap-0.5">
      <button type="button" aria-pressed={kind === "all"} className={item(kind === "all")} onClick={() => onKind("all")}>
        <LibraryIcon className="size-3.5" aria-hidden="true" />
        Everything
        <span className="ml-auto text-app-xs tabular-nums">{assets.length}</span>
      </button>
      {(Object.keys(KINDS) as Kind[]).map((value) => {
        const Icon = KINDS[value].icon;
        return (
          <button key={value} type="button" aria-pressed={kind === value} className={item(kind === value)} onClick={() => onKind(value)}>
            <Icon className="size-3.5" aria-hidden="true" />
            {KINDS[value].plural}
            <span className="ml-auto text-app-xs tabular-nums">{assets.filter((asset) => asset.kind === value).length}</span>
          </button>
        );
      })}
      <span className="mt-3 mb-1 px-2 text-app-xs text-ink-muted">From</span>
      {(["all", "project", "library", "bundled"] as const).map((value) => (
        <button key={value} type="button" aria-pressed={scope === value} className={item(scope === value)} onClick={() => onScope(value)}>
          {value === "all" ? "Anywhere" : SCOPES[value]}
        </button>
      ))}
    </nav>
  );
}

/** Space auditions the selected sound; ↑/↓ move the selection and audition as they go when `autoplay` is on. */
function useListKeys(rows: Asset[], selected: Asset | undefined, onSelect: (id: string) => void, autoplay: boolean) {
  const play = useAudition((state) => state.play);

  return (event: React.KeyboardEvent) => {
    const index = rows.findIndex(({ id }) => id === selected?.id);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;

    if (step) {
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
      if (!next) return;
      onSelect(next.id);
      if (autoplay && (next.kind === "sfx" || next.kind === "music")) play(next);
    } else if (event.key === " " && selected) {
      // Space here auditions; keep it from also playing the video.
      event.preventDefault();
      event.stopPropagation();
      play(selected);
    }
  };
}

export function LibraryWorkspace() {
  const variant = useVariant();
  const { music, set, updateAsset } = useAssetsProto();
  const [isOpen, setIsOpen] = useState(true);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [importing, setImporting] = useState(false);
  const rows = useFiltered(kind, scope, query);
  const selected = rows.find(({ id }) => id === selectedId) ?? rows[0];
  const onKeyDown = useListKeys(rows, selected, setSelectedId, true);

  if (variant !== "D") return null;

  if (!isOpen) {
    return (
      <aside className="flex shrink-0 flex-col items-center border-r border-hairline-soft px-1.5 pt-4">
        <Button variant="ghost" size="icon-sm" aria-label="Open the Library" title="Library" onClick={() => setIsOpen(true)}>
          <LibraryIcon />
        </Button>
      </aside>
    );
  }

  return (
    <aside aria-label="Library" className="flex w-[min(820px,58%)] shrink-0 flex-col gap-3 border-r border-hairline-soft p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-app-body font-medium">Library</h2>
        <SearchField value={query} onChange={setQuery} className="ml-2 max-w-[320px] flex-1" />
        <span className="flex-1" />
        <Button size="sm" onClick={() => setImporting(true)}>
          <UploadIcon />
          Import
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Collapse the Library" title="Collapse" onClick={() => setIsOpen(false)}>
          <ChevronLeftIcon />
        </Button>
      </div>
      {importing ? <ImportForm scope="project" onDone={() => setImporting(false)} /> : null}
      <div className="flex min-h-0 flex-1 gap-3">
        <KindNav kind={kind} onKind={setKind} scope={scope} onScope={setScope} />
        <ul aria-label="Assets" tabIndex={0} onKeyDown={onKeyDown} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-md outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]">
          {rows.map((asset) => (
            <li
              key={asset.id}
              aria-selected={selected?.id === asset.id}
              onClick={() => setSelectedId(asset.id)}
              className={cn("flex cursor-default items-center gap-2.5 rounded-[10px] p-1.5 hover:bg-surface-1", selected?.id === asset.id && "bg-surface-2 hover:bg-surface-2")}
            >
              {asset.kind === "sfx" || asset.kind === "music" ? <PreviewButton asset={asset} /> : <KindMark asset={asset} size={30} />}
              <span className="flex w-[34%] min-w-0 flex-col">
                <span className="truncate text-app-sm">{asset.name}</span>
                <span className="truncate text-app-xs text-ink-muted">{asset.notes || "No notes"}</span>
              </span>
              {asset.kind === "sfx" || asset.kind === "music" ? <AuditionWave asset={asset} /> : <span className="flex-1" />}
              <span className="w-[92px] shrink-0 truncate text-right text-app-xs text-ink-muted tabular-nums">{asset.facts.split(" · ")[0]}</span>
            </li>
          ))}
          {rows.length === 0 ? <li className="py-8 text-center text-app-xs text-ink-muted">Nothing matches. Try fewer words, or Import a file.</li> : null}
        </ul>
        {selected ? (
          <section aria-label="Selected Asset" className="flex w-[220px] shrink-0 flex-col gap-2">
            <span className="grid aspect-video w-full place-items-center rounded-md" style={{ background: selected.tint ?? "var(--surface-1)" }}>
              {selected.tint ? <KindMark asset={selected} size={36} /> : <PreviewButton asset={selected} />}
            </span>
            <p className="text-app-sm font-medium">{selected.name}</p>
            <p className="text-app-xs text-ink-muted tabular-nums">
              {KINDS[selected.kind].label} · {selected.facts}
              <br />
              {SCOPES[selected.scope]}
            </p>
            <label htmlFor="proto-d-notes" className="mt-1 text-app-xs text-ink-muted">
              Notes for the agent
            </label>
            <textarea
              id="proto-d-notes"
              value={selected.notes}
              rows={4}
              disabled={selected.scope === "bundled"}
              onChange={(event) => updateAsset(selected.id, { notes: event.target.value })}
              className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:opacity-60"
            />
            <div className="flex flex-wrap gap-2">
              {selected.kind === "music" ? (
                <Button size="sm" variant={selected.id === music ? "tertiary" : "primary"} disabled={selected.id === music} onClick={() => set({ music: selected.id })}>
                  {selected.id === music ? "The music bed" : "Use as music"}
                </Button>
              ) : null}
              {selected.scope === "project" ? (
                <Button size="sm" onClick={() => updateAsset(selected.id, { scope: "library" })}>
                  Add to Library
                </Button>
              ) : null}
            </div>
            <p className="mt-auto text-app-xs text-ink-muted">↑/↓ to audition as you go, Space to replay.</p>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

/* ───────────────────────── E: Docked browser, the Library as a tab of the bottom dock ───────────────────────── */

export function useDockTab() {
  const variant = useVariant();
  const [tab, setTab] = useState<"timeline" | "library">("timeline");
  return { tab: variant === "E" ? tab : "timeline", setTab, isDocked: variant === "E" };
}

export function DockTabs({ tab, onTab }: { tab: "timeline" | "library"; onTab: (tab: "timeline" | "library") => void }) {
  return (
    <div className="w-[190px]">
      <Segmented
        label="Dock"
        value={tab}
        options={[
          { value: "timeline", label: "Timeline" },
          { value: "library", label: "Library" },
        ]}
        onChange={onTab}
      />
    </div>
  );
}

export function DockedLibrary() {
  const { music, set, updateAsset } = useAssetsProto();
  const [kind, setKind] = useState<Kind | "all">("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [autoplay, setAutoplay] = useState(true);
  const [importing, setImporting] = useState(false);
  const rows = useFiltered(kind, scope, query);
  const selected = rows.find(({ id }) => id === selectedId);
  const onKeyDown = useListKeys(rows, selected, setSelectedId, autoplay);

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 pb-3">
      <div className="flex w-[200px] shrink-0 flex-col gap-2 overflow-y-auto">
        <SearchField value={query} onChange={setQuery} />
        <KindNav kind={kind} onKind={setKind} scope={scope} onScope={setScope} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-3 text-app-xs text-ink-muted">
          <span className="tabular-nums">{rows.length} Assets</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={autoplay} onChange={(event) => setAutoplay(event.target.checked)} className="accent-[var(--brand)]" />
            Audition as I move (↑/↓)
          </label>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setImporting(!importing)}>
            <UploadIcon />
            Import
          </Button>
        </div>
        {importing ? <ImportForm scope="project" onDone={() => setImporting(false)} /> : null}
        <div role="grid" aria-label="Assets" tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto rounded-md outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]">
          {rows.map((asset) => {
            const isSound = asset.kind === "sfx" || asset.kind === "music";
            return (
              <div
                key={asset.id}
                role="row"
                aria-selected={selected?.id === asset.id}
                onClick={() => setSelectedId(asset.id)}
                className={cn(
                  "grid h-9 grid-cols-[32px_minmax(140px,1.2fr)_96px_minmax(160px,2fr)_minmax(120px,1.4fr)_96px_auto] items-center gap-3 border-b border-hairline-soft px-1 text-app-sm",
                  selected?.id === asset.id ? "bg-surface-2" : "hover:bg-surface-1",
                )}
              >
                {isSound ? <PreviewButton asset={asset} /> : <KindMark asset={asset} size={24} />}
                <span className="truncate">{asset.name}</span>
                <span className="truncate text-app-xs text-ink-muted">{KINDS[asset.kind].label}</span>
                <input
                  value={asset.notes}
                  disabled={asset.scope === "bundled"}
                  aria-label={`Notes for ${asset.name}`}
                  placeholder="When to use it"
                  onChange={(event) => updateAsset(asset.id, { notes: event.target.value })}
                  className="h-7 min-w-0 rounded-sm bg-transparent px-1.5 text-app-xs text-ink-muted outline-none hover:bg-surface-2 focus:bg-surface-2 focus:text-ink disabled:hover:bg-transparent"
                />
                {isSound ? <AuditionWave asset={asset} bars={60} /> : <span className="truncate text-app-xs text-ink-muted tabular-nums">{asset.facts}</span>}
                <span className="truncate text-app-xs text-ink-muted">{SCOPES[asset.scope]}</span>
                <span className="flex justify-end">
                  {asset.kind === "music" ? (
                    <Button size="sm" variant="ghost" disabled={asset.id === music} onClick={() => set({ music: asset.id })}>
                      {asset.id === music ? "In use" : "Use"}
                    </Button>
                  ) : asset.scope === "project" ? (
                    <Button size="sm" variant="ghost" onClick={() => updateAsset(asset.id, { scope: "library" })}>
                      Add to Library
                    </Button>
                  ) : null}
                </span>
              </div>
            );
          })}
          {rows.length === 0 ? <p className="py-8 text-center text-app-xs text-ink-muted">Nothing matches. Try fewer words, or Import a file.</p> : null}
        </div>
      </div>
    </div>
  );
}
