// PROTOTYPE: the frame we own around agent-written Scene code — tokens, safe zones, fonts, icons,
// motion helpers, the `at(id)` anchors, the Canvas camera, and the fallback Scene.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { anchorsOf, type Scene } from "./storyboard.ts";
import { FONT_FILES, PRESETS, ROLES, TYPOGRAPHY, motionSpec, type Preset } from "./preset.ts";

export type Format = "horizontal" | "vertical";
export const DIMS: Record<Format, { W: number; H: number; safe: { x: number; top: number; bottom: number } }> = {
  // bottom = y where the reserved zone starts (Captions in vertical, breathing room in horizontal)
  horizontal: { W: 1920, H: 1080, safe: { x: 120, top: 100, bottom: 980 } },
  vertical: { W: 1080, H: 1920, safe: { x: 72, top: 180, bottom: 1500 } },
};

// The active Style Preset (the spike hard-coded Blueprint here; now every frame part reads the Preset)
let P: Preset = PRESETS.blueprint;
export const usePreset = (p: Preset) => (P = p);
export const preset = () => P;

// Frame-owned SVG filter for sketchy lines; lives once in the root document
export const SKETCH_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<filter id="mb-sketch" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs></svg>`;

export function fontFaces(): string {
  const T = TYPOGRAPHY[P.typography];
  const fams = new Set([T.display.family, T.body.family, T.label.family, T.mono.family]);
  const out: string[] = [];
  for (const fam of fams) {
    const [pkg, weights] = FONT_FILES[fam];
    for (const w of weights) out.push(`@font-face { font-family: "${fam}"; font-weight: ${w}; src: url("assets/fonts/${pkg}-${w}.woff2") format("woff2"); }`);
  }
  return out.join("\n");
}

export function frameCss(format: Format): string {
  const d = DIMS[format];
  const T = TYPOGRAPHY[P.typography];
  const c = P.palette.colors;
  const tr = P.treatments;
  const v = format === "vertical";
  const fs = (base: number, face: { scale?: number }) => Math.round(base * (face.scale ?? 1));
  const q = (f: string) => `"${f}"`;
  const borderW = tr.surface === "outlined" ? Math.max(2, tr.connector.weight - 1) : 2;
  const shadow = P.palette.mode === "dark" ? "0 20px 60px rgba(0,0,0,.35)" : "0 12px 32px rgba(17,24,39,.10)";
  const bg = {
    solid: `.mb-bg { position: absolute; inset: 0; background: var(--bg); }`,
    gradient: `.mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }`,
    dots: `.mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }
.mb-bg::after { content: ""; position: absolute; inset: 0; opacity: .35;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--muted) 20%, transparent) 1.5px, transparent 1.6px); background-size: 48px 48px; }`,
    lines: `.mb-bg { position: absolute; inset: 0; background: var(--bg); }
.mb-bg::after { content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(color-mix(in srgb, var(--line) 28%, transparent) 1.5px, transparent 1.5px), linear-gradient(90deg, color-mix(in srgb, var(--line) 28%, transparent) 1.5px, transparent 1.5px);
  background-size: 64px 64px; background-position: -1px -1px; }`,
  }[tr.background];
  const card = {
    flat: `.mb-card { position: relative; background: var(--surface); border: 0; border-radius: var(--radius); }`,
    outlined: `.mb-card { position: relative; background: var(--surface); border: var(--border-w) solid var(--line); border-radius: var(--radius); }`,
    elevated: `.mb-card { position: relative; background: var(--surface); border: 2px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }`,
  }[tr.surface];
  const sketchy = tr.line === "sketchy" && tr.surface !== "flat"
    ? `.mb-card { border-color: transparent; }
.mb-card::before { content: ""; position: absolute; inset: calc(-1 * var(--border-w)); border: var(--border-w) solid var(--line); border-radius: inherit; filter: url(#mb-sketch); pointer-events: none; }
.mb-icon { filter: url(#mb-sketch); }`
    : "";
  const icons = {
    outline: "",
    "outline-chip": `.mb-chip { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; flex: none; border-radius: 26%; background: var(--surface2); border: 2px solid var(--line); }
.mb-chip > .mb-icon { width: .58em; height: .58em; }`,
    "filled-chip": `.mb-chip { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; flex: none; border-radius: 30%; background: currentColor; border: var(--border-w) solid var(--line); }
.mb-chip > .mb-icon { width: .56em; height: .56em; color: var(--surface); }`,
  }[tr.icons];
  return `
${fontFaces()}
#root {
  position: absolute; inset: 0; overflow: hidden; color: var(--ink);
  font-family: var(--font-body); font-weight: ${T.body.weight};
  ${ROLES.map((r) => `--${r}: ${c[r]};`).join(" ")}
  --radius: ${tr.radius}px; --border-w: ${borderW}px; --wire-w: ${tr.connector.weight}px; --shadow: ${shadow};
  --font-display: ${q(T.display.family)}; --font-body: ${q(T.body.family)}; --font-label: ${q(T.label.family)}; --font-mono: ${q(T.mono.family)};
  --W: ${d.W}px; --H: ${d.H}px; --safe-x: ${d.safe.x}px; --safe-top: ${d.safe.top}px; --safe-bottom: ${d.safe.bottom}px;
  --safe-w: ${d.W - 2 * d.safe.x}px; --safe-h: ${d.safe.bottom - d.safe.top}px;
  --fs-display: ${fs(v ? 112 : 104, T.display)}px; --fs-title: ${fs(v ? 76 : 64, T.display)}px;
  --fs-body: ${fs(v ? 48 : 38, T.body)}px; --fs-label: ${fs(v ? 40 : 30, T.label)}px; --fs-mono: ${v ? 34 : 30}px;
}
${bg}
.mb-safe { position: absolute; left: var(--safe-x); top: var(--safe-top); width: var(--safe-w); height: var(--safe-h); }
${card}
.mb-display { font-family: var(--font-display); font-size: var(--fs-display); font-weight: ${T.display.weight}; letter-spacing: ${T.display.tracking ?? "0"}; line-height: 1.02; }
.mb-title { font-family: var(--font-display); font-size: var(--fs-title); font-weight: ${T.display.weight}; letter-spacing: ${T.display.tracking ?? "0"}; line-height: 1.08; }
.mb-body { font-family: var(--font-body); font-size: var(--fs-body); font-weight: ${T.body.weight}; line-height: 1.25; }
.mb-label { font-family: var(--font-label); font-size: var(--fs-label); font-weight: ${T.label.weight}; color: var(--muted); }
.mb-mono { font-family: var(--font-mono); font-size: var(--fs-mono); }
.mb-accent { color: var(--accent); }
.mb-icon { display: block; width: 1em; height: 1em; flex: none; }
${icons}
${sketchy}
.mb-wire { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mb-wire path { fill: none; stroke: var(--line); stroke-width: var(--wire-w); stroke-linecap: round; stroke-linejoin: round; }
`;
}

// Frame-owned texture overlay above everything (root document only)
export function textureCss(): string {
  const noise = (rgb: string, a: number, freq: number) =>
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${rgb}  0 0 0 0 ${rgb}  0 0 0 0 ${rgb}  0 0 0 ${a} 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
  return {
    none: "",
    paper: `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; mix-blend-mode: multiply; opacity: .55;
  background-image: ${noise("0.35", 0.55, 0.8)}, radial-gradient(130% 100% at 50% 40%, transparent 55%, rgba(90,60,20,.18) 100%); }`,
    grain: `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; mix-blend-mode: overlay; opacity: .35; background-image: ${noise("0.5", 0.9, 1.1)}; }`,
    // alpha lives in the element opacity (< 0.6), which HyperFrames' occlusion check treats as a non-occluding overlay
    scanlines: `.mb-texture { position: absolute; inset: 0; pointer-events: none; z-index: 50; opacity: .5;
  background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.64) 0px, rgba(0,0,0,.64) 2px, transparent 2px, transparent 4px), radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,1) 100%); }`,
  }[P.treatments.texture];
}

// ---------- icons ----------
const LUCIDE = join(ROOT, "node_modules", "lucide-static", "icons");
const BRANDS = join(ROOT, "node_modules", "simple-icons", "icons");
export function iconSvg(name: string): string | null {
  const [set, slug] = name.split(":");
  const file = set === "lucide" ? join(LUCIDE, `${slug}.svg`) : set === "brand" ? join(BRANDS, `${slug}.svg`) : "";
  if (!file || !existsSync(file)) return null;
  let svg = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (set === "brand") svg = svg.replace("<svg ", '<svg fill="currentColor" ');
  // strip sizing/class from the root <svg> tag only (inner <rect width=..> must keep theirs)
  return svg.replace(/^<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height|class)="[^"]*"/g, ""));
}
// <i data-icon="lucide:server" id=".." class=".." style=".."></i>  ->  inline <svg class="mb-icon ..">
export function inlineIcons(html: string): { html: string; errors: string[] } {
  const errors: string[] = [];
  const out = html.replace(/<i\b([^>]*)\bdata-icon="([^"]+)"([^>]*)><\/i>/g, (_m, a, name, b) => {
    const svg = iconSvg(name);
    if (!svg) {
      errors.push(`unknown icon "${name}"`);
      return "";
    }
    const attrs = `${a} ${b}`.replace(/\bclass="([^"]*)"/, "").trim();
    const cls = (`${a} ${b}`.match(/\bclass="([^"]*)"/)?.[1] ?? "").trim();
    // chip treatments: the agent's id/class/style go on the chip, which keeps the icon's 1em box
    if (P.treatments.icons !== "outline") return `<span class="mb-chip ${cls}" ${attrs}>${svg.replace("<svg", `<svg class="mb-icon"`)}</span>`;
    return svg.replace("<svg", `<svg class="mb-icon ${cls}" ${attrs}`);
  });
  return { html: out, errors };
}

// ---------- unit file ----------
export type Unit = { id: string; scenes: Scene[]; start: number; duration: number };
export type UnitCode = { css: string; html: string; js: string };

export function wrapUnit(u: Unit, format: Format, code: UnitCode): string {
  const d = DIMS[format];
  const camera = u.scenes.length > 1 ? `\n  MB.camera(tl, "${u.id}");` : "";
  return `<template>
<style>${frameCss(format)}</style>
<style>
${code.css}
</style>
<div id="root" data-composition-id="${u.id}" data-width="${d.W}" data-height="${d.H}" data-duration="${u.duration}">
  <div id="${u.id}-bg" class="clip mb-bg" data-start="0" data-duration="${u.duration}" data-track-index="0"></div>
${code.html}
</div>
<script>
(function () {
  const S = MB.scene("${u.id}");
  const at = S.at;
  const tl = gsap.timeline({ paused: true });
${code.js}${camera}
  tl.to({}, { duration: ${u.duration} }, 0);
  window.__timelines["${u.id}"] = ${motionSpec(P.motion).fps ? `MB.quantize(tl, ${u.duration})` : "tl"};
})();
</script>
</template>
`;
}

// ---------- fallback: plain, word-anchored kinetic type of the structured content ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function labelOf(o: Record<string, any>): string {
  if (typeof o.value === "number") return `${o.prefix ?? ""}${o.value}${o.unit ? " " + o.unit : ""}${o.label ? " — " + o.label : ""}`;
  return o.text ?? o.label ?? o.title ?? o.term ?? o.id;
}
export function fallbackCode(u: Unit): UnitCode {
  const blocks: string[] = [];
  const js: string[] = [];
  u.scenes.forEach((s, k) => {
    const items: { id: string; label: string }[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, any>;
        if (typeof o.id === "string" && typeof o.at === "number") items.push({ id: o.id, label: labelOf(o) });
        Object.values(o).forEach(walk);
      }
    };
    walk(s.content);
    const code = s.type === "code" ? `<pre class="mb-card mb-mono fb-code">${esc(s.content.lines.join("\n"))}</pre>` : "";
    const lines = items.map((it, i) => `<div id="${s.id}-${it.id}" class="${i === 0 ? "mb-title" : "mb-body"} fb-line">${esc(it.label)}</div>`).join("\n");
    blocks.push(`<div class="mb-safe fb-stack" data-region="${s.id}" style="${u.scenes.length > 1 ? `left:${k * 2400}px;` : ""}">${lines}${code}</div>`);
    for (const [eid] of anchorsOf(s)) js.push(`  MB.reveal(tl, "#${s.id}-${eid}", at("${s.id}-${eid}"));`);
  });
  const world = u.scenes.length > 1;
  return {
    css: `.fb-stack { display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.fb-line { max-width: 100%; } .fb-code { padding: 32px; white-space: pre; margin: 0; }
${world ? `#${u.id}-world { position: absolute; left: 0; top: 0; width: ${u.scenes.length * 2400}px; height: var(--H); }` : ""}`,
    html: world ? `<div id="${u.id}-world">${blocks.join("\n")}</div>` : blocks.join("\n"),
    js: js.join("\n"),
  };
}

// ---------- page runtime: MB.* helpers the agent calls ----------
export const MB_RUNTIME = String.raw`(function () {
  if (window.MB) return;
  function data() { return window.MB_DATA; }
  function els(t) { return typeof t === "string" ? Array.prototype.slice.call(document.querySelectorAll(t)) : (t.length !== undefined ? Array.prototype.slice.call(t) : [t]); }
  function one(t) { return typeof t === "string" ? document.querySelector(t) : t; }
  // offset of el inside ancestor, ignoring transforms (safe to call while entrance tweens hold elements offset)
  function offsetWithin(el, anc) {
    var x = 0, y = 0, n = el;
    while (n && n !== anc) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  var STYLES = {
    rise: [{ opacity: 0, y: 48 }, { opacity: 1, y: 0 }],
    drop: [{ opacity: 0, y: -48 }, { opacity: 1, y: 0 }],
    left: [{ opacity: 0, x: -80 }, { opacity: 1, x: 0 }],
    right: [{ opacity: 0, x: 80 }, { opacity: 1, x: 0 }],
    pop: [{ opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1 }],
    fade: [{ opacity: 0 }, { opacity: 1 }],
    blur: [{ opacity: 0, filter: "blur(14px)", scale: 1.04 }, { opacity: 1, filter: "blur(0px)", scale: 1 }],
    wipe: [{ clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)" }],
  };
  window.MB = {
    scene: function (id) {
      var u = data().units[id];
      if (!u) throw new Error("MB: unknown unit " + id);
      return {
        dur: u.duration, W: data().width, H: data().height, format: data().format, words: u.words, sceneStarts: u.sceneStarts,
        at: function (elId) {
          var t = u.anchors[elId];
          if (t === undefined) throw new Error("MB: no anchor for " + elId + " in " + id);
          return t;
        },
      };
    },
    // entrance on the spoken word (starts 50 ms early so it lands on the word); style: rise|drop|left|right|pop|fade|blur|wipe
    // defaults (style, duration, ease) come from the Preset's Motion
    reveal: function (tl, target, t, style, o) {
      o = o || {};
      var m = data().motion;
      var s = STYLES[style || m.reveal] || STYLES.rise;
      // an overshooting ease would push a wipe/blur past its end state
      var ease = o.ease || (m.character === "springy" && (s[0].clipPath || s[0].filter) ? "power3.out" : m.ease);
      var to = Object.assign({}, s[1], { duration: o.duration || m.dur, ease: ease, stagger: o.stagger || 0 });
      tl.fromTo(target, Object.assign({}, s[0], o.from || {}), to, Math.max(0, t - 0.05));
      return tl;
    },
    // draw an SVG path/line on (stroke-dashoffset)
    draw: function (tl, target, t, o) {
      o = o || {};
      var m = data().motion;
      els(target).forEach(function (p) {
        var len = p.getTotalLength ? p.getTotalLength() : 1000;
        p.style.strokeDasharray = len + " " + len;
        // lands like MB.reveal: starts 50 ms early with an ease-out, so it is ≥30% drawn by anchor + 0.1 s
        // (an overshooting ease would un-draw the stroke, so springy uses power3.out)
        tl.fromTo(p, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: o.duration || 1.3 * m.dur, ease: o.ease || (m.character === "springy" ? "power3.out" : m.ease) }, Math.max(0, t - 0.05));
      });
      return tl;
    },
    // OWNED BY OUR CODE: stepped Motion plays the unit at a reduced frame rate by stepping its time
    quantize: function (tl, dur) {
      var fps = data().motion.fps, q = gsap.timeline({ paused: true });
      q.fromTo(tl, { time: 0 }, { time: dur, duration: dur, ease: "steps(" + Math.max(1, Math.round(dur * fps)) + ")" }, 0);
      return q;
    },
    // set an SVG <path>'s d to a connector between two elements' box edges. svg must be .mb-wire, a child of
    // the common container of both elements, sized to that container. Call before MB.draw.
    connect: function (path, fromEl, toEl, o) {
      o = o || {};
      var p = one(path), svg = p.ownerSVGElement, box = svg.parentElement;
      svg.setAttribute("width", box.offsetWidth); svg.setAttribute("height", box.offsetHeight);
      var a = offsetWithin(one(fromEl), box), b = offsetWithin(one(toEl), box);
      function edge(r, tx, ty) {
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
        var sx = dx === 0 ? Infinity : (r.w / 2 + (o.gap || 14)) / Math.abs(dx), sy = dy === 0 ? Infinity : (r.h / 2 + (o.gap || 14)) / Math.abs(dy);
        var s = Math.min(sx, sy);
        return { x: cx + dx * s, y: cy + dy * s };
      }
      var p1 = edge(a, b.x + b.w / 2, b.y + b.h / 2), p2 = edge(b, a.x + a.w / 2, a.y + a.h / 2);
      var curve = o.curve === undefined ? data().connector.curve : o.curve;
      var d = "M" + p1.x + " " + p1.y;
      if (data().connector.sketchy) {
        // hand-drawn wobble in the geometry (a filter would clip a 0-height straight line): seeded, so seek-safe
        var seed = 0, key = (p.id || "") + p1.x + p2.y;
        for (var ci = 0; ci < key.length; ci++) seed = (seed * 31 + key.charCodeAt(ci)) % 9973;
        var rnd = function () { seed = (seed * 7919 + 17) % 9973; return seed / 9973 - 0.5; };
        var mx0 = (p1.x + p2.x) / 2, bow = curve ? 1 : 0;
        var pt = function (s) {
          // point s∈[0,1] along a straight line or along the same S-curve as the clean connector
          if (!bow) return { x: p1.x + (p2.x - p1.x) * s, y: p1.y + (p2.y - p1.y) * s };
          var u = 1 - s;
          return { x: u * u * u * p1.x + 3 * u * u * s * mx0 + 3 * u * s * s * mx0 + s * s * s * p2.x, y: u * u * u * p1.y + 3 * u * u * s * p1.y + 3 * u * s * s * p2.y + s * s * s * p2.y };
        };
        var len = Math.hypot(p2.x - p1.x, p2.y - p1.y), n = Math.max(2, Math.round(len / 90)), amp = Math.min(6, 2 + len / 250);
        var nx = -(p2.y - p1.y) / (len || 1), ny = (p2.x - p1.x) / (len || 1);
        for (var k = 1; k <= n; k++) {
          var m0 = pt((k - 0.5) / n), e = pt(k / n), j = k === n ? 0 : rnd() * amp, jm = rnd() * amp * 1.6;
          d += " Q" + (m0.x + nx * jm).toFixed(1) + " " + (m0.y + ny * jm).toFixed(1) + " " + (e.x + nx * j).toFixed(1) + " " + (e.y + ny * j).toFixed(1);
        }
      } else if (curve) {
        var mx = (p1.x + p2.x) / 2;
        d += " C" + mx + " " + p1.y + " " + mx + " " + p2.y + " " + p2.x + " " + p2.y;
      } else d += " L" + p2.x + " " + p2.y;
      p.setAttribute("d", d);
      return p;
    },
    // move an element through the centers of a list of elements (e.g. a packet along a flow)
    travel: function (tl, target, via, t, o) {
      o = o || {};
      var el = one(target), anc = el.offsetParent;
      var pts = via.map(function (v) { var r = offsetWithin(one(v), anc); return { x: r.x + r.w / 2 - el.offsetWidth / 2 - el.offsetLeft, y: r.y + r.h / 2 - el.offsetHeight / 2 - el.offsetTop }; });
      var seg = (o.duration || 0.6 * (pts.length - 1)) / (pts.length - 1);
      tl.fromTo(el, { x: pts[0].x, y: pts[0].y, opacity: 0 }, { x: pts[0].x, y: pts[0].y, opacity: 1, duration: 0.2 }, t);
      for (var i = 1; i < pts.length; i++) tl.to(el, { x: pts[i].x, y: pts[i].y, duration: seg, ease: data().motion.character === "springy" ? "power2.inOut" : data().motion.easeInOut }, t + 0.2 + (i - 1) * seg);
      return tl;
    },
    // count a number up; el's text becomes prefix + value + suffix
    countUp: function (tl, target, to, t, o) {
      o = o || {};
      var el = one(target), obj = { v: o.from || 0 }, dec = o.decimals || 0;
      function fmt(v) { return (o.prefix || "") + Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (o.suffix || ""); }
      el.textContent = fmt(obj.v);
      tl.fromTo(obj, { v: o.from || 0 }, { v: to, duration: o.duration || 1.2, ease: o.ease || "power2.out", onUpdate: function () { el.textContent = fmt(obj.v); } }, t);
      return tl;
    },
    // type an element's text on, character by character
    type: function (tl, target, t, o) {
      o = o || {};
      var el = one(target), full = el.textContent, obj = { n: 0 };
      el.textContent = "";
      tl.fromTo(obj, { n: 0 }, { n: full.length, duration: o.duration || Math.max(0.4, full.length * 0.035), ease: "none", onUpdate: function () { el.textContent = full.slice(0, Math.round(obj.n)); } }, t);
      return tl;
    },
    // brief emphasis: scale bump + accent color, then settle
    emphasize: function (tl, target, t, o) {
      o = o || {};
      var m = data().motion;
      tl.to(target, { scale: o.scale || (m.character === "springy" ? 1.14 : 1.08), color: o.color || "var(--accent)", duration: 0.2, ease: "power2.out" }, t);
      tl.to(target, { scale: 1, duration: 0.4, ease: m.ease }, t + 0.2);
      return tl;
    },
    // OWNED BY OUR CODE: camera across a Canvas. World = #<unit>-world, regions = [data-region=<sceneId>]
    camera: function (tl, unitId) {
      var u = data().units[unitId], world = document.getElementById(unitId + "-world");
      if (!world) throw new Error("MB.camera: missing #" + unitId + "-world");
      var sx = data().safe, W = data().width, H = data().height;
      var ids = Object.keys(u.sceneStarts);
      world.style.transformOrigin = "0 0";
      ids.forEach(function (sid, i) {
        var r = world.querySelector('[data-region="' + sid + '"]');
        if (!r) throw new Error("MB.camera: missing region " + sid);
        var b = offsetWithin(r, world);
        var availW = W - 2 * sx.x, availH = sx.bottom - sx.top;
        var k = Math.min(1, availW / b.w, availH / b.h);
        var x = sx.x + (availW - b.w * k) / 2 - b.x * k, y = sx.top + (availH - b.h * k) / 2 - b.y * k;
        if (i === 0) tl.set(world, { x: x, y: y, scale: k }, 0);
        else tl.to(world, { x: x, y: y, scale: k, duration: 0.9 * data().motion.durScale, ease: data().motion.character === "springy" ? "back.inOut(1.2)" : data().motion.easeInOut }, Math.max(0, u.sceneStarts[sid] - 0.35));
      });
      return tl;
    },
  };
})();
`;
