import { createRequire } from "node:module";
import type { Format, UnitCode } from "../../contract";
import { frameCss } from "./css";
import { bundledFonts } from "./fonts";
import { FRAME_SIZES } from "./formats";
import MB_RUNTIME from "./runtime/mb.js?raw";
import type { FrameTokens } from "./tokens";
import { FRAME_CONTRACT_VERSION } from "./version";

const require = createRequire(import.meta.url);

export type { UnitCode };

/**
 * When a unit (a lone Scene, or the Scenes sharing a Canvas) plays, as the Assembler works it out
 * from the Storyboard's word anchors. Times are in seconds from the unit's start.
 */
export type UnitTiming = {
  id: string;
  duration: number;
  /** DOM id `<sceneId>-<elementId>` → the time its word is spoken. */
  anchors: Record<string, number>;
  /** Scene id → when the Scene starts. */
  sceneStarts: Record<string, number>;
};

/** A file the page needs: copied `from` a bundled package, or written with `content`. */
export type PageAsset = { path: string; from?: string; content?: string };

/** Blueprint's Motion: balanced and smooth, so long-tail ease-outs and no overshoot. */
const MOTION = { ease: "power3.out", easeInOut: "power2.inOut", duration: 0.5, reveal: "rise" };

/** What the root page loads before any unit: GSAP, the anchor table, the `MB.*` runtime and the bundled fonts. */
export async function framePage({ format, units }: { format: Format; units: UnitTiming[] }) {
  const { width, height, safe } = FRAME_SIZES[format];
  const fonts = await bundledFonts();
  const data = {
    contractVersion: FRAME_CONTRACT_VERSION,
    format,
    width,
    height,
    safe,
    motion: MOTION,
    connector: { curve: false },
    units: Object.fromEntries(units.map(({ id, ...timing }) => [id, timing])),
  };
  const assets: PageAsset[] = [
    { path: "assets/gsap.min.js", from: require.resolve("gsap/dist/gsap.min.js") },
    // One script, so the anchor table is always there before the runtime reads it.
    { path: "assets/mb.js", content: `window.MB_DATA = ${JSON.stringify(data)};\n${MB_RUNTIME}` },
    ...fonts.files,
  ];

  return {
    assets,
    head: `<script src="assets/gsap.min.js"></script>
<script src="assets/mb.js"></script>
<style>
${fonts.css}
</style>`,
  };
}

/**
 * A unit's composition: the frame's CSS and background around the agent's code, which runs in a
 * paused GSAP timeline as long as the unit, with `at` bound to the unit's anchors.
 */
export function wrapUnit({ unit, format, tokens, code }: { unit: UnitTiming; format: Format; tokens: FrameTokens; code: UnitCode }) {
  const { width, height } = FRAME_SIZES[format];

  return `<template>
<style>
${frameCss(format, tokens)}
</style>
<style>
${code.css}
</style>
<div id="root" data-composition-id="${unit.id}" data-width="${width}" data-height="${height}" data-duration="${unit.duration}">
  <div id="${unit.id}-bg" class="clip mb-bg" data-start="0" data-duration="${unit.duration}" data-track-index="0"></div>
${withDeliberateLayering(code.html)}
</div>
<script>
(function () {
  const S = MB.scene("${unit.id}");
  const at = S.at;
  const tl = gsap.timeline({ paused: true });
${code.js}
  tl.to({}, { duration: ${unit.duration} }, 0);
  window.__timelines["${unit.id}"] = tl;
})();
</script>
</template>
`;
}

const ALLOW_OVERLAP = /\sdata-layout-allow-overlap(?:=(?:""|''))?(?=[\s/>])/g;

/**
 * `data-layout-allow-overlap` marks an element as part of a deliberate layering. HyperFrames
 * waives text overlap and text occlusion with separate attributes; the frame sets both.
 */
function withDeliberateLayering(html: string): string {
  return html.replace(ALLOW_OVERLAP, " data-layout-allow-overlap data-layout-allow-occlusion");
}
