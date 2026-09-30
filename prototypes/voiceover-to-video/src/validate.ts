// PROTOTYPE: checks on the assembled project — hyperframes lint/check, the Storyboard contract validator
// (seeks the real runtime in headless Chrome), and stills for the visual review.
import { createFileServer } from "@hyperframes/producer";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { ROOT, run } from "./lib.ts";

const HF = join(ROOT, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
process.env.HYPERFRAMES_NO_TELEMETRY = "1";

export type Problem = { unit: string; source: "lint" | "check" | "contract" | "icons" | "runtime"; msg: string };

function unitOf(file: string | undefined): string {
  const m = file?.match(/compositions[\\/]([a-z0-9-]+)\.html/);
  return m ? m[1] : "main";
}

function hfJson(args: string[], cwd: string): any {
  const out = run(process.execPath, [HF, ...args, "--json"], { cwd, allowFail: true });
  const start = out.indexOf("{");
  try {
    return JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
  } catch {
    return { parseError: out.slice(0, 2000) };
  }
}

export function lintAndCheck(projDir: string): { problems: Problem[]; raw: { lint: any; check: any } } {
  const problems: Problem[] = [];
  const lint = hfJson(["lint", "."], projDir);
  for (const f of lint.findings ?? []) if (f.severity === "error") problems.push({ unit: unitOf(f.file ?? f.source ?? f.filePath), source: "lint", msg: `${f.code}: ${f.message}${f.selector ? ` (${f.selector})` : ""}` });
  const check = hfJson(["check", ".", "--no-contrast", "--samples", "15"], projDir);
  for (const sec of ["runtime", "layout", "motion"]) {
    const arr = check?.[sec]?.findings ?? (Array.isArray(check?.[sec]) ? check[sec] : []);
    for (const f of arr) if (f.severity === "error") problems.push({ unit: unitOf(f.source ?? f.file ?? f.compositionSrc ?? f.composition), source: "check", msg: `${f.code}: ${f.message ?? ""}${f.selector ? ` (${f.selector})` : ""}${f.time !== undefined ? ` @${f.time}s` : ""}` });
  }
  return { problems, raw: { lint, check } };
}

function chromePath(): string {
  const base = join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  const ver = readdirSync(base).sort().pop()!;
  return join(base, ver, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
}

export type UnitSpec = { id: string; start: number; duration: number; anchors: Record<string, number>; sceneStarts: Record<string, number>; stillsAt: number[] };

// Seeks the composition and checks every Storyboard element against its anchor; captures stills.
export async function contractAndStills(projDir: string, units: UnitSpec[], W: number, H: number, tolerance: number, stillsDir?: string) {
  const server = await createFileServer({ projectDir: projDir });
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const problems: Problem[] = [];
  const stills: Record<string, { path: string; at: string }[]> = {};
  const stats = { checked: 0, late: 0, early: 0, missing: 0, offFrame: 0, lateness: [] as number[] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(String((e as Error).message ?? e)));
    await page.goto(server.url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction("window.__hf && window.__hf.duration > 0", { timeout: 60000 });
    for (const e of errs) problems.push({ unit: (e.match(/in (s\d\d|c\d)/) ?? e.match(/(s\d\d|c\d)/))?.[1] ?? "main", source: "runtime", msg: e });

    const seek = async (t: number) => {
      await page.evaluate((tt) => (window as any).__hf.seek(tt), t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    };
    const probe = (sel: string) =>
      page.evaluate(
        (s, w, h) => {
          const el = document.querySelector(s) as HTMLElement | null;
          if (!el) return { exists: false, visible: false, inFrame: false };
          let op = 1;
          for (let n: HTMLElement | null = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden") return { exists: true, visible: false, inFrame: false };
            op *= Number(cs.opacity);
          }
          const r = el.getBoundingClientRect();
          const inFrame = r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < w && r.top < h;
          const clip = getComputedStyle(el).clipPath;
          const clipped = clip && /inset\(0(px|%)? 100%|inset\(100%/.test(clip);
          return { exists: true, visible: op >= 0.3 && inFrame && !clipped, inFrame, op };
        },
        sel, W, H,
      );

    for (const u of units) {
      for (const [id, local] of Object.entries(u.anchors)) {
        const T = u.start + local;
        stats.checked++;
        await seek(Math.max(0, T - 0.3));
        const before = await probe(`#${id}`);
        if (!before.exists) {
          stats.missing++;
          problems.push({ unit: u.id, source: "contract", msg: `#${id} does not exist in the DOM` });
          continue;
        }
        if (before.visible && T - 0.3 > u.start + 0.05) {
          stats.early++;
          problems.push({ unit: u.id, source: "contract", msg: `#${id} is already visible 0.3 s before its anchor (${local.toFixed(2)}s) — reveal it on its word` });
        }
        await seek(T + tolerance);
        let after = await probe(`#${id}`);
        if (!after.visible) {
          // how late is it? (bounded search)
          let late = -1;
          for (const dt of [0.25, 0.5, 1, 2]) {
            await seek(T + dt);
            if ((await probe(`#${id}`)).visible) { late = dt; break; }
          }
          stats.late++;
          stats.lateness.push(late);
          problems.push({ unit: u.id, source: "contract", msg: late > 0 ? `#${id} becomes visible ~${late}s after its anchor (${local.toFixed(2)}s); must be within ${tolerance}s` : `#${id} is not visible (opacity ≥ 0.5, inside the frame) after its anchor (${local.toFixed(2)}s)` });
        }
      }
      if (stillsDir) {
        mkdirSync(stillsDir, { recursive: true });
        stills[u.id] = [];
        for (const t of u.stillsAt) {
          await seek(t);
          const p = join(stillsDir, `${u.id}-${t.toFixed(2)}.png`);
          await page.screenshot({ path: p as `${string}.png` });
          stills[u.id].push({ path: p, at: `t=${(t - u.start).toFixed(1)}s into the unit` });
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { problems, stills, stats };
}

export function render(projDir: string, out: string): { secs: number; log: string } {
  const t0 = performance.now();
  const log = run(process.execPath, [HF, "render", "-o", out, "--quality", "standard"], { cwd: projDir, allowFail: true });
  if (!existsSync(out)) throw new Error(`render failed:\n${log.slice(-3000)}`);
  return { secs: (performance.now() - t0) / 1000, log };
}
