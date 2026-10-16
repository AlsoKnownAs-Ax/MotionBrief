import type { Asset, AssetKind, AssetScope, SoundAsset, TimelineScene } from "../../../contract";

/** An Asset as the Library drawer lists it: with where it lives. */
export type LibraryAsset = Asset & { scope: AssetScope };

export type KindFilter = AssetKind | "all";

export type ScopeFilter = AssetScope | "all";

export type LibraryFilter = { kind: KindFilter; scope: ScopeFilter; query: string };

export const KIND_ORDER: AssetKind[] = ["sfx", "music", "image", "logo"];

export function isSound(asset: Asset): asset is SoundAsset {
  return asset.kind === "sfx" || asset.kind === "music";
}

/** The Assets of the kind and source picked whose name or notes hold every word searched for. */
export function filterAssets<T extends LibraryAsset>(assets: T[], { kind, scope, query }: LibraryFilter): T[] {
  return assets
    .filter((asset) => kind === "all" || asset.kind === kind)
    .filter((asset) => scope === "all" || asset.scope === scope)
    .filter((asset) => matches(asset, query));
}

export function matches(asset: Asset, query: string) {
  const text = `${asset.name} ${asset.notes}`.toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** A place in a Scene where an image or logo can be swapped in. */
export type SwapTarget = { scene: TimelineScene; field: string };

/** Where the selected Scenes show another image or logo that `asset` can take the place of; an icon slot takes only a logo. */
export function swapTargets(asset: Asset, scenes: TimelineScene[], selection: string[]): SwapTarget[] {
  if (isSound(asset)) {
    return [];
  }

  return scenes
    .filter(({ id }) => selection.includes(id))
    .flatMap((scene) =>
      (scene.assets ?? [])
        .filter(({ id }) => id !== asset.id)
        .filter(({ field }) => asset.kind === "logo" || !field.endsWith(".icon"))
        .map(({ field }) => ({ scene, field })),
    );
}

/** How many of the Assets are of each kind, and in all. */
export function kindCounts(assets: Asset[]): Record<KindFilter, number> {
  const counts = { all: assets.length, sfx: 0, music: 0, image: 0, logo: 0 };
  assets.forEach(({ kind }) => (counts[kind] += 1));

  return counts;
}

/**
 * What a key does in the list: ↑/↓ move the selection and audition each sound landed on, Space replays the selected
 * one. Undefined for a key the list leaves alone.
 */
export function listKey<T extends Asset>(key: string, rows: T[], selectedId: string | undefined): { select?: string; play?: T } | undefined {
  const index = rows.findIndex(({ id }) => id === selectedId);
  const step = { ArrowDown: 1, ArrowUp: -1 }[key];

  if (step) {
    // With nothing selected (-1), ↓ lands on the first row and ↑ stays there.
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];

    return next && { select: next.id, ...(isSound(next) && { play: next }) };
  }

  const selected = rows[index];

  if (key === " " && selected && isSound(selected)) {
    return { play: selected };
  }

  if (key === " " && selected) {
    return {};
  }

  return undefined;
}

/** A line of what was measured: a sound's length and loudness, an image's size, format and transparency. */
export function assetFacts(asset: Asset) {
  if (isSound(asset)) {
    return `${length(asset.duration)} · −${Math.round(Math.abs(asset.loudness))} LUFS`;
  }

  const facts = [`${asset.width}×${asset.height}`, asset.format.toUpperCase()];

  if (asset.transparent) {
    return [...facts, "transparent"].join(" · ");
  }

  return facts.join(" · ");
}

/** Under a minute in tenths of a second, else m:ss. */
function length(seconds: number) {
  if (seconds < 60) {
    return `${Math.round(seconds * 10) / 10} s`;
  }

  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
