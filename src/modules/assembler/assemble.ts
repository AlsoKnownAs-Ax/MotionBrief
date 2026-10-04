import { copyFile, link, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { Format, StoryboardTranscript, StylePreset } from "../../contract";
import { fallbackCode, FRAME_SIZES, framePage, inlineIcons, wrapUnit, type PageAsset, type UnitCode } from "../frame";
import type { Storyboard } from "../storyboard";
import { captionsLayer } from "./captions";
import { planUnits, TRANSITION_SECONDS, type Unit } from "./units";

export type AssembleOptions = {
  /** An empty folder the page is written into. */
  dir: string;
  storyboard: Storyboard;
  transcript: StoryboardTranscript;
  /** The video's Style Preset snapshot. */
  preset: StylePreset;
  /** Scene code per unit id. A unit without code is drawn as its fallback Scene. */
  code: Record<string, UnitCode>;
  /** The Voiceover file, the video's audio track. Absent, the video is silent. */
  voiceover?: string;
  /** Draws Captions from the Transcript over the Scenes, in the Preset's caption style. Off by default. */
  captions?: boolean;
};

export type AssembledPage = {
  format: Format;
  width: number;
  height: number;
  duration: number;
  units: Unit[];
};

/**
 * Builds the root composition from a Storyboard, its Transcript and the units' code: one
 * sub-composition per unit, in Storyboard order and timed from the word anchors, the Transitions
 * between them, the Captions and the Voiceover. The agent writes none of this.
 */
export async function assemble({ dir, storyboard, transcript, preset, code, voiceover, captions = false }: AssembleOptions): Promise<AssembledPage> {
  const format = storyboard.format;
  const { width, height } = FRAME_SIZES[format];
  const units = planUnits(storyboard, transcript);
  const duration = transcript.duration;
  const page = await framePage({ format, units, style: preset });
  const audio = voiceover ? `assets/voiceover${extname(voiceover).toLowerCase()}` : undefined;

  await mkdir(join(dir, "compositions"), { recursive: true });
  await Promise.all(page.assets.map((asset) => writeAsset(dir, asset)));
  await Promise.all(
    units.map(async (unit) => {
      const unitCode = code[unit.id] ?? fallbackCode(unit.scenes, unit, format);
      const { html } = await inlineIcons(unitCode.html, preset.treatments.icons);

      await writeFile(join(dir, "compositions", `${unit.id}.html`), wrapUnit({ unit, format, style: preset, code: { ...unitCode, html } }));
    }),
  );

  if (voiceover && audio) {
    await placeVoiceover(voiceover, join(dir, audio));
  }

  const layer = captionsWhenOn(captions, { transcript, format, preset });

  await writeFile(join(dir, "index.html"), rootHtml({ width, height, duration, units, audio, page, captions: layer, background: preset.palette.colors.bg }));

  return { format, width, height, duration, units };
}

function captionsWhenOn(captions: boolean, options: Parameters<typeof captionsLayer>[0]) {
  if (!captions) {
    return undefined;
  }

  return captionsLayer(options);
}

async function writeAsset(dir: string, { path, from, content }: PageAsset) {
  const target = join(dir, path);
  await mkdir(dirname(target), { recursive: true });

  if (from) {
    await copyFile(from, target);
    return;
  }

  await writeFile(target, content ?? "");
}

/** A Voiceover can run to hundreds of MB: a hard link costs nothing, a copy only where links can't reach. */
async function placeVoiceover(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });

  try {
    await link(from, to);
  } catch {
    await copyFile(from, to);
  }
}

type RootOptions = {
  width: number;
  height: number;
  duration: number;
  units: Unit[];
  audio?: string;
  /** What the frame puts in the head, before the root composition and at its end. */
  page: { head: string; defs: string; overlay: string };
  /** The Captions layer, when Captions are on. */
  captions?: { css: string; html: string; js: string };
  background: string;
};

function rootHtml({ width, height, duration, units, audio, page, captions, background }: RootOptions): string {
  const clips = units.map(
    (unit, index) =>
      `<div id="el-${unit.id}" class="scene" data-composition-id="${unit.id}" data-composition-src="compositions/${unit.id}.html" data-start="${unit.start}" data-duration="${unit.duration}" data-track-index="${1 + (index % 2)}"></div>`,
  );
  const voiceover = audio
    ? [`<audio id="el-voiceover" src="${audio}" data-start="0" data-duration="${duration}" data-track-index="10" data-volume="1"></audio>`]
    : [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${width}, height=${height}" />
${page.head}
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
#root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: ${background}; }
.scene { position: absolute; inset: 0; width: 100%; height: 100%; }
${captions?.css ?? ""}
</style>
</head>
<body>
${page.defs}
<div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
${[...clips, ...voiceover, captions?.html, page.overlay].filter(Boolean).join("\n")}
</div>
<script>
(function () {
  var tl = gsap.timeline({ paused: true });
${[...units.flatMap((unit, index) => transitionJs(units[index - 1], unit, width, height)), captions?.js].filter(Boolean).join("\n")}
  tl.to({}, { duration: ${duration} }, 0);
  // The HyperFrames runtime makes the registry; the page still builds without it.
  window.__timelines = window.__timelines || {};
  window.__timelines["main"] = tl;
})();
</script>
</body>
</html>
`;
}

/** Where a push sends the outgoing unit: the incoming one arrives from the opposite side. */
const PUSHES = {
  "push-left": { axis: "x", sign: -1 },
  "push-right": { axis: "x", sign: 1 },
  "push-up": { axis: "y", sign: -1 },
  "push-down": { axis: "y", sign: 1 },
} as const;

/**
 * The Transition from one unit into the next, on the root timeline, over the time the two units
 * overlap from the incoming unit's start. A cut needs nothing: the outgoing unit ends as the
 * incoming one starts. A carry-over cuts too, while the frame flies the shared element inside the
 * incoming unit; a camera move only happens inside a Canvas unit.
 */
function transitionJs(from: Unit | undefined, to: Unit, width: number, height: number): string[] {
  const type = to.transitionIn;

  if (!from || !type) {
    return [];
  }

  const seconds = TRANSITION_SECONDS[type];

  if (!seconds) {
    return [];
  }

  /** Tweens one unit's host between two sets of properties, written as object literal bodies. */
  const tween = (unit: Unit, [fromVars, toVars]: [string, string], ease: string) =>
    `  tl.fromTo("#el-${unit.id}", { ${fromVars} }, { ${toVars}, duration: ${seconds}, ease: ${ease}, immediateRender: false }, ${to.start});`;

  if (type === "crossfade") {
    return [tween(from, ["opacity: 1", "opacity: 0"], '"power2.inOut"'), tween(to, ["opacity: 0", "opacity: 1"], '"power2.inOut"')];
  }

  if (type === "zoom-through") {
    // The camera flies through the outgoing unit into the incoming one, which grows in behind it.
    return [
      tween(from, ['scale: 1, opacity: 1, filter: "blur(0px)"', 'scale: 2.2, opacity: 0, filter: "blur(8px)"'], '"power3.in"'),
      tween(to, ['scale: 0.6, opacity: 0, filter: "blur(8px)"', 'scale: 1, opacity: 1, filter: "blur(0px)"'], '"power3.out"'),
    ];
  }

  if (type in PUSHES) {
    const { axis, sign } = PUSHES[type as keyof typeof PUSHES];
    const distance = sign * { x: width, y: height }[axis];
    // The Style Preset's Motion sets the ease, as it does for the camera on a Canvas.
    const ease = "MB_DATA.motion.easeInOut";

    return [tween(from, [`${axis}: 0`, `${axis}: ${distance}`], ease), tween(to, [`${axis}: ${-distance}`, `${axis}: 0`], ease)];
  }

  return [];
}
