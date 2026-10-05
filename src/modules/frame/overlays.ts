import type { Treatments } from "../../contract";
import { SKETCH_FILTER } from "./css";

/** What the frame adds to the root composition for a Preset's treatments. */
export type RootTreatments = {
  /** CSS for the root page's head. */
  css: string;
  /** Markup before the root composition: the sketchy displacement filter, defined once for every unit. */
  defs: string;
  /** Markup at the end of the root composition: the texture overlay, above every Scene. */
  overlay: string;
};

/** A fractal-noise tile, gray at `level`, with alpha `alpha`. */
function noise(level: number, alpha: number, frequency: number): string {
  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${level}  0 0 0 0 ${level}  0 0 0 0 ${level}  0 0 0 ${alpha} 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
}

/**
 * Texture overlays sit above every Scene in the root. Their strength lives in the element's opacity,
 * kept below 0.6: HyperFrames' check treats a more opaque overlay as hiding the text under it.
 */
const TEXTURES = {
  none: "",
  paper: `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; mix-blend-mode: multiply; opacity: .55;
  background-image: ${noise(0.35, 0.55, 0.8)}, radial-gradient(130% 100% at 50% 40%, transparent 55%, rgba(90, 60, 20, .18) 100%); }`,
  "film-grain": `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; mix-blend-mode: overlay; opacity: .35; background-image: ${noise(0.5, 0.9, 1.1)}; }`,
  scanlines: `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; opacity: .5;
  background-image: repeating-linear-gradient(0deg, rgba(0, 0, 0, .64) 0px, rgba(0, 0, 0, .64) 2px, transparent 2px, transparent 4px), radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0, 0, 0, 1) 100%); }`,
} satisfies Record<Treatments["texture"], string>;

const SKETCH_DEFS = `<svg width="0" height="0" style="position: absolute" aria-hidden="true"><defs>
<filter id="${SKETCH_FILTER}" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs></svg>`;

const LINE_DEFS = { sketchy: SKETCH_DEFS, clean: "" } satisfies Record<Treatments["line"], string>;

const TEXTURE_OVERLAY = '<div id="mb-texture" class="mb-texture" data-layout-ignore></div>';

export function rootTreatments({ texture, line }: Treatments): RootTreatments {
  return { css: TEXTURES[texture], defs: LINE_DEFS[line], overlay: textureOverlay(texture) };
}

function textureOverlay(texture: Treatments["texture"]) {
  if (texture === "none") {
    return "";
  }

  return TEXTURE_OVERLAY;
}
