// PROTOTYPE (throwaway): data, simulation and actions for Prototype: Preview UX (MotionBrief #19).
// Real Storyboard, Transcript and stills from the CDN spike run; the agent, Whisper, sign-in and the file system are simulated.
import { useState, useEffect } from './ui.js';

export const D = await (await fetch('/data.json')).json();
export const W = D.transcript.words;
export const DUR = D.transcript.duration;
for (const fmt of Object.values(D.formats)) {
  fmt.unitsById = Object.fromEntries(fmt.units.map((u) => [u.id, u]));
  fmt.scenesById = Object.fromEntries(fmt.scenes.map((s) => [s.id, s]));
}

export const VARIANTS = { A: 'Editor', B: 'Chat-first' };
export const FORMAT_LABEL = { horizontal: '16:9', vertical: '9:16' };
export const TYPE_LABEL = { hook: 'Hook', 'key-term': 'Key term', architecture: 'Architecture', flow: 'Flow', code: 'Code', comparison: 'Comparison', list: 'List', stat: 'Stat', outro: 'Outro' };
export const TRANSITION = { cut: ['Scissors', 'Cut'], crossfade: ['Blend', 'Crossfade'], 'push-left': ['ArrowLeft', 'Push left'], camera: ['Video', 'Camera move'] };
export const PALETTES = [
  { id: 'blueprint', name: 'Blueprint', filter: 'none', sw: ['#0b1220', '#ff7a3d', '#4cc3ff'] },
  { id: 'ember', name: 'Ember', filter: 'hue-rotate(150deg) saturate(1.1)', sw: ['#1a0f0b', '#3dc2ff', '#ff8a4c'] },
  { id: 'mint', name: 'Mint', filter: 'hue-rotate(-70deg)', sw: ['#0b1a14', '#ff3d9a', '#4cffb0'] },
  { id: 'graphite', name: 'Graphite', filter: 'grayscale(1) contrast(1.1)', sw: ['#111', '#bbb', '#fff'] },
];
export const PRESETS = [
  { id: 'Blueprint', blurb: 'Technical diagrams on a navy grid' },
  { id: 'Whiteboard', blurb: 'Marker drawings on white' },
  { id: 'Sketchbook', blurb: 'Hand-drawn lines on paper' },
  { id: 'Terminal', blurb: 'Monospace on black, like a shell' },
];
export const PLAYABLE = new Set(['ready', 'reviewing', 'flagged', 'revising']);
export const WORKING = new Set(['coding', 'checking', 'reviewing', 'revising']);
export const MODEL_MB = 574;

// ---------- generation schedule (simulated seconds, concurrency 4, retries from the spike) ----------
function buildSchedule(fmt) {
  const SB = 90;
  const lanes = [SB, SB, SB, SB];
  const sched = {};
  for (const u of fmt.units) {
    const li = lanes.indexOf(Math.min(...lanes));
    const start = lanes[li];
    const attempts = 1 + (u.final === 'fallback' ? 2 : u.retries);
    const per = 55 + 22 * u.scenes.length;
    const segs = [];
    let c = start;
    for (let a = 0; a < attempts; a++) { segs.push({ a, codeEnd: c + per * 0.75, end: c + per }); c += per; }
    sched[u.id] = { start, end: c, segs };
    lanes[li] = c;
  }
  const unitsEnd = Math.max(...lanes);
  return { SB, sched, unitsEnd, reviewEnd: unitsEnd + 60, total: unitsEnd + 60 };
}
export const SCHED = Object.fromEntries(Object.entries(D.formats).map(([f, fmt]) => [f, buildSchedule(fmt)]));

function genStatus(u, sch, g) {
  const c = g.stoppedAt ?? g.clock;
  if (c < sch.SB) return { status: g.stoppedAt != null ? 'stopped' : 'waiting' };
  const s = sch.sched[u.id];
  if (c >= s.end) {
    if (u.final === 'fallback') return { status: 'fallback' };
    if (c >= sch.reviewEnd) return { status: u.final === 'flagged' ? 'flagged' : 'ready' };
    if (c >= sch.unitsEnd) return { status: g.stoppedAt != null ? 'ready' : 'reviewing' };
    return { status: 'ready' };
  }
  if (g.stoppedAt != null) return { status: 'stopped' };
  if (c < s.start) return { status: 'queued' };
  const seg = s.segs.find((x) => c < x.end);
  return { status: c < seg.codeEnd ? 'coding' : 'checking', attempt: seg.a + 1 };
}

// ---------- store ----------
const q = new URLSearchParams(location.search);
let nextId = 1;
const uid = () => `m${nextId++}`;

export const fmtState = (f) => ({
  exists: true, gen: { clock: 0, stoppedAt: null }, genDone: false, overrides: {}, fallbackWhy: {}, rev: null, queue: [], queuePaused: false,
  approval: null, restyleConfirm: null, messages: [], versions: [], selection: [],
  palette: 'blueprint', typography: 'Inter Display', captionStyle: 'Bold pop', captions: f === 'vertical', preset: 'Blueprint', extraCost: 0,
});

// An existing Project, reopened after its first generation and two edits.
function finishedState(f) {
  const v = fmtState(f);
  const s3 = D.formats[f].scenes[2];
  const msgs = [
    { id: uid(), role: 'system', kind: 'version', text: 'v1 · First generation' },
    { id: uid(), role: 'user', text: 'Make the latency number red, it should feel like a warning', scenes: [s3.id] },
    { id: uid(), role: 'agent', text: `Patched the Storyboard and regenerated Scene ${s3.n}; nothing else changed. Now on v2.` },
    { id: uid(), role: 'system', kind: 'version', text: 'v2 · Revision: “Make the latency number red…”' },
    { id: uid(), role: 'system', kind: 'version', text: 'v3 · Captions on' },
  ];
  return {
    ...v, gen: { clock: SCHED[f].total, stoppedAt: null }, genDone: true, messages: msgs, captions: true,
    versions: [{ n: 1, label: 'First generation', time: '14:02' }, { n: 2, label: 'Revision: “Make the latency number red…”', time: '14:31' }, { n: 3, label: 'Captions on', time: '14:33' }],
  };
}

const PROJECTS = [
  { id: 'cdn', name: 'How a CDN Works', formats: ['horizontal', 'vertical'], dur: DUR, versions: 3, size: '214 MB', modified: 'Today, 15:27', still: D.formats.horizontal.scenes[1].still, open: 'normal' },
  { id: 'code', name: 'Write Code Your Future Self Can Read', formats: ['horizontal', 'vertical'], dur: 167, versions: 5, size: '388 MB', modified: 'Yesterday, 21:04', still: '/runs/code-better/horizontal-r2/stills-final/s07-38.36.png', open: 'frameBump' },
  { id: 'rate', name: 'Rate Limiting, Explained', formats: ['horizontal'], dur: 95, versions: 1, size: '96 MB', modified: 'Sep 28', still: D.formats.horizontal.scenes[8].still, open: 'lock' },
  { id: 'docker', name: 'Docker Layers in 60 Seconds', formats: ['vertical'], dur: 58, versions: 2, size: '71 MB', modified: 'Sep 24', where: 'D:\\Shorts\\Docker Layers', still: null, open: 'newer' },
];

// Pane sizes in px; the real app would persist them per window, not per Project.
export const LAYOUT = { panelW: 384, tlH: 196, chatW: 440 };
export const setLayout = (patch) => set((s) => ({ layout: { ...s.layout, ...patch } }));

const newProjectState = () => ({ stage: 'drop', file: null, name: '', format: 'horizontal', preset: 'Blueprint', lang: 'auto', tx: { state: 'idle', t: 0 } });
const firstRun = q.get('screen') === 'setup';
const SETUP_DONE = { claude: 'connected', keyError: false, model: { state: 'ready', mb: MODEL_MB }, dismissed: true };
const SETUP_FRESH = { claude: 'none', keyError: false, model: { state: 'downloading', mb: 0 }, dismissed: false };

export let S = {
  screen: q.get('screen') ?? (q.get('variant') ? 'editor' : 'home'),
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'A',
  format: q.get('format') === 'vertical' ? 'vertical' : 'horizontal',
  placeholder: q.get('ph') ?? 'animatic',
  auth: q.get('auth') === 'apikey' ? 'apikey' : 'subscription', speed: 12, simPlaying: true, t: 0, playing: false,
  layout: { ...LAYOUT }, edits: {}, editWord: null, notice: null, projectName: 'How a CDN Works',
  v: { horizontal: fmtState('horizontal'), vertical: fmtState('vertical') },
  setup: firstRun ? SETUP_FRESH : SETUP_DONE,
  projects: PROJECTS, menu: null, renaming: null, toast: null, dialog: null, dragging: false,
  newp: newProjectState(),
};
if (q.get('clock')) S.v[S.format].gen.clock = Number(q.get('clock'));
if (q.get('t')) S.t = Number(q.get('t'));

const listeners = new Set();
export function set(patch) { S = { ...S, ...(typeof patch === 'function' ? patch(S) : patch) }; listeners.forEach((l) => l()); }
export function setV(patch, f = S.format) { const cur = S.v[f]; set({ v: { ...S.v, [f]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } } }); }
export function useStore() { const [, force] = useState(0); useEffect(() => { const l = () => force((x) => x + 1); listeners.add(l); return () => listeners.delete(l); }, []); return S; }

// ---------- derived ----------
export const fmtOf = (f) => D.formats[f];
export function unitState(f, unitId) {
  const v = S.v[f];
  if (v.rev?.units.includes(unitId)) return { status: 'revising', phase: v.rev.clock < v.rev.patch ? 'Updating Storyboard' : 'Writing code' };
  if (v.overrides[unitId]) return { status: v.overrides[unitId] };
  return genStatus(fmtOf(f).unitsById[unitId], SCHED[f], v.gen);
}
export const sceneState = (f, s) => unitState(f, s.unit);
export function genPhase(f) {
  const v = S.v[f], sch = SCHED[f], c = v.gen.stoppedAt ?? v.gen.clock;
  if (v.gen.stoppedAt != null && c < sch.total) return 'stopped';
  if (c < sch.SB) return 'storyboard';
  if (c < sch.unitsEnd) return 'scenes';
  if (c < sch.reviewEnd) return 'review';
  return 'done';
}
export const genRunning = (f, v = S.v[f]) => v.exists && v.gen.stoppedAt == null && v.gen.clock < SCHED[f].total;
export const busy = (f, v = S.v[f]) => !!(v.rev || v.approval || genRunning(f, v));
export const unitsDone = (f) => fmtOf(f).units.filter((u) => ['ready', 'reviewing', 'flagged', 'fallback'].includes(unitState(f, u.id).status)).length;
export const flaggedUnits = (f) => fmtOf(f).units.filter((u) => ['flagged', 'fallback'].includes(unitState(f, u.id).status));
export const sceneAt = (fmt, t) => fmt.scenes.find((s) => t >= s.start && t < s.end) ?? fmt.scenes[fmt.scenes.length - 1];
export const wordText = (i) => S.edits[i] ?? W[i].w;
export const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const sceneName = (s) => `Scene ${s.n}`;
export function unitLabel(f, unitId) {
  const ss = fmtOf(f).unitsById[unitId].scenes.map((id) => fmtOf(f).scenesById[id]);
  return ss.length > 1 ? `Scenes ${ss[0].n}–${ss[ss.length - 1].n}` : `${sceneName(ss[0])} (${TYPE_LABEL[ss[0].type]})`;
}
export function costOf(f) {
  const v = S.v[f], sch = SCHED[f], c = v.gen.stoppedAt ?? v.gen.clock;
  const rev = v.rev ? (v.rev.clock / v.rev.dur) * v.rev.cost : 0;
  return fmtOf(f).costUsd * Math.min(c, sch.total) / sch.total + v.extraCost + rev;
}
// Spike numbers: 7–9 minutes and $3–5 per minute of video with the default models.
export function estimate(dur = DUR) {
  const m = dur / 60;
  return { min: Math.floor(m * 7), max: Math.ceil(m * 9), lo: m * 3, hi: m * 5 };
}
export function elementsOf(content) {
  const out = [];
  (function walk(v, key) {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (!v || typeof v !== 'object') return;
    if (v.id && v.at !== undefined) {
      const text = v.text ?? (v.value != null ? `${v.label ? `${v.label}: ` : ''}${v.prefix ?? ''}${v.value}${v.unit ? ` ${v.unit}` : ''}` : v.label ?? v.note ?? (v.from ? `${v.from} → ${v.to}` : v.id));
      out.push({ id: v.id, kind: key.replace(/s$/, ''), text, at: v.at });
    }
    for (const [k, x] of Object.entries(v)) if (typeof x === 'object') walk(x, k);
  })(content, 'root');
  return out.sort((a, b) => a.at - b.at);
}
export const CHUNKS = (() => {
  const out = []; let cur = [];
  W.forEach((w, i) => { cur.push(i); if (cur.length >= 6 || w.end) { out.push(cur); cur = []; } });
  if (cur.length) out.push(cur);
  return out;
})();

// ---------- player ----------
let videoEl = null;
export const bindVideo = (el) => { videoEl = el; };
export const unbindVideo = (el) => { if (videoEl === el) videoEl = null; };
export function seek(t) { const x = Math.max(0, Math.min(DUR, t)); if (videoEl) videoEl.currentTime = x; set({ t: x }); }
export function togglePlay() { if (!videoEl) return; videoEl.paused ? videoEl.play() : videoEl.pause(); }
(function loop() { if (videoEl && !videoEl.paused) set({ t: videoEl.currentTime }); requestAnimationFrame(loop); })();
export function setFormat(f) { videoEl?.pause(); set({ format: f, t: 0, playing: false }); }

// ---------- navigation and Projects ----------
export function go(screen) { videoEl?.pause(); set({ screen, playing: false, menu: null, dialog: null }); }
export function toast(text, undo) { set({ toast: { text, undo, until: Date.now() + 6000 } }); }

export function openProject(id, force = false) {
  const p = S.projects.find((x) => x.id === id);
  if (p.open === 'newer') { set({ dialog: { kind: 'newer', id } }); return; }
  if (p.open === 'lock' && !force) { set({ dialog: { kind: 'lock', id } }); return; }
  videoEl?.pause();
  const v = { horizontal: finishedState('horizontal'), vertical: finishedState('vertical') };
  let notice = null;
  if (p.open === 'frameBump') {
    const units = ['s05', 's08'];
    v.horizontal = { ...v.horizontal, overrides: Object.fromEntries(units.map((u) => [u, 'fallback'])), fallbackWhy: Object.fromEntries(units.map((u) => [u, 'frame'])) };
    notice = { kind: 'frameBump', units };
  }
  if (p.open === 'lock') {
    const s = fmtOf('horizontal').scenes;
    const jobs = [
      { kind: 'revise', text: 'Slow the camera move between the two diagram Scenes', scenes: [s[5].id, s[6].id], msgId: uid() },
      { kind: 'revise', text: 'Use a terminal-style code block for the headers', scenes: [s[8].id], msgId: uid() },
    ];
    v.horizontal = {
      ...v.horizontal, queue: jobs, queuePaused: true,
      messages: [...v.horizontal.messages, ...jobs.map((j) => ({ id: j.msgId, role: 'user', text: j.text, scenes: j.scenes, queued: true })),
        { id: uid(), role: 'system', text: 'MotionBrief closed while these were queued. Nothing ran; resume when you’re ready.' }],
    };
  }
  set({ screen: 'editor', dialog: null, menu: null, projectName: p.name, format: 'horizontal', t: 0, playing: false, v, notice });
}
export function renameProject(id, name) {
  const n = name.trim();
  set((s) => ({ renaming: null, projects: s.projects.map((p) => (p.id === id && n ? { ...p, name: n } : p)) }));
}
export function duplicateProject(id) {
  const i = S.projects.findIndex((p) => p.id === id);
  const copy = { ...S.projects[i], id: `${id}-${uid()}`, name: `${S.projects[i].name} (copy)`, modified: 'Just now', open: 'normal' };
  set((s) => ({ projects: [...s.projects.slice(0, i + 1), copy, ...s.projects.slice(i + 1)] }));
}
export function deleteProject(id) {
  const before = S.projects;
  const p = before.find((x) => x.id === id);
  set({ projects: before.filter((x) => x.id !== id) });
  toast(`Moved “${p.name}” to the Recycle Bin`, () => set({ projects: before, toast: null }));
}

// ---------- setup ----------
export const setSetup = (patch) => set((s) => ({ setup: { ...s.setup, ...patch } }));
export function resetFirstRun() { set({ setup: { ...SETUP_FRESH }, auth: 'subscription' }); go('setup'); }
export function signIn() { setSetup({ claude: 'waiting', until: Date.now() + 2600 }); }
export function connectKey(key) {
  if (/^sk-ant-/.test(key.trim())) { setSetup({ claude: 'connected', keyError: false }); set({ auth: 'apikey' }); }
  else setSetup({ keyError: true });
}
export function disconnect() { setSetup({ claude: 'none', keyError: false }); }
export function toggleDownload() { const m = S.setup.model; setSetup({ model: { ...m, state: m.state === 'paused' ? 'downloading' : 'paused' } }); }
export function importModel() { setSetup({ model: { state: 'verifying', mb: MODEL_MB, until: Date.now() + 1500 } }); }

// ---------- New Project ----------
export const setNew = (patch) => set((s) => ({ newp: { ...s.newp, ...(typeof patch === 'function' ? patch(s.newp) : patch) } }));
export function startNewProject(fromDrop = false) {
  set({ newp: newProjectState(), dragging: false });
  go('new');
  if (fromDrop) chooseVoiceover();
}
export function chooseVoiceover() {
  setNew({ stage: 'setup', file: { name: 'cdn-voiceover.wav', dur: DUR, size: '6.9 MB' }, name: 'cdn-voiceover', tx: { state: S.setup.model.state === 'ready' ? 'running' : 'waiting', t: 0 } });
}
export function generate() {
  const f = S.newp.format;
  const other = f === 'horizontal' ? 'vertical' : 'horizontal';
  const v = { [f]: { ...fmtState(f), preset: S.newp.preset }, [other]: { ...fmtState(other), exists: false, preset: S.newp.preset } };
  videoEl?.pause();
  set({ screen: 'editor', format: f, t: 0, playing: false, notice: null, projectName: S.newp.name || 'Untitled', v });
}
export function generateFormat(f) { setV({ exists: true, gen: { clock: 0, stoppedAt: null }, genDone: false }, f); }

// ---------- editor actions ----------
function addVersion(v, label) {
  const n = v.versions.length + 1;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return { ...v, versions: [...v.versions, { n, label, time }], messages: [...v.messages, { id: uid(), role: 'system', kind: 'version', text: `v${n} · ${label}` }] };
}
export function toggleSel(id, additive) {
  setV((v) => {
    const has = v.selection.includes(id);
    if (additive) return { selection: has ? v.selection.filter((x) => x !== id) : [...v.selection, id] };
    return { selection: has && v.selection.length === 1 ? [] : [id] };
  });
}
export const clearSel = () => setV({ selection: [] });
function unitsFor(f, job) {
  if (job.units) return job.units;
  if (job.scenes.length) return [...new Set(job.scenes.map((id) => fmtOf(f).scenesById[id].unit))];
  return [fmtOf(f).scenes[1].unit, fmtOf(f).scenes[4].unit]; // the agent's Storyboard patch picks these
}
function requestJob(f, v, job) {
  const units = unitsFor(f, job);
  if (S.auth === 'apikey') return { ...v, approval: { ...job, units, est: [0.3 * units.length, 0.6 * units.length] } };
  return startRev(f, v, { ...job, units });
}
function startRev(f, v, job) {
  const units = job.units ?? unitsFor(f, job);
  const patch = job.kind === 'retry' ? 0 : 18;
  const dur = patch + Math.max(...units.map((u) => 60 + 22 * fmtOf(f).unitsById[u].scenes.length));
  const id = uid();
  const names = units.map((u) => unitLabel(f, u)).join(', ');
  const live = { id, role: 'agent', live: true, text: job.kind === 'retry' ? `Retrying ${names}.` : `Updating the Storyboard, then regenerating ${names}.` };
  const messages = v.messages.map((m) => (m.id === job.msgId ? { ...m, queued: false } : m));
  return { ...v, approval: null, messages: [...messages, live], rev: { ...job, id, units, clock: 0, patch, dur, cost: 0.45 * units.length } };
}
function finishRev(f, v) {
  const r = v.rev;
  const overrides = { ...v.overrides };
  const fallbackWhy = { ...v.fallbackWhy };
  r.units.forEach((u) => { overrides[u] = 'ready'; delete fallbackWhy[u]; });
  const names = r.units.map((u) => unitLabel(f, u)).join(', ');
  let nv = { ...v, overrides, fallbackWhy, rev: null, extraCost: v.extraCost + r.cost };
  nv = addVersion(nv, r.kind === 'retry' ? `Retry ${names}` : `Revision: “${r.text.slice(0, 38)}${r.text.length > 38 ? '…' : ''}”`);
  const n = nv.versions.length;
  const text = r.kind === 'retry'
    ? `Regenerated ${names}. It passes checks and review now. Now on v${n}.`
    : `${r.scenes.length ? '' : `I picked ${names} for this. `}Patched the Storyboard and regenerated ${names}; nothing else changed. Now on v${n}.`;
  nv = { ...nv, messages: nv.messages.map((m) => (m.id === r.id ? { ...m, live: false, text } : m)) };
  return dequeue(f, nv);
}
function dequeue(f, v) {
  if (!v.queue.length || v.queuePaused || busy(f, v)) return v;
  const [job, ...rest] = v.queue;
  return requestJob(f, { ...v, queue: rest }, job);
}
export function resumeQueue() { const f = S.format; setV((v) => dequeue(f, { ...v, queuePaused: false })); }
export function send(text) {
  const f = S.format;
  setV((v) => {
    const msgId = uid();
    const job = { kind: 'revise', text, scenes: v.selection.slice(), msgId };
    const queued = busy(f, v) || v.queuePaused;
    const nv = { ...v, messages: [...v.messages, { id: msgId, role: 'user', text, scenes: job.scenes, queued }] };
    return queued ? { ...nv, queue: [...nv.queue, job] } : requestJob(f, nv, job);
  });
}
export function retryUnits(units) {
  const f = S.format;
  setV((v) => {
    const job = { kind: 'retry', units, text: `Retry ${units.map((u) => unitLabel(f, u)).join(', ')}`, scenes: [] };
    return busy(f, v) ? { ...v, queue: [...v.queue, job] } : requestJob(f, v, job);
  });
}
export function reviseScenes(sceneIds) { setV({ selection: sceneIds }); setTimeout(() => document.querySelector('.composer textarea')?.focus(), 0); }
export function approve() { const f = S.format; setV((v) => startRev(f, v, v.approval)); }
export function cancelApproval() { setV((v) => ({ approval: null, messages: [...v.messages, { id: uid(), role: 'system', text: 'Cancelled before it ran. Nothing was spent.' }] })); }
export function stop() {
  const f = S.format;
  setV((v) => {
    if (v.approval) return { approval: null };
    if (v.rev) {
      const n = v.versions.length;
      return { rev: null, queuePaused: v.queue.length > 0, messages: v.messages.map((m) => (m.id === v.rev.id ? { ...m, live: false, text: `Stopped. Nothing changed; still on v${n}.` } : m)) };
    }
    if (genRunning(f, v)) {
      let nv = { ...v, gen: { ...v.gen, stoppedAt: v.gen.clock }, genDone: true };
      nv = { ...nv, messages: [...nv.messages, { id: uid(), role: 'event', kind: 'genStopped' }] };
      return addVersion(nv, `First generation, stopped at ${unitsDoneAt(f, nv)}/${fmtOf(f).units.length} units`);
    }
    return {};
  });
}
function unitsDoneAt(f, v) { return fmtOf(f).units.filter((u) => ['ready', 'reviewing', 'flagged', 'fallback'].includes(genStatus(u, SCHED[f], v.gen).status)).length; }
export function resumeGen() { setV((v) => ({ gen: { ...v.gen, stoppedAt: null }, genDone: false })); }
export function styleChange(key, value, label) { setV((v) => addVersion({ ...v, [key]: value }, label)); }
export function confirmRestyle() {
  const f = S.format;
  setV((v) => ({
    preset: v.restyleConfirm, restyleConfirm: null, overrides: {}, fallbackWhy: {}, gen: { clock: 0, stoppedAt: null }, genDone: false,
    extraCost: costOf(f), messages: [...v.messages, { id: uid(), role: 'system', text: `Restyling to ${v.restyleConfirm}: every Scene regenerates. v${v.versions.length} stays restorable.` }],
  }));
}
export function restore(n) { setV((v) => addVersion(v, `Restored v${n}`)); }
export function fixWord(i, next) {
  const text = next.trim();
  set({ editWord: null });
  if (!text || text === wordText(i)) return;
  set((s) => ({ edits: { ...s.edits, [i]: text } }));
  if (S.screen === 'editor') setV((v) => ({ messages: [...v.messages, { id: uid(), role: 'system', text: `Transcript fix: “${W[i].w}” → “${text}”. Captions update; no agent run.` }] }));
}

// ---------- simulation clock ----------
function tickEditor(dt) {
  const f = S.format, sch = SCHED[f], v0 = S.v[f];
  let v = v0;
  if (genRunning(f, v)) v = { ...v, gen: { ...v.gen, clock: Math.min(sch.total, v.gen.clock + dt) } };
  if (v.exists && !v.genDone && v.gen.clock >= sch.total) {
    v = { ...v, genDone: true, messages: [...v.messages, { id: uid(), role: 'event', kind: 'genDone' }] };
    v = addVersion(v, v.versions.length ? `Restyle: ${v.preset}` : 'First generation');
    v = dequeue(f, v);
  }
  if (v.rev) { const clock = v.rev.clock + dt; v = clock >= v.rev.dur ? finishRev(f, v) : { ...v, rev: { ...v.rev, clock } }; }
  if (v !== v0) setV(v, f);
}
function tickSetup(dt) {
  const su = S.setup, m = su.model, now = Date.now();
  let patch = null;
  if (m.state === 'downloading') {
    const mb = Math.min(MODEL_MB, m.mb + dt * 2.6);
    patch = { model: mb >= MODEL_MB ? { state: 'verifying', mb, until: now + 1500 } : { ...m, mb } };
  } else if (m.state === 'verifying' && now > m.until) patch = { model: { state: 'ready', mb: MODEL_MB } };
  if (su.claude === 'waiting' && now > su.until) { patch = { ...patch, claude: 'connected' }; S = { ...S, auth: 'subscription' }; }
  if (patch) setSetup(patch);
  const tx = S.newp.tx;
  if (tx.state === 'waiting' && S.setup.model.state === 'ready') setNew({ tx: { state: 'running', t: 0 } });
  if (tx.state === 'running') setNew({ tx: tx.t >= DUR ? { state: 'done', t: DUR } : { state: 'running', t: tx.t + 1.1 } });
  if (S.toast && now > S.toast.until) set({ toast: null });
}
export function tick(dt) { tickEditor(dt); tickSetup(dt); }
tick(0);
setInterval(() => { if (S.simPlaying) tick(0.1 * S.speed); }, 100);
