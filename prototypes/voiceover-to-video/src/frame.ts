// PROTOTYPE: the frame we own around agent-written Scene code — tokens, safe zones, fonts, icons,
// motion helpers, the `at(id)` anchors, the Canvas camera, and the fallback Scene.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { anchorsOf, type Scene } from "./storyboard.ts";

export type Format = "horizontal" | "vertical";
export const DIMS: Record<Format, { W: number; H: number; safe: { x: number; top: number; bottom: number } }> = {
  // bottom = y where the reserved zone starts (Captions in vertical, breathing room in horizontal)
  horizontal: { W: 1920, H: 1080, safe: { x: 120, top: 100, bottom: 980 } },
  vertical: { W: 1080, H: 1920, safe: { x: 72, top: 180, bottom: 1500 } },
};

// ByteMonk-like dark style (hard-coded for the spike; the Style model will own this)
export const STYLE = {
  bg: "#070b14",
  bg2: "#0d1424",
  surface: "#111a2e",
  surface2: "#17223b",
  line: "#2a3a5c",
  ink: "#eef3fb",
  muted: "#93a1bd",
  accent: "#ff7a3d",
  accent2: "#38bdf8",
  accent3: "#a78bfa",
  good: "#22c55e",
  bad: "#f43f5e",
};

export function frameCss(format: Format): string {
  const d = DIMS[format];
  const f = (w: string) => `url("assets/fonts/${w}")`;
  return `
@font-face { font-family: "Inter"; font-weight: 400; src: ${f("inter-400.woff2")} format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 600; src: ${f("inter-600.woff2")} format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 800; src: ${f("inter-800.woff2")} format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400; src: ${f("jbm-400.woff2")} format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 700; src: ${f("jbm-700.woff2")} format("woff2"); }
#root {
  position: absolute; inset: 0; overflow: hidden; color: var(--ink);
  font-family: "Inter", sans-serif; font-weight: 400;
  --bg: ${STYLE.bg}; --bg2: ${STYLE.bg2}; --surface: ${STYLE.surface}; --surface2: ${STYLE.surface2}; --line: ${STYLE.line};
  --ink: ${STYLE.ink}; --muted: ${STYLE.muted}; --accent: ${STYLE.accent}; --accent2: ${STYLE.accent2}; --accent3: ${STYLE.accent3};
  --good: ${STYLE.good}; --bad: ${STYLE.bad}; --radius: 22px;
  --W: ${d.W}px; --H: ${d.H}px; --safe-x: ${d.safe.x}px; --safe-top: ${d.safe.top}px; --safe-bottom: ${d.safe.bottom}px;
  --safe-w: ${d.W - 2 * d.safe.x}px; --safe-h: ${d.safe.bottom - d.safe.top}px;
  --fs-display: ${format === "vertical" ? 112 : 104}px; --fs-title: ${format === "vertical" ? 76 : 64}px;
  --fs-body: ${format === "vertical" ? 48 : 38}px; --fs-label: ${format === "vertical" ? 40 : 30}px; --fs-mono: ${format === "vertical" ? 34 : 30}px;
}
.mb-bg { position: absolute; inset: 0; background: radial-gradient(120% 90% at 50% 0%, var(--bg2) 0%, var(--bg) 60%); }
.mb-bg::after { content: ""; position: absolute; inset: 0; opacity: .35;
  background-image: radial-gradient(circle, rgba(147,161,189,.18) 1.5px, transparent 1.6px); background-size: 48px 48px; }
.mb-safe { position: absolute; left: var(--safe-x); top: var(--safe-top); width: var(--safe-w); height: var(--safe-h); }
.mb-card { background: var(--surface); border: 2px solid var(--line); border-radius: var(--radius); box-shadow: 0 20px 60px rgba(0,0,0,.35); }
.mb-display { font-size: var(--fs-display); font-weight: 800; letter-spacing: -0.03em; line-height: 1.02; }
.mb-title { font-size: var(--fs-title); font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; }
.mb-body { font-size: var(--fs-body); font-weight: 600; line-height: 1.25; }
.mb-label { font-size: var(--fs-label); font-weight: 600; color: var(--muted); }
.mb-mono { font-family: "JetBrains Mono", monospace; font-size: var(--fs-mono); }
.mb-accent { color: var(--accent); }
.mb-icon { display: block; width: 1em; height: 1em; flex: none; }
.mb-wire { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.mb-wire path { fill: none; stroke: var(--line); stroke-width: 4; stroke-linecap: round; }
`;
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
  return svg.replace(/\s(width|height|class)="[^"]*"/g, "");
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
  window.__timelines["${u.id}"] = tl;
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
    for (const [eid] of anchorsOf(s)) js.push(`  MB.reveal(tl, "#${s.id}-${eid}", at("${s.id}-${eid}"), "rise");`);
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
    reveal: function (tl, target, t, style, o) {
      o = o || {};
      var s = STYLES[style || "rise"] || STYLES.rise;
      var to = Object.assign({}, s[1], { duration: o.duration || 0.5, ease: o.ease || "power3.out", stagger: o.stagger || 0 });
      tl.fromTo(target, Object.assign({}, s[0], o.from || {}), to, Math.max(0, t - 0.05));
      return tl;
    },
    // draw an SVG path/line on (stroke-dashoffset)
    draw: function (tl, target, t, o) {
      o = o || {};
      els(target).forEach(function (p) {
        var len = p.getTotalLength ? p.getTotalLength() : 1000;
        p.style.strokeDasharray = len + " " + len;
        tl.fromTo(p, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: o.duration || 0.7, ease: o.ease || "power2.inOut" }, t);
      });
      return tl;
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
      var d = "M" + p1.x + " " + p1.y;
      if (o.curve) {
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
      for (var i = 1; i < pts.length; i++) tl.to(el, { x: pts[i].x, y: pts[i].y, duration: seg, ease: "power2.inOut" }, t + 0.2 + (i - 1) * seg);
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
      tl.to(target, { scale: o.scale || 1.08, color: o.color || "var(--accent)", duration: 0.2, ease: "power2.out" }, t);
      tl.to(target, { scale: 1, duration: 0.4, ease: "power3.out" }, t + 0.2);
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
        else tl.to(world, { x: x, y: y, scale: k, duration: 0.9, ease: "power3.inOut" }, Math.max(0, u.sceneStarts[sid] - 0.35));
      });
      return tl;
    },
  };
})();
`;
