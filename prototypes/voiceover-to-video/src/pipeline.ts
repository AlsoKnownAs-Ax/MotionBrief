// PROTOTYPE: the whole spike pipeline. Transcript -> Storyboard -> Scene code (parallel) -> assemble ->
// lint/check/contract -> retries -> visual review -> fallback -> MP4, with metrics.
// usage: node src/pipeline.ts <runName> <horizontal|vertical> [--preset blueprint] [--tag x] [--reuse-storyboard] [--fallback-only]
//        [--no-review] [--concurrency 4] [--retries 2] [--tolerance 0.1]
// Palette / typography swap without the agent (re-renders an existing run's code under new tokens):
//        node src/pipeline.ts <runName> <format> --preset x --from <tag> --palette <id> --type <id> --tag swap --reuse-storyboard --reuse-code --no-review
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { REVIEW_MODEL, ask, calls, setCallLog } from "./agent.ts";
import { assemble, buildUnits } from "./assemble.ts";
import { DIMS, fallbackCode, iconSvg, inlineIcons, usePreset, type Format, type UnitCode } from "./frame.ts";
import { ROOT } from "./lib.ts";
import { PALETTES, PRESETS, TYPOGRAPHY, pacingFor } from "./preset.ts";
import { allowedStoryboardTransitions, reviewPrompt, reviewSystem, scenePrompt, sceneSystem, storyboardPrompt, storyboardSystem } from "./prompts.ts";
import { anchorsOf, storyboardJsonSchema, validateStoryboard, type Storyboard } from "./storyboard.ts";
import { tokenLint } from "./tokens.ts";
import type { Transcript } from "./transcribe.ts";
import { contractAndStills, lintAndCheck, render, type Problem } from "./validate.ts";

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: "string", default: "blueprint" },
    palette: { type: "string" },
    type: { type: "string" },
    from: { type: "string" },
    tag: { type: "string", default: "" },
    "reuse-storyboard": { type: "boolean", default: false },
    "fallback-only": { type: "boolean", default: false },
    "reuse-code": { type: "boolean", default: false },
    "no-review": { type: "boolean", default: false },
    "no-render": { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    retries: { type: "string", default: "2" },
    tolerance: { type: "string", default: "0.1" },
  },
});
const [name, format] = positionals as [string, Format];
const runDir = join(ROOT, "runs", name);
const outDir = join(runDir, format + (o.tag ? `-${o.tag}` : ""));
const projDir = join(outDir, "project");
mkdirSync(join(outDir, "code"), { recursive: true });
// the video's Preset (a snapshot: overrides replace copied values, never link)
const P = structuredClone(PRESETS[o.preset!]);
if (!P) throw new Error(`unknown preset ${o.preset}`);
if (o.palette) P.palette = structuredClone(PALETTES[o.palette]);
if (o.type) P.typography = TYPOGRAPHY[o.type].id;
usePreset(P);
writeFileSync(join(outDir, "preset.json"), JSON.stringify(P, null, 1));
if (o.from) {
  // reuse another run's Storyboard and Scene code (for the Palette / typography swap test)
  const src = join(runDir, o.from);
  copyFileSync(join(src, "storyboard.json"), join(outDir, "storyboard.json"));
  const final = JSON.parse(readFileSync(join(src, "final-code.json"), "utf8")) as Record<string, UnitCode>;
  for (const [id, c] of Object.entries(final)) writeFileSync(join(outDir, "code", `${id}.attempt0.json`), JSON.stringify(c, null, 1));
}
setCallLog(join(outDir, "calls.jsonl"));
const t: Transcript = JSON.parse(readFileSync(join(runDir, "transcript.json"), "utf8"));
const concurrency = Number(o.concurrency);
const retries = Number(o.retries);
const tolerance = Number(o.tolerance);
const pacing = pacingFor(format, P.motion.energy);
const stage: Record<string, number> = {};
const t0 = performance.now();
const mark = (k: string, since: number) => (stage[k] = +((performance.now() - since) / 1000).toFixed(1));
const log = (...a: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(0)}s]`, ...a);

async function limit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ---------- 1. Storyboard ----------
let sb: Storyboard | undefined;
const sbPath = join(outDir, "storyboard.json");
const sbAttempts: { errors: string[]; warnings: string[] }[] = [];
let ts = performance.now();
if (o["reuse-storyboard"] && existsSync(sbPath)) sb = JSON.parse(readFileSync(sbPath, "utf8"));
else {
  let feedback: string | undefined;
  for (let a = 0; a < 3 && !sb; a++) {
    log(`storyboard attempt ${a + 1}`);
    const raw = await ask<unknown>(`storyboard#${a + 1}`, { system: storyboardSystem(format, P), prompt: storyboardPrompt(t, format, feedback), schema: storyboardJsonSchema(), effort: "high" });
    writeFileSync(join(outDir, `storyboard.attempt${a + 1}.json`), JSON.stringify(raw, null, 1));
    const v = validateStoryboard(raw, t, pacing);
    // the Preset's allowed Transitions and Canvas preference
    const allowed = allowedStoryboardTransitions(P);
    for (const s of (raw as Storyboard).scenes ?? []) {
      if (s.transitionIn !== "cut" && !allowed.includes(s.transitionIn)) v.errors.push(`${s.id}: transition "${s.transitionIn}" is not allowed in this style (allowed: ${allowed.join(", ")})`);
      if (P.canvas === "never" && s.canvas) v.errors.push(`${s.id}: this style never uses Canvases; remove "canvas"`);
    }
    const icons = JSON.stringify(raw).match(/"(lucide|brand):[a-z0-9-]+"/g) ?? [];
    for (const ic of icons) if (!iconSvg(ic.slice(1, -1))) v.errors.push(`unknown icon ${ic}`);
    sbAttempts.push({ errors: v.errors, warnings: v.warnings });
    log(`  ${v.errors.length} errors, ${v.warnings.length} warnings`, v.errors.slice(0, 5));
    if (!v.errors.length) sb = v.sb;
    else feedback = v.errors.join("\n");
  }
  if (!sb) throw new Error("no valid Storyboard after 3 attempts");
  writeFileSync(sbPath, JSON.stringify(sb, null, 1));
}
mark("storyboard", ts);
const units = buildUnits(sb, t);
log(`storyboard: ${sb.scenes.length} scenes, ${units.length} units (${units.filter((u) => u.scenes.length > 1).length} canvases), transitions ${sb.transitionSet.join("/")}`);

// ---------- 2. Scene code ----------
const code = new Map<string, UnitCode>();
const history: Record<string, { attempt: number; problems: string[] }[]> = {};
const status: Record<string, "ok" | "fallback" | "review-flagged"> = {};
const genUnit = async (u: (typeof units)[number], attempt: number, feedback?: string) => {
  if (o["fallback-only"]) return fallbackCode(u);
  if (o["reuse-code"] && attempt === 0) {
    // re-check previously generated code without agent calls: take the latest attempt on disk
    const files = readdirSync(join(outDir, "code")).filter((f) => f.startsWith(`${u.id}.attempt`) && !f.includes("attempt9")).sort();
    if (files.length) return JSON.parse(readFileSync(join(outDir, "code", files[files.length - 1]), "utf8")) as UnitCode;
  }
  const prev = code.get(u.id);
  const r = await ask<UnitCode>(`scene:${u.id}#${attempt}`, {
    system: sceneSystem(format, P),
    prompt: scenePrompt(u, sb!, t, feedback && prev ? { previous: JSON.stringify(prev, null, 1), problems: feedback } : undefined),
    schema: { type: "object", properties: { css: { type: "string" }, html: { type: "string" }, js: { type: "string" } }, required: ["css", "html", "js"], additionalProperties: false },
    effort: "high",
  });
  writeFileSync(join(outDir, "code", `${u.id}.attempt${attempt}.json`), JSON.stringify(r, null, 1));
  return r;
};
const iconProblems = new Map<string, string[]>();
const tokenProblems = new Map<string, string[]>();
const rawCode = new Map<string, UnitCode>(); // as the agent wrote it (before icon inlining), for the swap test
const setCode = (id: string, c: UnitCode) => {
  const { html, errors } = inlineIcons(c.html);
  iconProblems.set(id, errors);
  tokenProblems.set(id, tokenLint(c));
  rawCode.set(id, c);
  code.set(id, { ...c, html });
};

ts = performance.now();
log(`generating ${units.length} units, concurrency ${concurrency}`);
await limit(units, concurrency, async (u) => setCode(u.id, await genUnit(u, 0)));
mark("sceneCode", ts);

// ---------- 3. checks + retries ----------
const W = DIMS[format].W, H = DIMS[format].H;
const stillsAt = (u: (typeof units)[number]) => {
  const ends = u.scenes.map((s, k) => (u.scenes[k + 1] ? u.sceneStarts[u.scenes[k + 1].id] : u.duration - u.tail));
  return ends.map((e) => +(u.start + e - 0.35).toFixed(2));
};
const specs = () => units.map((u) => ({ id: u.id, start: u.start, duration: u.duration, anchors: u.anchors, sceneStarts: u.sceneStarts, stillsAt: stillsAt(u) }));
let contractStats: any;
async function checkAll(label: string, stills = false) {
  const tc = performance.now();
  assemble({ projDir, sb: sb!, t, format, code, captions: format === "vertical", voiceoverWav: join(runDir, "audio", "voiceover.wav") });
  const lc = lintAndCheck(projDir);
  writeFileSync(join(outDir, `checks.${label}.json`), JSON.stringify(lc.raw, null, 1));
  const cs = await contractAndStills(projDir, specs(), W, H, tolerance, stills ? join(outDir, `stills-${label}`) : undefined);
  contractStats = cs.stats;
  const problems: Problem[] = [...lc.problems, ...cs.problems];
  for (const [id, errs] of iconProblems) for (const e of errs) problems.push({ unit: id, source: "icons", msg: e });
  for (const [id, errs] of tokenProblems) for (const e of errs) problems.push({ unit: id, source: "tokens", msg: e });
  const byUnit = new Map<string, Problem[]>();
  for (const p of problems) byUnit.set(p.unit, [...(byUnit.get(p.unit) ?? []), p]);
  stage[`check.${label}`] = +((performance.now() - tc) / 1000).toFixed(1);
  log(`checks ${label}: ${problems.length} problems in ${byUnit.size} units`, [...byUnit.entries()].map(([k, v]) => `${k}:${v.length}`).join(" "));
  return { byUnit, stills: cs.stills };
}

ts = performance.now();
let result = await checkAll("a0");
for (let a = 1; a <= retries; a++) {
  const failing = units.filter((u) => result.byUnit.has(u.id));
  for (const u of failing) (history[u.id] ??= []).push({ attempt: a - 1, problems: result.byUnit.get(u.id)!.map((p) => `[${p.source}] ${p.msg}`) });
  if (!failing.length || o["fallback-only"]) break;
  log(`retry ${a}: ${failing.map((u) => u.id).join(", ")}`);
  await limit(failing, concurrency, async (u) => setCode(u.id, await genUnit(u, a, result.byUnit.get(u.id)!.map((p) => `- [${p.source}] ${p.msg}`).join("\n"))));
  result = await checkAll(`a${a}`);
}
if (result.byUnit.size) for (const u of units.filter((x) => result.byUnit.has(x.id))) (history[u.id] ??= []).push({ attempt: retries, problems: result.byUnit.get(u.id)!.map((p) => `[${p.source}] ${p.msg}`) });
// main-level problems (not attributable to a unit) are reported but don't force fallbacks
const hardFail = units.filter((u) => result.byUnit.has(u.id));
mark("checksAndRetries", ts);

// ---------- 4. fallback for units that still fail ----------
for (const u of hardFail) {
  status[u.id] = "fallback";
  setCode(u.id, fallbackCode(u));
}
ts = performance.now();
result = await checkAll("final", true);
mark("finalCheck", ts);

// ---------- 5. visual review (one repair pass) ----------
const reviews: Record<string, { pass: boolean; issues: string[] }> = {};
if (!o["no-review"] && !o["fallback-only"]) {
  ts = performance.now();
  const reviewable = units.filter((u) => status[u.id] !== "fallback");
  await limit(reviewable, concurrency, async (u) => {
    reviews[u.id] = await ask(`review:${u.id}`, {
      system: reviewSystem(P),
      model: REVIEW_MODEL,
      prompt: reviewPrompt(u, result.stills[u.id] ?? []),
      images: (result.stills[u.id] ?? []).map((s) => s.path),
      cwd: outDir,
      schema: { type: "object", properties: { pass: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } }, required: ["pass", "issues"], additionalProperties: false },
      effort: "medium",
    });
  });
  const flagged = reviewable.filter((u) => !reviews[u.id].pass && reviews[u.id].issues.length);
  log(`review: ${flagged.length}/${reviewable.length} flagged`, flagged.map((u) => u.id).join(", "));
  if (flagged.length) {
    const before = new Map(flagged.map((u) => [u.id, rawCode.get(u.id)!]));
    await limit(flagged, concurrency, async (u) => setCode(u.id, await genUnit(u, 9, reviews[u.id].issues.map((x) => `- [visual] ${x}`).join("\n"))));
    result = await checkAll("post-review", true);
    for (const u of flagged) {
      if (result.byUnit.has(u.id)) {
        log(`  ${u.id}: repair broke checks, reverting`);
        setCode(u.id, before.get(u.id)!);
        status[u.id] = "review-flagged";
      }
    }
    if (flagged.some((u) => status[u.id] === "review-flagged")) result = await checkAll("post-review-revert", true);
  }
  mark("visualReview", ts);
}
for (const u of units) status[u.id] ??= "ok";
writeFileSync(join(outDir, "final-code.json"), JSON.stringify(Object.fromEntries(rawCode), null, 1));

// ---------- 6. render ----------
let renderSecs = 0;
if (!o["no-render"]) {
  ts = performance.now();
  log("rendering");
  renderSecs = render(projDir, join(outDir, "video.mp4")).secs;
  mark("render", ts);
}

// ---------- metrics ----------
const total = (performance.now() - t0) / 1000;
const minutes = t.duration / 60;
const sum = (k: "costUsd" | "inTok" | "outTok" | "cacheRead" | "cacheWrite") => calls.reduce((a, c) => a + c[k], 0);
const metrics = {
  run: name, format, tag: o.tag, preset: P.id, palette: P.palette.id, typography: P.typography, model: process.env.SPIKE_MODEL ?? "claude-opus-5-5", reviewModel: REVIEW_MODEL, durationSec: t.duration, scenes: sb.scenes.length, units: units.length,
  canvases: units.filter((u) => u.scenes.length > 1).length, transitionSet: sb.transitionSet,
  sceneTypes: Object.fromEntries(sb.scenes.reduce((m, s) => m.set(s.type, (m.get(s.type) ?? 0) + 1), new Map<string, number>())),
  sceneLengths: units.flatMap((u) => u.scenes.map((s, k) => +((u.scenes[k + 1] ? u.sceneStarts[u.scenes[k + 1].id] : u.duration - u.tail) - u.sceneStarts[s.id]).toFixed(2))),
  anchorsPerScene: +(sb.scenes.reduce((a, s) => a + anchorsOf(s).length, 0) / sb.scenes.length).toFixed(1),
  storyboardAttempts: sbAttempts,
  status, fallbacks: Object.values(status).filter((x) => x === "fallback").length,
  unitsRetried: Object.keys(history).length, history, reviews, remainingProblems: [...result.byUnit.entries()].map(([k, v]) => ({ unit: k, problems: v.map((p) => `[${p.source}] ${p.msg}`) })),
  contract: contractStats,
  wallClockSec: +total.toFixed(1), stageSec: stage, renderSec: +renderSecs.toFixed(1),
  agentCalls: calls.length, costUsd: +sum("costUsd").toFixed(3), tokens: { in: sum("inTok"), out: sum("outTok"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite") },
  perMinute: { wallClockSec: +(total / minutes).toFixed(1), costUsd: +(sum("costUsd") / minutes).toFixed(3), outTokens: Math.round(sum("outTok") / minutes) },
};
writeFileSync(join(outDir, "metrics.json"), JSON.stringify(metrics, null, 1));
log(`done: ${metrics.wallClockSec}s wall, $${metrics.costUsd}, ${metrics.fallbacks} fallbacks, ${metrics.unitsRetried} units retried`);
