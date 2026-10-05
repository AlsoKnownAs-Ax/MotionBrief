import { createRequire } from "node:module";
import type { Format, UnitCode } from "../../contract";
import { SCENE_LEAD_SECONDS } from "../storyboard";
import { frameCss } from "./css";
import { bundledFonts } from "./fonts";
import { FRAME_SIZES } from "./formats";
import { motionDefaults } from "./motion";
import { rootTreatments } from "./overlays";
import MB_RUNTIME from "./runtime/mb.js?raw";
import type { FrameStyle } from "./style";
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
  /** Scene id → when the Scene starts. More than one Scene: the unit is a Canvas the camera moves across. */
  sceneStarts: Record<string, number>;
  /**
   * A carry-over into the unit: the element with DOM id `element` in unit `from` flies over `duration`
   * seconds from the unit's start to the place of `target`, its counterpart in this unit.
   */
  carryIn?: { from: string; element: string; target: string; duration: number };
};

/** A file the page needs: copied `from` a bundled package, or written with `content`. */
export type PageAsset = { path: string; from?: string; content?: string };

/**
 * What the root page loads before any unit: GSAP, the anchor table and the Preset's Motion, the
 * `MB.*` runtime and the Preset's fonts; and what the frame puts around the root composition for
 * the Preset's treatments (`defs` before it, `overlay` at its end).
 */
export async function framePage({ format, units, style }: { format: Format; units: UnitTiming[]; style: FrameStyle }) {
  const { width, height, safe } = FRAME_SIZES[format];
  const fonts = await bundledFonts(style.typography);
  const treatments = rootTreatments(style.treatments);
  const data = {
    contractVersion: FRAME_CONTRACT_VERSION,
    format,
    width,
    height,
    safe,
    motion: motionDefaults(style.motion),
    sceneLead: SCENE_LEAD_SECONDS,
    connector: { curve: style.treatments.connector.style === "curved", sketchy: style.treatments.line === "sketchy" },
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
${treatments.css}
</style>`,
    defs: treatments.defs,
    overlay: treatments.overlay,
  };
}

/** The timeline the unit plays: stepped through MB.quantize at a Motion frame rate, or as Scene code wrote it. */
function playedTimeline(fps: number, duration: number) {
  if (fps <= 0) {
    return "tl";
  }

  return `MB.quantize(tl, ${duration})`;
}

/**
 * A unit's composition: the frame's CSS and background around the agent's code, which runs in a
 * paused GSAP timeline as long as the unit, with `at` bound to the unit's anchors. Stepped Motion
 * plays the timeline through MB.quantize, so Scene code never handles the frame rate. The frame
 * then adds what Scene code never writes: the camera across a Canvas and a carried element's flight.
 */
export function wrapUnit({ unit, format, style, code }: { unit: UnitTiming; format: Format; style: FrameStyle; code: UnitCode }) {
  const { width, height } = FRAME_SIZES[format];
  const timeline = playedTimeline(motionDefaults(style.motion).fps, unit.duration);
  const owned = [
    { adds: Object.keys(unit.sceneStarts).length > 1, js: `  MB.camera(tl, "${unit.id}");` },
    { adds: unit.carryIn !== undefined, js: `  MB.carry(tl, "${unit.id}");` },
  ]
    .filter(({ adds }) => adds)
    .map(({ js }) => js);

  return `<template>
<style>
${frameCss(format, style)}
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
${owned.join("\n")}
  tl.to({}, { duration: ${unit.duration} }, 0);
  window.__timelines["${unit.id}"] = ${timeline};
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
