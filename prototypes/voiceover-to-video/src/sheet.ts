// PROTOTYPE: builds runs/lookcheck/index.html — one section per Preset: settings, Palette + contrast, stills, demo videos.
// usage: node src/sheet.ts   (after src/lookcheck.ts)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { PRESETS, ROLES, TYPOGRAPHY } from "./preset.ts";

const OUT = join(ROOT, "runs", "lookcheck");
const report = JSON.parse(readFileSync(join(OUT, "report.json"), "utf8"));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

const sections = Object.values(PRESETS).map((p) => {
  const T = TYPOGRAPHY[p.typography];
  const tr = p.treatments;
  const sw = ROLES.map((r) => `<div class="sw"><i style="background:${p.palette.colors[r]}"></i><span>${r}<br><code>${p.palette.colors[r]}</code></span></div>`).join("");
  const con = (report[`${p.id}-contrast`] ?? []).map((c: any) => `<tr class="${c.ok ? "" : "bad"}"><td>${c.pair}</td><td>${c.ratio}</td><td>≥ ${c.need}</td></tr>`).join("");
  const fmt = (f: string) => {
    const key = `${p.id}-${f}`;
    const r = report[key];
    if (!r) return "";
    const stills = existsSync(join(OUT, key, "stills")) ? readdirSync(join(OUT, key, "stills")).map((s) => `<img src="${key}/stills/${s}" class="${f}">`).join("") : "";
    const vid = existsSync(join(OUT, key, "demo.mp4")) ? `<video src="${key}/demo.mp4" controls loop class="${f}"></video>` : "";
    const probs = [...r.problems, ...r.tokens, ...r.iconErr];
    return `<div class="fmt"><h3>${f}</h3>
<p class="meta">contract: ${r.contract.checked} checked, ${r.contract.late} late, ${r.contract.early} early · render ${r.renderSec}s for ${r.videoSec}s of video (${(r.renderSec / r.videoSec).toFixed(1)}× realtime) · ${probs.length ? `<b class="badt">${probs.length} problems</b>` : "no problems"}</p>
${probs.length ? `<pre>${esc(probs.join("\n"))}</pre>` : ""}
<div class="media">${vid}${stills}</div></div>`;
  };
  return `<section><h2>${p.name}</h2>
<table class="set">
<tr><td>Palette</td><td>${p.palette.name} (${p.palette.mode})</td></tr>
<tr><td>Typography</td><td>${T.name}: display ${T.display.family} ${T.display.weight}, body ${T.body.family} ${T.body.weight}, mono ${T.mono.family}</td></tr>
<tr><td>Treatments</td><td>surface ${tr.surface} r${tr.radius} · background ${tr.background} · connectors ${tr.connector.curve ? "curved" : "straight"} ${tr.connector.weight}px · lines ${tr.line} · texture ${tr.texture} · icons ${tr.icons}</td></tr>
<tr><td>Motion</td><td>${p.motion.energy} / ${p.motion.character}</td></tr>
<tr><td>Transitions</td><td>${p.transitions.join(", ")} · Canvas ${p.canvas} · captions ${p.captions}</td></tr>
<tr><td>Direction</td><td>${esc(p.direction)}</td></tr>
</table>
<div class="pal">${sw}</div>
<details><summary>Contrast (editor rule: text AA 4.5, accents 3.0)</summary><table class="con">${con}</table></details>
${fmt("horizontal")}${fmt("vertical")}
</section>`;
});

writeFileSync(join(OUT, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>PROTOTYPE: Style Preset look check</title>
<style>
body { font: 14px/1.45 system-ui, sans-serif; margin: 0; padding: 24px 32px; background: #f4f4f5; color: #18181b; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 0 0 12px; } h3 { font-size: 14px; margin: 18px 0 4px; text-transform: capitalize; }
section { background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
.set td { padding: 2px 12px 2px 0; vertical-align: top; } .set td:first-child { color: #71717a; white-space: nowrap; }
.pal { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; } .sw { display: flex; gap: 6px; align-items: center; font-size: 11px; width: 130px; }
.sw i { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #0002; flex: none; }
.con td { padding: 1px 10px 1px 0; } .bad td { color: #b91c1c; font-weight: 600; } .badt { color: #b91c1c; }
.meta { color: #52525b; margin: 0 0 6px; } pre { background: #fef2f2; padding: 8px; white-space: pre-wrap; font-size: 12px; }
.media { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.horizontal { width: 480px; } .vertical { width: 200px; } img, video { border-radius: 6px; border: 1px solid #0001; }
</style></head><body>
<h1>PROTOTYPE: Style Preset look check</h1>
<p>One hand-written, token-only demo (architecture Scene → Transition → stat Scene, with Captions) rendered through each Preset's frame. No agent calls. Stills are taken at each Scene's end.</p>
${sections.join("\n")}
</body></html>`);
console.log(join(OUT, "index.html"));
