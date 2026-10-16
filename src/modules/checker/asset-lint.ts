import { readFile } from "node:fs/promises";
import type { CheckFinding, IndexedAsset } from "../../contract";
import type { UnitCode } from "../frame";

const IMAGE_TAG = /<img\b[^>]*>/gi;
const ASSET_SOURCE = /\ssrc=["']asset\(\s*["']?([^"')\s]+)["']?\s*\)["']/;
/** `asset(id)` wherever Scene code names an Asset: an image's src or a call in its JS. */
const ASSET_CALL = /\basset\(\s*["']?([^"')\s]+)["']?\s*\)/g;
/** A CSS url(), unless it points into the page, such as the frame's `url(#mb-sketch)` filter. */
const CSS_URL = /\burl\(\s*(?!["']?#)/gi;
const DATA_IMAGE = /data:image\//i;
const SVG_PATH_DATA = /\sd=["']([^"']{24,})["']/g;

const SHOW = 'Show an image or logo only as <img src="asset(<id>)">, with an id the unit\'s Storyboard entries name.';

/**
 * Scene code reaches Assets only as `<img src="asset(id)">` (ADR 0004): no paths, no other images or CSS url(), and
 * no Asset copied into the code, so an SVG's scripts never run and a swap is a re-render. `assets` are the ones the
 * Storyboard shows.
 */
export async function assetLint(unit: string, code: UnitCode, assets: IndexedAsset[]): Promise<CheckFinding[]> {
  const known = new Set(assets.map(({ id }) => id));
  const all = `${code.css}\n${code.html}\n${code.js}`;
  const finding = (kind: string, message: string): CheckFinding => ({ unit, source: "assets", code: kind, message });
  const unknown = [...new Set([...all.matchAll(ASSET_CALL)].map(([, id]) => id ?? ""))].filter((id) => !known.has(id));
  const foreignImages = [...code.html.matchAll(IMAGE_TAG)].filter(([tag]) => !ASSET_SOURCE.test(tag));
  const urls = [...`${code.css}\n${code.html}`.matchAll(CSS_URL)];
  const inlined = await inlinedAssets(all, assets);

  return [
    ...unknown.map((id) => finding("UNKNOWN_ASSET", `There is no Asset "${id}" in this unit. ${SHOW}`)),
    ...foreignImages.map(([tag]) => finding("FOREIGN_IMAGE", `${tag} isn't an Asset. ${SHOW}`)),
    ...urls.map(() => finding("FOREIGN_IMAGE", `CSS url() can't show images. ${SHOW}`)),
    ...(DATA_IMAGE.test(all) ? [finding("INLINED_ASSET", `The code inlines an image as a data: URL. ${SHOW}`)] : []),
    ...inlined.map(({ name }) => finding("INLINED_ASSET", `The code copies the markup of "${name}". ${SHOW}`)),
  ];
}

/** The SVG Assets whose path data the code repeats. */
async function inlinedAssets(all: string, assets: IndexedAsset[]): Promise<IndexedAsset[]> {
  const svgs = assets.filter(({ format }) => format === "svg");
  const markup = await Promise.all(svgs.map((asset) => readFile(asset.file, "utf8").catch(() => "")));

  return svgs.filter((_asset, index) => [...(markup[index] ?? "").matchAll(SVG_PATH_DATA)].some(([, path]) => path && all.includes(path)));
}
