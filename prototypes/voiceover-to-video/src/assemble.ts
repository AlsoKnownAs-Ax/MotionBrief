// PROTOTYPE: root composition, built deterministically from the Storyboard (never by the agent):
// unit timing, Transitions, Captions, Voiceover, the MB_DATA anchor table.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { DIMS, MB_RUNTIME, STYLE, frameCss, wrapUnit, type Format, type Unit, type UnitCode } from "./frame.ts";
import { sceneTimings, type Storyboard } from "./storyboard.ts";
import type { Transcript } from "./transcribe.ts";

export const TRANSITION_DUR: Record<string, number> = { cut: 0, crossfade: 0.5, "zoom-through": 0.45, "push-left": 0.55, "push-right": 0.55, "push-up": 0.55, "push-down": 0.55, camera: 0 };
const LEAD = 0.25; // a Scene starts this long before its first word

// Group Scenes into units: a lone Scene, or a run of Scenes sharing a Canvas.
export function buildUnits(sb: Storyboard, t: Transcript): (Unit & { anchors: Record<string, number>; sceneStarts: Record<string, number>; transitionIn: string; tail: number })[] {
  const tim = sceneTimings(sb, t, LEAD);
  const units: ReturnType<typeof buildUnits> = [];
  sb.scenes.forEach((s, k) => {
    const last = units[units.length - 1];
    if (s.canvas && last && last.scenes[last.scenes.length - 1].canvas === s.canvas) {
      last.scenes.push(s);
      return;
    }
    units.push({ id: s.canvas ? s.canvas : s.id, scenes: [s], start: tim[k].start, duration: 0, anchors: {}, sceneStarts: {}, transitionIn: s.transitionIn, tail: 0 });
  });
  const byId = new Map(tim.map((x) => [x.id, x]));
  units.forEach((u, i) => {
    const end = byId.get(u.scenes[u.scenes.length - 1].id)!.end;
    const next = units[i + 1];
    u.tail = next ? TRANSITION_DUR[next.transitionIn] ?? 0 : 0; // outgoing holds across the incoming Transition
    u.duration = +(end - u.start + u.tail).toFixed(3);
    for (const s of u.scenes) {
      const st = byId.get(s.id)!;
      u.sceneStarts[s.id] = +(st.start - u.start).toFixed(3);
      for (const [eid, a] of Object.entries(st.anchors)) u.anchors[`${s.id}-${eid}`] = +(a + st.start - u.start).toFixed(3);
    }
  });
  return units;
}

function transitionJs(kind: string, from: string, to: string, T: number, W: number, H: number): string[] {
  const d = TRANSITION_DUR[kind] ?? 0;
  const O = `"#el-${from}"`, N = `"#el-${to}"`;
  switch (kind) {
    case "crossfade":
      return [`tl.to(${O}, { opacity: 0, duration: ${d}, ease: "power2.inOut" }, ${T});`, `tl.fromTo(${N}, { opacity: 0 }, { opacity: 1, duration: ${d}, ease: "power2.inOut" }, ${T});`];
    case "zoom-through":
      return [
        `tl.to(${O}, { scale: 2.2, opacity: 0, filter: "blur(8px)", duration: ${d}, ease: "power3.in" }, ${T});`,
        `tl.fromTo(${N}, { scale: 0.6, opacity: 0, filter: "blur(8px)" }, { scale: 1, opacity: 1, filter: "blur(0px)", duration: ${d}, ease: "power3.out" }, ${T});`,
      ];
    case "push-left":
    case "push-right":
    case "push-up":
    case "push-down": {
      const dir = kind.slice(5);
      const axis = dir === "left" || dir === "right" ? "x" : "y";
      const size = axis === "x" ? W : H;
      const out = dir === "left" || dir === "up" ? -size : size;
      return [
        `tl.to(${O}, { ${axis}: ${out}, duration: ${d}, ease: "power3.inOut" }, ${T});`,
        `tl.fromTo(${N}, { ${axis}: ${-out} }, { ${axis}: 0, duration: ${d}, ease: "power3.inOut" }, ${T});`,
      ];
    }
    default:
      return [];
  }
}

function captionsFile(t: Transcript, format: Format, total: number): string {
  const d = DIMS[format];
  const chunks: { words: typeof t.words }[] = [];
  let cur: typeof t.words = [];
  for (const w of t.words) {
    cur.push(w);
    if (cur.length >= 3 || w.end || w.w.length > 10) {
      chunks.push({ words: cur });
      cur = [];
    }
  }
  if (cur.length) chunks.push({ words: cur });
  const html: string[] = [];
  const js: string[] = [];
  chunks.forEach((c, i) => {
    const s = c.words[0].s;
    const next = chunks[i + 1];
    const e = next ? Math.min(next.words[0].s, c.words[c.words.length - 1].e + 0.6) : c.words[c.words.length - 1].e + 0.6;
    html.push(`<div class="cap" id="cap-${i}">${c.words.map((w, j) => `<span id="cap-${i}-${j}">${w.w.replace(/[<>&]/g, "")}</span>`).join(" ")}</div>`);
    js.push(`tl.set("#cap-${i}", { opacity: 1 }, ${s.toFixed(3)}); tl.set("#cap-${i}", { opacity: 0 }, ${e.toFixed(3)});`);
    c.words.forEach((w, j) => js.push(`tl.set("#cap-${i}-${j}", { color: "${STYLE.accent}" }, ${w.s.toFixed(3)}); tl.set("#cap-${i}-${j}", { color: "${STYLE.ink}" }, ${(next && j === c.words.length - 1 ? e : c.words[j + 1]?.s ?? e).toFixed(3)});`));
  });
  return `<template>
<style>${frameCss(format)}
.cap { position: absolute; left: 60px; right: 60px; top: ${d.safe.bottom + 90}px; text-align: center; opacity: 0;
  font-size: 64px; font-weight: 800; letter-spacing: -0.01em; text-shadow: 0 4px 24px rgba(0,0,0,.8); color: var(--ink); }
</style>
<div id="root" data-composition-id="captions" data-width="${d.W}" data-height="${d.H}" data-duration="${total}">
${html.join("\n")}
</div>
<script>
(function () {
  const tl = gsap.timeline({ paused: true });
  ${js.join("\n  ")}
  tl.to({}, { duration: ${total} }, 0);
  window.__timelines["captions"] = tl;
})();
</script>
</template>
`;
}

export function copyAssets(projDir: string) {
  const a = join(projDir, "assets");
  mkdirSync(join(a, "fonts"), { recursive: true });
  const nm = join(ROOT, "node_modules");
  copyFileSync(join(nm, "gsap", "dist", "gsap.min.js"), join(a, "gsap.min.js"));
  const fonts: [string, string][] = [
    ["@fontsource/inter/files/inter-latin-400-normal.woff2", "inter-400.woff2"],
    ["@fontsource/inter/files/inter-latin-600-normal.woff2", "inter-600.woff2"],
    ["@fontsource/inter/files/inter-latin-800-normal.woff2", "inter-800.woff2"],
    ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", "jbm-400.woff2"],
    ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", "jbm-700.woff2"],
  ];
  for (const [src, dst] of fonts) copyFileSync(join(nm, src), join(a, "fonts", dst));
  writeFileSync(join(a, "mb.js"), MB_RUNTIME);
}

export function assemble(opts: {
  projDir: string;
  sb: Storyboard;
  t: Transcript;
  format: Format;
  code: Map<string, UnitCode>;
  captions: boolean;
  voiceoverWav: string;
}) {
  const { projDir, sb, t, format, code, captions } = opts;
  const { W, H, safe } = DIMS[format];
  mkdirSync(join(projDir, "compositions"), { recursive: true });
  if (!existsSync(join(projDir, "assets", "mb.js"))) copyAssets(projDir);
  copyFileSync(opts.voiceoverWav, join(projDir, "assets", "voiceover.wav"));

  const units = buildUnits(sb, t);
  const total = +(t.duration + 0.6).toFixed(3);
  const mbData = { width: W, height: H, format, safe, units: {} as Record<string, unknown> };
  const body: string[] = [];
  const tjs: string[] = [];
  units.forEach((u, i) => {
    const c = code.get(u.id);
    if (!c) throw new Error(`no code for unit ${u.id}`);
    writeFileSync(join(projDir, "compositions", `${u.id}.html`), wrapUnit(u, format, c));
    const words = t.words.filter((w) => w.i >= u.scenes[0].from && w.i <= u.scenes[u.scenes.length - 1].to).map((w) => [w.w, +(w.s - u.start).toFixed(3)]);
    mbData.units[u.id] = { duration: u.duration, anchors: u.anchors, sceneStarts: u.sceneStarts, words };
    body.push(
      `<div id="el-${u.id}" class="scene" data-composition-id="${u.id}" data-composition-src="compositions/${u.id}.html" data-start="${u.start}" data-duration="${u.duration}" data-track-index="${1 + (i % 2)}"></div>`,
    );
    if (i > 0) tjs.push(...transitionJs(u.transitionIn, units[i - 1].id, u.id, u.start, W, H));
  });
  if (captions) {
    writeFileSync(join(projDir, "compositions", "captions.html"), captionsFile(t, format, total));
    body.push(`<div id="el-captions" class="scene" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${total}" data-track-index="5"></div>`);
  }
  body.push(`<audio id="el-voiceover" src="assets/voiceover.wav" data-start="0" data-duration="${t.duration.toFixed(3)}" data-track-index="10" data-volume="1"></audio>`);

  writeFileSync(
    join(projDir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="assets/gsap.min.js"></script>
<script>window.MB_DATA = ${JSON.stringify(mbData)};</script>
<script src="assets/mb.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${STYLE.bg}; }
.scene { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
${body.join("\n")}
</div>
<script>
window.__timelines["main"] = gsap.timeline({ paused: true });
(function () { var tl = window.__timelines["main"];
${tjs.join("\n")}
tl.to({}, { duration: ${total} }, 0);
})();
</script>
</body>
</html>
`,
  );
  return { units, total };
}
