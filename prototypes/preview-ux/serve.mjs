// PROTOTYPE (throwaway) for "Prototype: Preview UX" (MotionBrief #19).
// Three variants of the Project screen, switchable via ?variant=A|B|C, fed by the real CDN spike run.
// Run: node prototypes/preview-ux/serve.mjs  ->  http://localhost:5179/?variant=A
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, createReadStream, existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runsRoot = join(here, '..', 'voiceover-to-video', 'runs');
const run = join(runsRoot, 'cdn');
const PORT = 5179;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// The spike's horizontal run ended with no flags; mark two units so fallback and review-note states show up.
const SIMULATED = { horizontal: { s03: 'flagged', s10: 'fallback' }, vertical: {} };

function buildFormat(dir, format) {
  const sb = readJson(join(run, dir, 'storyboard.json'));
  const m = readJson(join(run, dir, 'metrics.json'));
  const t = readJson(join(run, 'transcript.json'));
  const stills = readdirSync(join(run, dir, 'stills-final')).map((f) => {
    const [unit, time] = f.replace('.png', '').split('-');
    return { f, unit, time: Number(time) };
  });
  const scenes = sb.scenes.map((s, i) => {
    const next = sb.scenes[i + 1];
    const start = t.words[s.from].s;
    const end = next ? t.words[next.from].s : t.duration;
    const unit = s.canvas ?? s.id;
    const own = stills.filter((x) => x.unit === unit);
    const inside = own.filter((x) => x.time >= start - 0.05 && x.time <= end + 0.05).sort((a, b) => b.time - a.time);
    const still = inside[0] ?? own.sort((a, b) => Math.abs(a.time - start) - Math.abs(b.time - start))[0];
    return { ...s, n: i + 1, unit, start, end, still: still ? `/runs/cdn/${dir}/stills-final/${still.f}` : null };
  });
  const unitIds = [...new Set(scenes.map((s) => s.unit))];
  const units = unitIds.map((id) => {
    const real = m.status[id] === 'review-flagged' ? 'flagged' : m.status[id] === 'fallback' ? 'fallback' : 'ok';
    const final = SIMULATED[format][id] ?? real;
    return {
      id,
      scenes: scenes.filter((s) => s.unit === id).map((s) => s.id),
      retries: m.history?.[id]?.length ?? 0,
      final,
      notes: final === 'flagged' ? (m.reviews?.[id]?.issues ?? []) : [],
    };
  });
  return {
    format,
    title: sb.title,
    video: `/runs/cdn/${dir}/video.mp4`,
    costUsd: m.costUsd,
    wallClockSec: m.wallClockSec,
    scenes,
    units,
  };
}

const data = {
  transcript: readJson(join(run, 'transcript.json')),
  formats: {
    horizontal: buildFormat('horizontal-r1', 'horizontal'),
    vertical: buildFormat('vertical-r2', 'vertical'),
  },
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json' };

function sendFile(req, res, file) {
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/data.json') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data)); return; }
  if (path.startsWith('/runs/')) { sendFile(req, res, join(runsRoot, normalize(path.slice(6)))); return; }
  sendFile(req, res, join(here, path === '/' ? 'index.html' : normalize(path)));
}).listen(PORT, () => console.log(`Preview UX prototype: http://localhost:${PORT}/?variant=A`));
