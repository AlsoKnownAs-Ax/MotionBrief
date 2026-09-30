// PROTOTYPE: zero-cost look check. Renders one hand-written, token-only demo (an architecture Scene + a stat
// Scene, with a Transition and Captions) through each Preset's frame, in both Formats. No agent calls.
// Runs lint/check, the anchor contract (springy / stepped Motion), stills, and a timed render per Preset.
// usage: node src/lookcheck.ts [presetId ...] [--no-render]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemble, buildUnits } from "./assemble.ts";
import { DIMS, inlineIcons, usePreset, type Format, type UnitCode } from "./frame.ts";
import { ROOT } from "./lib.ts";
import { PRESETS, contrastReport, type Preset } from "./preset.ts";
import type { Storyboard } from "./storyboard.ts";
import { tokenLint } from "./tokens.ts";
import type { Transcript, Word } from "./transcribe.ts";
import { contractAndStills, lintAndCheck, render } from "./validate.ts";

const args = process.argv.slice(2);
const noRender = args.includes("--no-render");
const ids = args.filter((a) => !a.startsWith("--"));
const presets = (ids.length ? ids : Object.keys(PRESETS)).map((id) => PRESETS[id]);
const OUT = join(ROOT, "runs", "lookcheck");

// ---------- synthetic Transcript ----------
const TEXT = "A CDN puts your content close to users. The user asks the nearest edge server, and only on a miss does it go back to the origin. That cuts the first byte to about one hundred fifty milliseconds. Cached at the edge.";
function transcript(): Transcript {
  const words: Word[] = [];
  let s = 0.4;
  TEXT.split(" ").forEach((w, i) => {
    const e = s + 0.14 + w.length * 0.035;
    const end = /[.?!]$/.test(w) ? "sentence" : /[,;:]$/.test(w) ? "clause" : undefined;
    words.push({ i, w, s: +s.toFixed(3), e: +e.toFixed(3), ...(end ? { end } : {}) });
    s = e + (end === "sentence" ? 0.45 : end ? 0.22 : 0.06);
  });
  return { duration: +(s + 0.3).toFixed(3), words };
}

// ---------- synthetic Storyboard ----------
function storyboard(p: Preset): Storyboard {
  const tIn = p.transitions.includes("push") ? "push-left" : (p.transitions.find((x) => x !== "cut") ?? "cut");
  return {
    title: "How a CDN works",
    transitionSet: ["cut", tIn],
    scenes: [
      {
        id: "s01", type: "architecture", from: 0, to: 26, transitionIn: "cut", intent: "user -> edge -> origin",
        content: {
          title: { id: "title", text: "How a CDN works", at: 1 },
          nodes: [{ id: "user", label: "User", icon: "lucide:user", at: 9 }, { id: "edge", label: "Edge PoP", icon: "lucide:server", at: 13 }, { id: "origin", label: "Origin", icon: "lucide:database", at: 19 }],
          edges: [{ id: "e1", from: "user", to: "edge", at: 14 }, { id: "e2", from: "edge", to: "origin", at: 20 }],
        },
      },
      {
        id: "s02", type: "stat", from: 27, to: 41, transitionIn: tIn as never, intent: "150 ms count-up",
        content: { kind: "number", number: { id: "num", value: 150, unit: "ms", label: "time to first byte", at: 34 }, caption: { id: "cap", text: "time to first byte", at: 30 } },
      },
    ],
  };
}

// ---------- hand-written, token-only Scene code (what a well-behaved agent would write) ----------
function code(format: Format): Map<string, UnitCode> {
  const v = format === "vertical";
  const s01: UnitCode = {
    css: `.lc-wrap { display: flex; flex-direction: column; gap: ${v ? 90 : 70}px; justify-content: center; }
.lc-head { display: flex; flex-direction: column; gap: 14px; }
.lc-diagram { position: relative; display: flex; flex-direction: ${v ? "column" : "row"}; align-items: center; justify-content: space-between; gap: ${v ? 110 : 60}px; ${v ? "" : "padding: 0 40px;"} }
.lc-node { display: flex; align-items: center; gap: 22px; padding: 26px 36px; min-width: ${v ? 560 : 360}px; }
.lc-ic { font-size: ${v ? 76 : 64}px; color: var(--accent2); }
.lc-key { color: var(--accent); }
.lc-pkt { position: absolute; left: 0; top: 0; padding: 8px 16px; border-radius: 999px; background: var(--accent); color: var(--bg); font-weight: 700; z-index: 3; }
.lc-hot { stroke: var(--accent2) !important; }`,
    html: `<div class="mb-safe lc-wrap">
  <div class="lc-head">
    <div id="s01-title" class="mb-title">How a CDN works</div>
    <div id="s01-kicker" class="mb-label">content delivery network</div>
  </div>
  <div id="s01-diagram" class="lc-diagram">
    <svg class="mb-wire" id="s01-wires"><path id="s01-e1"></path><path id="s01-e2"></path></svg>
    <div id="s01-user" class="mb-card lc-node"><i data-icon="lucide:user" class="lc-ic"></i><span class="mb-body">User</span></div>
    <div id="s01-edge" class="mb-card lc-node"><i data-icon="lucide:server" class="lc-ic lc-key"></i><span id="s01-edge-label" class="mb-body">Edge PoP</span></div>
    <div id="s01-origin" class="mb-card lc-node"><i data-icon="lucide:database" class="lc-ic"></i><span class="mb-body">Origin</span></div>
    <div id="s01-pkt" class="lc-pkt mb-mono" data-layout-allow-overlap>GET /</div>
  </div>
</div>`,
    js: `MB.reveal(tl, "#s01-title", at("s01-title"));
MB.reveal(tl, "#s01-kicker", at("s01-title") + 0.5, "fade");
MB.connect("#s01-e1", "#s01-user", "#s01-edge");
MB.connect("#s01-e2", "#s01-edge", "#s01-origin");
MB.reveal(tl, "#s01-user", at("s01-user"));
MB.reveal(tl, "#s01-edge", at("s01-edge"));
MB.draw(tl, "#s01-e1", at("s01-e1"));
MB.reveal(tl, "#s01-origin", at("s01-origin"));
MB.draw(tl, "#s01-e2", at("s01-e2"));
MB.travel(tl, "#s01-pkt", ["#s01-user", "#s01-edge", "#s01-origin"], at("s01-e2") + 0.6);
tl.set("#s01-e1", { attr: { class: "lc-hot" } }, at("s01-e2") + 0.6);
tl.to("#s01-pkt", { opacity: 0, duration: 0.25 }, at("s01-e2") + 2.1);
MB.emphasize(tl, "#s01-edge-label", at("s01-e2") + 2.2);`,
  };
  const s02: UnitCode = {
    css: `.lc-stat { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px; text-align: center; }
.lc-num { font-size: ${v ? 220 : 200}px; color: var(--accent); }
.lc-row { display: flex; gap: 24px; align-items: center; ${v ? "flex-direction: column;" : ""} }
.lc-code { padding: 22px 30px; color: var(--ink); }
.lc-code b { color: var(--accent2); font-weight: 700; }
.lc-good { display: flex; align-items: center; gap: 14px; padding: 18px 28px; border-radius: 999px; background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good); }
.lc-good .mb-icon, .lc-good .mb-chip { font-size: 44px; }`,
    html: `<div class="mb-safe lc-stat">
  <div id="s02-cap" class="mb-label">time to first byte</div>
  <div id="s02-num" class="mb-display lc-num">0 ms</div>
  <div class="lc-row">
    <div id="s02-code" class="mb-card mb-mono lc-code"><b>cache-control:</b> max-age=3600</div>
    <div id="s02-hit" class="lc-good mb-body"><i data-icon="lucide:zap"></i>cache hit</div>
  </div>
</div>`,
    js: `MB.reveal(tl, "#s02-cap", at("s02-cap"));
MB.reveal(tl, "#s02-num", at("s02-num"), "pop");
MB.countUp(tl, "#s02-num", 150, at("s02-num"), { suffix: " ms", duration: 1.1 });
MB.reveal(tl, "#s02-code", at("s02-num") + 1.3, "wipe");
MB.reveal(tl, "#s02-hit", at("s02-num") + 1.9);`,
  };
  return new Map([["s01", s01], ["s02", s02]]);
}

function silentWav(path: string, secs: number) {
  const rate = 22050, n = Math.ceil(secs * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  writeFileSync(path, b);
}

const t = transcript();
mkdirSync(OUT, { recursive: true });
const wav = join(OUT, "silence.wav");
silentWav(wav, t.duration);
const report: Record<string, unknown> = {};
for (const p of presets) {
  usePreset(p);
  for (const format of ["horizontal", "vertical"] as Format[]) {
    const key = `${p.id}-${format}`;
    const dir = join(OUT, key);
    rmSync(dir, { recursive: true, force: true });
    const projDir = join(dir, "project");
    const sb = storyboard(p);
    const raw = code(format);
    const tokens = [...raw.entries()].flatMap(([id, c]) => tokenLint(c).map((x) => `${id} ${x}`));
    const iconErr: string[] = [];
    const cm = new Map([...raw.entries()].map(([id, c]) => { const r = inlineIcons(c.html); iconErr.push(...r.errors); return [id, { ...c, html: r.html }]; }));
    assemble({ projDir, sb, t, format, code: cm, captions: true, voiceoverWav: wav });
    const lc = lintAndCheck(projDir);
    const units = buildUnits(sb, t);
    const specs = units.map((u) => ({ id: u.id, start: u.start, duration: u.duration, anchors: u.anchors, sceneStarts: u.sceneStarts, stillsAt: [+(u.start + u.duration - u.tail - 0.35).toFixed(2)] }));
    const cs = await contractAndStills(projDir, specs, DIMS[format].W, DIMS[format].H, 0.1, join(dir, "stills"));
    let renderSec = 0;
    if (!noRender) renderSec = +render(projDir, join(dir, "demo.mp4")).secs.toFixed(1);
    report[key] = { problems: [...lc.problems, ...cs.problems].map((x) => `[${x.source}] ${x.unit}: ${x.msg}`), tokens, iconErr, contract: cs.stats, renderSec, videoSec: t.duration };
    console.log(key, JSON.stringify(report[key]));
  }
  report[`${p.id}-contrast`] = contrastReport(p.palette);
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
