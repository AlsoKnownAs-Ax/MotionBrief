import type { IndexedAsset } from "../../contract";

/** `<img src="asset(<id>)" ..>`, the only way Scene code shows an Asset. */
const ASSET_IMAGE = /<img\b([^>]*?)\ssrc=["']asset\(\s*["']?([^"')\s]+)["']?\s*\)["']([^>]*)>/g;

/** Where the page holds an Asset's file: ids are file-safe once a bundled one's colon is a dash. */
export function assetPath({ id, format }: Pick<IndexedAsset, "id" | "format">): string {
  return `assets/media/${id.replace(":", "-")}.${format}`;
}

export type PlacedAssets = {
  html: string;
  /** Ids that aren't in the Asset index; their images are dropped. */
  unknownAssets: string[];
};

/**
 * Points every `asset(id)` image at the page's copy of the Asset and gives it the frame's treatment: an image in the
 * Preset's surface and radius, a transparent logo bare, an opaque one on a surface chip. An image carries its aspect,
 * so the frame can fit it to its slot.
 */
export function placeAssets(html: string, assets: IndexedAsset[] = []): PlacedAssets {
  const index = new Map(assets.map((asset) => [asset.id, asset]));
  const unknownAssets = new Set<string>();

  const placed = html.replace(ASSET_IMAGE, (_image, before: string, id: string, after: string) => {
    const asset = index.get(id);

    if (!asset || (asset.kind !== "image" && asset.kind !== "logo")) {
      unknownAssets.add(id);

      return "";
    }

    const attributes = `${before} ${after}`.replace(/\/\s*$/, "");
    const classes = /\bclass=["']([^"']*)["']/.exec(attributes)?.[1] ?? "";
    const others = attributes.replace(/\bclass=["'][^"']*["']/, "").replace(/\s+/g, " ").trim();
    const treatment = asset.kind === "image" ? "mb-media mb-image" : `mb-media mb-logo${asset.transparent ? "" : " mb-logo-chip"}`;
    const aspect = asset.kind === "image" ? `data-mb-aspect="${asset.width / asset.height}"` : "";

    return `${["<img", others, `src="${assetPath(asset)}"`, `class="${`${treatment} ${classes}`.trim()}"`, aspect].filter(Boolean).join(" ")}>`;
  });

  return { html: placed, unknownAssets: [...unknownAssets] };
}
