import { ORPCError } from "@orpc/client";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { FolderOpenIcon, ImageIcon, LibraryIcon, MusicIcon, PlayIcon, SearchIcon, SparklesIcon, SquareIcon, UploadIcon, Volume2Icon, XIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { create } from "zustand";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { cn } from "@renderer/lib/utils";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import { Select } from "@renderer/style/controls";
import type { AssetKind, AssetScope } from "../../../contract";
import { assetFacts, filterAssets, isSound, KIND_ORDER, kindCounts, listKey, type KindFilter, type LibraryAsset, type ScopeFilter } from "./library";
import { useOpenVideo } from "./open-video";
import { useVideoSound } from "./sound";
import { Splitter } from "./splitter";

const KINDS: Record<AssetKind, { label: string; plural: string; icon: LucideIcon }> = {
  sfx: { label: "Sound effect", plural: "Sound effects", icon: Volume2Icon },
  music: { label: "Music", plural: "Music", icon: MusicIcon },
  image: { label: "Image", plural: "Images", icon: ImageIcon },
  logo: { label: "Logo", plural: "Logos", icon: SparklesIcon },
};

const SCOPES: Record<AssetScope, string> = { project: "This Project", library: "Your Library", bundled: "Bundled" };

/** The drawer needs about this much to keep its three columns; double-clicking its edge goes back to it. */
const DRAWER_WIDTH = 720;
const DRAWER_MIN = 560;
const DRAWER_MAX_SHARE = 0.7;

const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "ogg", "opus", "flac"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];

type Drawer = { isOpen: boolean; width: number; set: (patch: Partial<Pick<Drawer, "isOpen" | "width">>) => void };

const useDrawer = create<Drawer>((set) => ({ isOpen: false, width: DRAWER_WIDTH, set }));

/** The open Project's Asset inputs, or none for a video that isn't a stored Project, such as the fixture. */
function useProjectScope() {
  const projectId = useOpenVideo((state) => state.projectId);
  const isStored = useOpenVideo((state) => state.isStored);

  return isStored ? projectId : undefined;
}

function urlInput({ scope, id }: LibraryAsset): Parameters<typeof core.assets.url>[0] {
  return scope === "project" ? { scope, projectId: useOpenVideo.getState().projectId, id } : { scope, id };
}

/* ───────────────────────── audition: one <audio> for the whole drawer ───────────────────────── */

type Audition = {
  id?: string;
  /** When the sound started playing, so the waveform starts filling with it. */
  started?: number;
  play: (asset: LibraryAsset) => Promise<void>;
  toggle: (asset: LibraryAsset) => void;
  stop: () => void;
};

let audio: HTMLAudioElement | undefined;

const useAudition = create<Audition>((set, get) => ({
  stop: () => {
    audio?.pause();
    set({ id: undefined, started: undefined });
  },
  toggle: (asset) => (get().id === asset.id ? get().stop() : void get().play(asset)),
  play: async (asset) => {
    audio ??= new Audio();
    const player = audio;
    player.pause();
    set({ id: asset.id, started: undefined });
    const url = await core.assets.url(urlInput(asset)).catch(() => undefined);

    // Another sound was asked for meanwhile.
    if (get().id !== asset.id) {
      return;
    }

    if (!url) {
      set({ id: undefined });
      return;
    }

    player.src = url;
    player.onplaying = () => set({ started: performance.now() });
    player.onended = () => get().id === asset.id && set({ id: undefined, started: undefined });
    await player.play().catch(() => get().id === asset.id && set({ id: undefined }));
  },
}));

/* ───────────────────────── data ───────────────────────── */

/** Every Asset the drawer can show: the open Project's, the Library's and the bundled set. */
export function useAssets() {
  const projectId = useProjectScope();
  const results = useQueries({
    queries: [
      { ...orpc.assets.list.queryOptions({ input: { scope: "project", projectId: projectId ?? "" } }), enabled: projectId !== undefined },
      orpc.assets.list.queryOptions({ input: { scope: "library" } }),
      orpc.assets.list.queryOptions({ input: { scope: "bundled" } }),
    ],
  });
  const scopes = ["project", "library", "bundled"] as const;
  const assets: LibraryAsset[] = results.flatMap(({ data }, index) => (data ?? []).map((asset) => ({ ...asset, scope: scopes[index]! })));

  return { assets, error: results.find(({ error }) => error)?.error };
}

function refreshAssets() {
  return queryClient.invalidateQueries({ queryKey: orpc.assets.list.key() });
}

/** One sentence the creator can act on, per error code the Asset calls answer with. */
function assetErrorMessage(error: unknown) {
  if (!(error instanceof ORPCError) || !error.defined) {
    return projectErrorMessage(error);
  }

  const data = (error.data ?? {}) as { path?: string; kind?: AssetKind; detail?: string; maxBytes?: number; maxSeconds?: number };
  const file = data.path?.split(/[\\/]/).at(-1) ?? "This file";

  switch (error.code) {
    case "UNSUPPORTED_FORMAT":
      return `${file} can't be used as ${data.kind ? KINDS[data.kind].label.toLowerCase() : "an Asset"}. ${data.detail ?? ""}`;
    case "ASSET_TOO_LARGE":
      return `${file} is over ${Math.round((data.maxBytes ?? 0) / 1024 / 1024)} MB. Export a smaller image and try again.`;
    case "ASSET_TOO_LONG":
      return `${file} is over ${Math.round((data.maxSeconds ?? 0) / 60)} minutes. Trim it and try again.`;
    case "NOTES_REQUIRED":
      return "Images and logos need notes saying what they show, so the agent never guesses.";
    case "UNKNOWN_ASSET":
      return "That Asset isn't there any more.";
    default:
      return projectErrorMessage(error);
  }
}

/* ───────────────────────── the drawer ───────────────────────── */

/**
 * The Library, in a resizable drawer left of the player (not modal, so the video keeps playing): kind and source
 * filters, search, the list with auditions, and the selected Asset's detail. Closed, it is a Library icon strip.
 */
export function LibraryDrawer() {
  const { isOpen, width, set } = useDrawer();
  const stop = useAudition((state) => state.stop);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Closing the drawer or leaving the editor ends the audition.
  useEffect(() => (isOpen ? stop : undefined), [isOpen, stop]);

  if (!isOpen) {
    return (
      <aside aria-label="Library" className="flex shrink-0 flex-col items-center border-r border-hairline-soft px-1.5 pt-4">
        <Button variant="ghost" size="icon-sm" aria-label="Open the Library" title="Library" onClick={() => set({ isOpen: true })}>
          <LibraryIcon />
        </Button>
      </aside>
    );
  }

  const maxWidth = Math.max(DRAWER_MIN, Math.round(windowWidth * DRAWER_MAX_SHARE));
  const shown = Math.min(width, maxWidth);

  return (
    <>
      <Library width={shown} onClose={() => set({ isOpen: false })} />
      <Splitter axis="x" label="Resize the Library" value={shown} min={DRAWER_MIN} max={maxWidth} onChange={(next) => set({ width: next })} onReset={() => set({ width: DRAWER_WIDTH })} />
    </>
  );
}

function Library({ width, onClose }: { width: number; onClose: () => void }) {
  const projectId = useProjectScope();
  const { assets, error } = useAssets();
  const [kind, setKind] = useState<KindFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [importing, setImporting] = useState<string>();
  const searched = filterAssets(assets, { kind: "all", scope, query });
  const rows = filterAssets(searched, { kind, scope: "all", query: "" });
  const selected = rows.find(({ id }) => id === selectedId) ?? rows[0];
  const play = useAudition((state) => state.play);

  function onListKey(event: KeyboardEvent) {
    const action = listKey(event.key, rows, selected?.id);

    if (!action) {
      return;
    }

    // Space here auditions; keep it from also playing the video.
    event.preventDefault();
    event.stopPropagation();

    if (action.select) {
      setSelectedId(action.select);
    }

    if (action.play) {
      void play(action.play);
    }
  }

  async function chooseImport() {
    const path = await window.motionbrief.chooseFile({
      title: "Import an Asset",
      filters: [
        { name: "Sounds and images", extensions: [...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (path) {
      setImporting(path);
    }
  }

  return (
    <aside
      aria-label="Library"
      className="flex min-w-0 shrink-0 flex-col gap-3 p-3"
      style={{ width }}
      onKeyDown={(event) => {
        // Not while typing, and not from the import dialog, which portals out of the drawer.
        if (event.key === "Escape" && event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest("input, textarea, select")) {
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-app-body font-medium">Library</h2>
        <SearchField value={query} onChange={setQuery} className="ml-2 max-w-[320px] flex-1" />
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Open Library folder" title="Open Library folder" onClick={() => void openLibraryFolder()}>
          <FolderOpenIcon />
        </Button>
        <Button size="sm" onClick={() => void chooseImport()}>
          <UploadIcon />
          Import
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close the Library" title="Close (Esc)" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {importing ? <ImportDialog path={importing} projectId={projectId} onDone={() => setImporting(undefined)} /> : null}
      {error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {assetErrorMessage(error)}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3">
        <KindNav counts={kindCounts(searched)} kind={kind} onKind={setKind} scope={scope} onScope={setScope} hasProject={projectId !== undefined} />
        <ul
          aria-label="Assets"
          tabIndex={0}
          onKeyDown={onListKey}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-md outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
        >
          {rows.map((asset) => (
            <li
              key={`${asset.scope}:${asset.id}`}
              aria-selected={selected?.id === asset.id}
              onClick={() => setSelectedId(asset.id)}
              className={cn("flex cursor-default items-center gap-2.5 rounded-[10px] p-1.5 hover:bg-surface-1", selected?.id === asset.id && "bg-surface-2 hover:bg-surface-2")}
            >
              {isSound(asset) ? <PlayButton asset={asset} /> : <KindMark kind={asset.kind} />}
              <span className="flex w-[34%] min-w-0 flex-col">
                <span className="truncate text-app-sm">{asset.name}</span>
                <span className="truncate text-app-xs text-ink-muted">{asset.notes || "No notes"}</span>
              </span>
              {isSound(asset) ? <AuditionWave asset={asset} /> : <span className="flex-1" />}
              <span className="w-[92px] shrink-0 truncate text-right text-app-xs text-ink-muted tabular-nums">{assetFacts(asset).split(" · ")[0]}</span>
            </li>
          ))}
          {rows.length === 0 ? <li className="py-8 text-center text-app-xs text-ink-muted">Nothing matches. Try fewer words, or Import a file.</li> : null}
        </ul>
        {selected ? <Detail key={`${selected.scope}:${selected.id}`} asset={selected} /> : null}
      </div>
    </aside>
  );
}

async function openLibraryFolder() {
  window.motionbrief.showInFolder(await core.assets.libraryFolder());
}

function KindMark({ kind }: { kind: AssetKind }) {
  const Icon = KINDS[kind].icon;

  return (
    <span aria-hidden="true" className="grid size-[30px] shrink-0 place-items-center rounded-sm bg-surface-3 text-ink-muted">
      <Icon className="size-[45%]" />
    </span>
  );
}

function PlayButton({ asset }: { asset: LibraryAsset }) {
  const isPlaying = useAudition((state) => state.id === asset.id);
  const toggle = useAudition((state) => state.toggle);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${isPlaying ? "Stop" : "Play"} ${asset.name}`}
      aria-pressed={isPlaying}
      className={cn(isPlaying && "text-primary")}
      onClick={(event) => {
        event.stopPropagation();
        toggle(asset);
      }}
    >
      {isPlaying ? <SquareIcon /> : <PlayIcon />}
    </Button>
  );
}

/** A waveform that fills while the sound auditions; its bars are decoration, the same for an Asset every time. */
function AuditionWave({ asset, bars = 40 }: { asset: LibraryAsset; bars?: number }) {
  const started = useAudition((state) => (state.id === asset.id ? state.started : undefined));
  const seed = [...asset.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return (
    <span aria-hidden="true" className="relative flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} className="w-[2px] shrink-0 rounded-full bg-[#3a3a3a]" style={{ height: 4 + ((index * 7 + seed * 3) % 17) }} />
      ))}
      {started ? (
        <span
          key={started}
          className="absolute inset-y-0 left-0 bg-primary/25 mix-blend-screen"
          style={{ animation: `library-wave-fill ${isSound(asset) ? asset.duration : 0}s linear forwards` }}
        />
      ) : null}
      <style>{"@keyframes library-wave-fill { from { width: 0 } to { width: 100% } }"}</style>
    </span>
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

function KindNav({
  counts,
  kind,
  onKind,
  scope,
  onScope,
  hasProject,
}: {
  counts: Record<KindFilter, number>;
  kind: KindFilter;
  onKind: (kind: KindFilter) => void;
  scope: ScopeFilter;
  onScope: (scope: ScopeFilter) => void;
  hasProject: boolean;
}) {
  const item = (isOn: boolean) => cn("flex h-7 items-center gap-2 rounded-md px-2 text-left text-app-sm text-ink-muted transition-colors hover:text-ink", isOn && "bg-surface-2 text-ink");
  const scopes: ScopeFilter[] = hasProject ? ["all", "project", "library", "bundled"] : ["all", "library", "bundled"];

  return (
    <nav aria-label="Filter Assets" className="flex w-[148px] shrink-0 flex-col gap-0.5">
      <button type="button" aria-pressed={kind === "all"} className={item(kind === "all")} onClick={() => onKind("all")}>
        <LibraryIcon className="size-3.5" aria-hidden="true" />
        Everything
        <span className="ml-auto text-app-xs tabular-nums">{counts.all}</span>
      </button>
      {KIND_ORDER.map((value) => {
        const Icon = KINDS[value].icon;

        return (
          <button key={value} type="button" aria-pressed={kind === value} className={item(kind === value)} onClick={() => onKind(value)}>
            <Icon className="size-3.5" aria-hidden="true" />
            {KINDS[value].plural}
            <span className="ml-auto text-app-xs tabular-nums">{counts[value]}</span>
          </button>
        );
      })}
      <span className="mt-3 mb-1 px-2 text-app-xs text-ink-muted">From</span>
      {scopes.map((value) => (
        <button key={value} type="button" aria-pressed={scope === value} className={item(scope === value)} onClick={() => onScope(value)}>
          {value === "all" ? "Anywhere" : SCOPES[value]}
        </button>
      ))}
    </nav>
  );
}

/** The selected Asset: its preview, facts, source and notes (read-only for bundled ones), and what can be done with it. */
function Detail({ asset }: { asset: LibraryAsset }) {
  const [notes, setNotes] = useState(asset.notes);
  const [isRemoving, setIsRemoving] = useState(false);
  const isBundled = asset.scope === "bundled";
  const image = useQuery({ ...orpc.assets.url.queryOptions({ input: urlInput(asset) }), staleTime: Infinity, enabled: !isSound(asset) });
  const projectId = useOpenVideo((state) => state.projectId);
  // Bundled Assets are read-only: nothing below runs for them.
  const where = asset.scope === "project" ? ({ scope: "project", projectId } as const) : ({ scope: "library" } as const);
  const save = useMutation({ mutationFn: () => core.assets.update({ ...where, id: asset.id, notes }), onSuccess: refreshAssets });
  const remove = useMutation({ mutationFn: () => core.assets.remove({ ...where, id: asset.id }), onSuccess: refreshAssets });
  const addToLibrary = useMutation({ mutationFn: () => core.assets.addToLibrary({ projectId, id: asset.id }), onSuccess: refreshAssets });
  const music = useVideoSound();
  const error = save.error ?? remove.error ?? addToLibrary.error;
  const isMusic = music.sound?.music === asset.id;

  return (
    <section aria-label="Selected Asset" className="flex w-[220px] shrink-0 flex-col gap-2 overflow-y-auto">
      <span className="grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-md bg-surface-1">
        {isSound(asset) ? <PlayButton asset={asset} /> : image.data ? <img src={image.data} alt={asset.name} className="size-full object-contain" /> : <KindMark kind={asset.kind} />}
      </span>
      <p className="text-app-sm font-medium">{asset.name}</p>
      <p className="text-app-xs text-ink-muted tabular-nums">
        {KINDS[asset.kind].label} · {assetFacts(asset)}
        <br />
        {SCOPES[asset.scope]}
      </p>
      <label htmlFor="library-notes" className="mt-1 text-app-xs text-ink-muted">
        Notes for the agent
      </label>
      <textarea
        id="library-notes"
        value={notes}
        rows={4}
        readOnly={isBundled}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => notes.trim() !== asset.notes && save.mutate()}
        className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)] read-only:opacity-60"
      />
      {isBundled ? null : <p className="text-app-xs text-ink-muted">Notes steer later generations; videos already made keep their Assets.</p>}
      {error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {assetErrorMessage(error)}
        </p>
      ) : null}
      {music.error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {music.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {asset.kind === "music" && music.sound ? (
          <Button size="sm" disabled={music.isBusy || isMusic} onClick={() => music.set({ music: asset.id })}>
            {isMusic ? "This video's music" : "Use as music"}
          </Button>
        ) : null}
        {asset.scope === "project" ? (
          <Button size="sm" disabled={addToLibrary.isPending || addToLibrary.isSuccess} onClick={() => addToLibrary.mutate()}>
            {addToLibrary.isSuccess ? "In your Library" : "Add to Library"}
          </Button>
        ) : null}
        {isBundled ? null : (
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => (isRemoving ? remove.mutate() : setIsRemoving(true))} onBlur={() => setIsRemoving(false)}>
            {isRemoving ? "Click again to remove" : "Remove"}
          </Button>
        )}
      </div>
      <p className="mt-auto text-app-xs text-ink-muted">↑/↓ to audition as you go, Space to replay.</p>
    </section>
  );
}

/** Import: name, kind and notes (required for images and logos); the file is copied and the original never used again. */
function ImportDialog({ path, projectId, onDone }: { path: string; projectId: string | undefined; onDone: () => void }) {
  const fileName = path.split(/[\\/]/).at(-1) ?? path;
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, ""));
  const [kind, setKind] = useState<AssetKind>(IMAGE_EXTENSIONS.includes(extension) ? "image" : "sfx");
  const [notes, setNotes] = useState("");
  const needsNotes = kind === "image" || kind === "logo";
  const destination = projectId ? "This Project" : "Your Library";
  const importAsset = useMutation({
    mutationFn: () => core.assets.import({ ...(projectId ? { scope: "project", projectId } : { scope: "library" }), path, name, kind, notes }),
    onSuccess: async () => {
      await refreshAssets();
      onDone();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import an Asset</DialogTitle>
          <DialogDescription>Name it, pick its kind and tell the agent when to use it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            importAsset.mutate();
          }}
        >
          <p className="text-app-xs text-ink-muted">
            {fileName} is copied into {destination}. The original file is never used again, so you can move or delete it.
          </p>
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" className="h-control-sm rounded-md bg-surface-2 px-2.5 text-app-sm outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]" />
          <Select id="import-kind" value={kind} options={KIND_ORDER.map((value) => ({ value, label: KINDS[value].label }))} onChange={setKind} />
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            aria-label="Notes for the agent"
            placeholder={needsNotes ? "What it shows and when to use it (required)" : "When to use it (optional)"}
            className="resize-none rounded-md bg-surface-2 px-2.5 py-1.5 text-app-sm outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
          />
          {importAsset.error ? (
            <p role="alert" className="text-app-xs text-status-fallback-ink">
              {assetErrorMessage(importAsset.error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" type="button" onClick={onDone}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={importAsset.isPending || !name.trim() || (needsNotes && !notes.trim())}>
              {importAsset.isPending ? "Importing…" : "Import"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
