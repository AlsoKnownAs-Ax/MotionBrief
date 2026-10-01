// PROTOTYPE (throwaway): the Project screen for Prototype: Preview UX (MotionBrief #19), in two layouts:
// A (Editor): player, right panel with Chat / Style / Versions, Scene timeline below.
// B (Chat-first): chat column on the left, player and Scene strip on the right.
// The spike's MP4 stands in for <hyperframes-player>; Scene stills sit under it when the video can't play.
import { html, useState, useEffect, useRef, Icon, Btn, IconBtn, Seg, Switch, Progress, Popover, Splitter, WindowControls } from './ui.js';
import {
  S, set, setV, W, DUR, FORMAT_LABEL, TYPE_LABEL, TRANSITION, PALETTES, PRESETS, PLAYABLE, WORKING, SCHED, CHUNKS,
  fmtOf, unitState, sceneState, genPhase, busy, unitsDone, flaggedUnits, sceneAt, wordText, mmss, sceneName, unitLabel, costOf, estimate, elementsOf,
  bindVideo, unbindVideo, seek, togglePlay, setFormat, go, toggleSel, send, retryUnits, reviseScenes, approve, cancelApproval, stop, resumeGen, resumeQueue,
  styleChange, confirmRestyle, restore, fixWord, generateFormat, LAYOUT, setLayout,
} from './store.js';

const paletteFilter = (f) => PALETTES.find((p) => p.id === S.v[f].palette).filter;

// ---------- status ----------
function statusText(st) {
  return {
    waiting: 'Waiting for Storyboard', queued: 'Queued', coding: st.attempt > 1 ? `Writing code · retry ${st.attempt - 1}` : 'Writing code',
    checking: 'Checking', reviewing: 'In review', flagged: 'Review notes', fallback: 'Fallback', stopped: 'Not generated', revising: st.phase ?? 'Revising',
  }[st.status];
}
export function StatusBadge({ st }) {
  if (st.status === 'ready') return null;
  const tone = WORKING.has(st.status) ? 'working' : st.status;
  return html`<span class=${`badge ${tone}`}><span class="dot"></span>${statusText(st)}</span>`;
}

function Thumb({ f, scene, w, h }) {
  const st = sceneState(f, scene);
  const box = { width: `${w}px`, height: `${h}px` };
  if (PLAYABLE.has(st.status)) {
    return html`<div class=${`thumb${st.status === 'revising' ? ' shimmer is-revising' : ''}`} style=${box}><img src=${scene.still} alt="" style=${{ filter: paletteFilter(f) }} /></div>`;
  }
  if (st.status === 'fallback') {
    return html`<div class="thumb fallback" style=${box}><span style=${{ fontSize: `${Math.max(7, w / 11)}px` }}>${elementsOf(scene.content)[0]?.text}</span></div>`;
  }
  return html`<div class=${`thumb empty${WORKING.has(st.status) ? ' shimmer' : ''}`} style=${box}></div>`;
}

// ---------- player ----------
function Placeholder({ scene, st, w, f, t }) {
  const fs = Math.max(9, w / (f === 'horizontal' ? 52 : 26));
  const label = `${sceneName(scene)} · ${TYPE_LABEL[scene.type]}`;
  const status = { waiting: 'waiting for the Storyboard', queued: 'queued, starts when a slot frees', coding: 'writing code', checking: 'checking', stopped: 'not generated (stopped)' }[st.status] ?? st.status;
  if (S.placeholder === 'skeleton') {
    return html`<div class="layer ph-skeleton" style=${{ fontSize: `${fs}px` }}>
      <div class="shimmer" style="height:12%;width:55%;border-radius:8px"></div>
      <div class="row" style="flex:1;gap:5%"><div class="shimmer" style="flex:1;height:100%;border-radius:12px"></div><div class="shimmer" style="flex:1;height:100%;border-radius:12px"></div></div>
      <div class="muted" style="text-align:center">${label} · ${status}</div>
    </div>`;
  }
  if (S.placeholder === 'words') {
    const chunk = CHUNKS.find((c) => t >= W[c[0]].s && t < W[c[c.length - 1]].e + 0.4) ?? [];
    return html`<div class="layer ph-words" style=${{ fontSize: `${fs}px` }}>
      <div class="ph-words-line">${chunk.map((i) => html`<span style=${{ color: t >= W[i].s ? '#fff' : '#444' }}>${wordText(i)} </span>`)}</div>
      <div class="muted">${label} · ${status}</div>
    </div>`;
  }
  const els = elementsOf(scene.content);
  return html`<div class="layer animatic" style=${{ fontSize: `${fs}px` }}>
    <div class="head">${label.toUpperCase()} · ${status.toUpperCase()}</div>
    <div class="intent">${scene.intent}</div>
    <div class="els">${els.map((e) => html`<div class=${`el${t < (W[e.at]?.s ?? 0) ? ' hidden' : ''}`}><span class="k">${e.kind} · on “${wordText(e.at)}”</span>${e.text}</div>`)}</div>
    ${scene.content.lines && html`<pre>${scene.content.lines.join('\n')}</pre>`}
  </div>`;
}

function Player({ f, w, h }) {
  const fmt = fmtOf(f), v = S.v[f], t = S.t;
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    bindVideo(el);
    el.addEventListener('loadedmetadata', () => { el.currentTime = S.t; }, { once: true });
    return () => unbindVideo(el);
  }, []);
  const phase = genPhase(f);
  const scene = phase === 'storyboard' || (phase === 'stopped' && v.gen.stoppedAt < SCHED[f].SB) ? null : sceneAt(fmt, t);
  const st = scene ? sceneState(f, scene) : null;
  const fs = Math.max(9, w / (f === 'horizontal' ? 52 : 26));
  let overlay = null, pill = null;
  if (!scene) {
    overlay = html`<div class="layer ph-storyboard" style=${{ fontSize: `${fs}px` }}>
      <div class="shimmer" style="width:40%;height:.4em;border-radius:1em"></div>
      <div style="font-size:1.4em;font-weight:600;letter-spacing:-0.02em">Writing the Storyboard</div>
      <div class="muted" style="text-align:center;max-width:70%">The Voiceover already plays. Scenes appear here as their code passes checks.</div>
    </div>`;
  } else if (st.status === 'fallback') {
    const els = elementsOf(scene.content);
    overlay = html`<div class="layer fallback-scene" style=${{ fontSize: `${fs}px`, filter: paletteFilter(f) }}>
      <div class="t" style="font-size:2.6em">${els[0]?.text}</div>
      <ul style="font-size:1.3em">${els.slice(1).filter((e) => t >= (W[e.at]?.s ?? 0)).map((e) => html`<li>${e.text}</li>`)}</ul>
    </div>`;
    pill = html`<span class="badge fallback player-pill"><span class="dot"></span>Fallback Scene</span>`;
  } else if (!PLAYABLE.has(st.status)) {
    overlay = html`<${Placeholder} f=${f} scene=${scene} st=${st} w=${w} t=${t} />`;
  } else if (st.status === 'revising') {
    pill = html`<span class="badge working player-pill"><span class="dot"></span>Revising · showing v${v.versions.length} until it’s ready</span>`;
  }
  let captions = null;
  if (v.captions && f === 'horizontal') {
    const chunk = CHUNKS.find((c) => t >= W[c[0]].s && t < W[c[c.length - 1]].e + 0.3);
    if (chunk) captions = html`<div class="captions" style=${{ bottom: '6%', fontSize: `${w / 32}px` }}>${chunk.map((i) => html`<span class=${t >= W[i].s && t < W[i].e + 0.05 ? 'on' : ''}>${wordText(i)} </span>`)}</div>`;
  }
  return html`<div class="player" style=${{ width: `${w}px`, height: `${h}px` }}>
    ${scene && PLAYABLE.has(st.status) && html`<img class="still" src=${scene.still} alt="" style=${{ filter: paletteFilter(f) }} />`}
    <video ref=${ref} src=${fmt.video} preload="auto" playsinline style=${{ filter: paletteFilter(f) }}
      onPlay=${() => set({ playing: true })} onPause=${() => set({ playing: false, t: ref.current.currentTime })} onClick=${togglePlay} />
    ${overlay}${pill}${captions}
  </div>`;
}

function FitPlayer({ f }) {
  const box = useRef();
  const [sz, setSz] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSz({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const r = f === 'horizontal' ? 16 / 9 : 9 / 16;
  let w = sz.w, hh = w / r;
  if (hh > sz.h) { hh = sz.h; w = hh * r; }
  return html`<div ref=${box} class="fit">${w > 0 && html`<${Player} key=${f} f=${f} w=${w} h=${hh} />`}</div>`;
}

function MissingFormat({ f }) {
  const e = estimate();
  return html`<div class="fit"><div class="empty-format">
    <div class=${`format-frame ${f}`}><${Icon} name="Film" size=${22} /></div>
    <h3>No ${FORMAT_LABEL[f]} video yet</h3>
    <p class="muted">Generate one from the same Transcript and Style Preset. Scenes are re-laid-out for ${f === 'vertical' ? 'vertical' : 'horizontal'}; nothing changes in the ${FORMAT_LABEL[f === 'vertical' ? 'horizontal' : 'vertical']} video.</p>
    <p class="muted t-sm">About ${e.min}–${e.max} minutes and $${e.lo.toFixed(2)}–$${e.hi.toFixed(2)} with the default models.</p>
    <${Btn} kind="primary" onClick=${() => generateFormat(f)}>Generate ${FORMAT_LABEL[f]}<//>
  </div></div>`;
}

const segTone = (st) => (WORKING.has(st.status) ? 'working' : st.status);
function dragSeek(toTime) {
  return (e) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => seek(toTime(ev, el));
    move(e);
    el.onpointermove = move;
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
  };
}
function Transport({ f }) {
  const fmt = fmtOf(f);
  const showSegs = genPhase(f) !== 'storyboard';
  const onDown = dragSeek((e, el) => { const r = el.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * DUR; });
  return html`<div class="transport">
    <${IconBtn} icon=${S.playing ? 'Pause' : 'Play'} label=${S.playing ? 'Pause (Space)' : 'Play (Space)'} kind="filled" onClick=${togglePlay} />
    <span class="t-sm num time">${mmss(S.t)}<span class="muted"> / ${mmss(DUR)}</span></span>
    <div class="scrub" onPointerDown=${onDown} role="slider" aria-label="Playhead" aria-valuemin="0" aria-valuemax=${Math.round(DUR)} aria-valuenow=${Math.round(S.t)} tabindex="0">
      ${showSegs ? fmt.scenes.map((s) => html`<div class=${`seg-bar ${segTone(sceneState(f, s))}`} style=${{ left: `${(s.start / DUR) * 100}%`, width: `calc(${((s.end - s.start) / DUR) * 100}% - 2px)` }}></div>`)
        : html`<div class="seg-bar waiting" style="left:0;width:100%"></div>`}
      <div class="scrub-head" style=${{ left: `${(S.t / DUR) * 100}%` }}></div>
    </div>
  </div>`;
}

// ---------- toolbar pieces ----------
function FormatTabs() {
  return html`<${Seg} label="Format" value=${S.format} onChange=${setFormat}
    options=${['horizontal', 'vertical'].map((f) => [f, html`${FORMAT_LABEL[f]}${!S.v[f].exists && html`<span class="seg-plus" aria-label="not generated"><${Icon} name="Plus" size=${12} /></span>`}`])} />`;
}
function ProjectTitle() {
  return html`<div class="row title" style="gap:10px;min-width:0">
    <span class="t-body title-name">${S.projectName}</span>
    <span class="save" title=${`Autosaved to Documents\\MotionBrief\\${S.projectName}\\`}><${Icon} name="Check" size=${13} />Saved</span>
  </div>`;
}
function jobLine(f) {
  const v = S.v[f], phase = genPhase(f), total = fmtOf(f).units.length;
  if (!v.exists) return null;
  if (v.approval) return { label: 'Waiting for your approval', running: true };
  if (v.rev) return { label: v.rev.kind === 'retry' ? 'Retrying' : 'Revising', detail: v.rev.units.map((u) => unitLabel(f, u)).join(', '), progress: v.rev.clock / v.rev.dur, running: true };
  if (phase === 'storyboard') return { label: 'Writing the Storyboard', progress: v.gen.clock / SCHED[f].total, running: true };
  if (phase === 'scenes') return { label: `Generating · ${unitsDone(f)} of ${total} ready`, progress: v.gen.clock / SCHED[f].total, running: true };
  if (phase === 'review') return { label: 'Reviewing Scenes', progress: v.gen.clock / SCHED[f].total, running: true };
  if (phase === 'stopped') return { label: `Stopped at ${unitsDone(f)} of ${total}`, stopped: true };
  return null;
}
function JobStatus({ f }) {
  const job = jobLine(f);
  if (!job) return null;
  if (job.stopped) return html`<div class="job"><span class="t-sm muted">${job.label}</span><${Btn} sm icon="Play" onClick=${resumeGen}>Resume<//></div>`;
  return html`<div class="job" role="status">
    <span class="job-dot"></span>
    <div class="col" style="gap:5px;min-width:0">
      <span class="t-sm job-label" title=${job.detail}>${job.label}${job.detail ? html`<span class="muted"> · ${job.detail}</span>` : ''}</span>
      ${job.progress != null && html`<${Progress} value=${job.progress} tone="working" label="Job progress" />`}
    </div>
    <${Btn} sm icon="Square" onClick=${stop} title="Stop the agent">Stop<//>
  </div>`;
}
function UsageMeter({ f }) {
  const [open, setOpen] = useState(false);
  const cost = costOf(f);
  const sub = S.auth === 'subscription';
  const pct = Math.min(99, 18 + cost * 4);
  return html`<div class="usage-wrap">
    <button class="usage" onClick=${() => setOpen(!open)} aria-expanded=${open} aria-label="Usage details">
      ${sub ? html`<span class="t-xs muted">5-hour window</span><${Progress} value=${pct / 100} tone=${pct > 80 ? 'warn' : ''} width=${56} label="5-hour window used" /><span class="t-sm num">${Math.round(pct)}%</span>`
        : html`<span class="t-sm num">$${cost.toFixed(2)}</span><span class="t-xs muted num">of $15.00 cap</span>`}
      <${Icon} name="ChevronDown" size=${14} class="muted" />
    </button>
    ${open && html`<${Popover} onClose=${() => setOpen(false)} cls="usage-pop" style="right:0;top:calc(100% + 8px);width:300px">
      ${sub ? html`
        <div class="pop-title">Claude subscription</div>
        <div class="kv"><span class="muted">5-hour window</span><span class="num">${Math.round(pct)}% used · resets 17:40</span></div>
        <div class="kv"><span class="muted">Weekly limit</span><span class="num">12% used</span></div>
        <p class="t-xs muted" style="margin:10px 0 0">Plan limits only. Anthropic doesn’t report dollar costs for subscription logins.</p>`
        : html`
        <div class="pop-title">Anthropic API key</div>
        <div class="kv"><span class="muted">This Project</span><span class="num">$${cost.toFixed(2)}</span></div>
        <div class="kv"><span class="muted">Spending cap</span><span class="num">$15.00 per Project</span></div>
        <div class="kv"><span class="muted">Approval</span><span>Before every agent run</span></div>`}
      <hr />
      <div class="kv"><span class="muted">Storyboard, Scene code</span><span>Opus 5.5</span></div>
      <div class="kv"><span class="muted">Revision</span><span>Opus 5.5</span></div>
      <div class="kv"><span class="muted">Review</span><span>Sonnet 5.5</span></div>
      <button class="link t-xs" onClick=${() => setOpen(false)}>Change models in Settings</button>
    <//>`}
  </div>`;
}
function ExportButton({ f }) {
  const v = S.v[f];
  const ok = v.exists && ['done', 'stopped'].includes(genPhase(f)) && !v.rev;
  return html`<${Btn} kind="primary" icon="Download" disabled=${!ok} title=${ok ? `Export the ${FORMAT_LABEL[f]} video as MP4` : 'Available when the current job finishes'}
    onClick=${() => alert('Export is out of scope for this prototype.')}>Export MP4<//>`;
}
function RetryAllFlagged({ f }) {
  const fl = flaggedUnits(f);
  if (!fl.length) return null;
  return html`<${Btn} sm icon="RotateCcw" onClick=${() => retryUnits(fl.map((u) => u.id))}>Retry all flagged (${fl.length})<//>`;
}
function Notice({ f }) {
  const n = S.notice;
  if (!n) return null;
  const left = n.units.filter((u) => unitState(f, u).status === 'fallback');
  return html`<div class="notice" role="status">
    <${Icon} name="TriangleAlert" size=${16} class="amber" />
    <div class="grow t-sm"><span>This version of MotionBrief updated the Scene frame.</span> <span class="muted">${left.length
      ? `${left.length} Scene${left.length > 1 ? 's' : ''} no longer pass its checks, so ${left.length > 1 ? 'they play' : 'it plays'} as fallbacks until you retry.`
      : 'All affected Scenes pass again.'}</span></div>
    ${left.length > 0 && html`<${Btn} sm icon="RotateCcw" onClick=${() => retryUnits(left)}>Retry ${left.length} Scene${left.length > 1 ? 's' : ''}<//>`}
    <${IconBtn} icon="X" sm label="Dismiss" onClick=${() => set({ notice: null })} />
  </div>`;
}

// ---------- chat ----------
function FlagCard({ f, unitId, compact }) {
  const u = fmtOf(f).unitsById[unitId];
  const st = unitState(f, u.id);
  const fallback = st.status === 'fallback';
  const [all, setAll] = useState(false);
  const notes = compact && !all ? u.notes.slice(0, 1) : u.notes;
  const why = S.v[f].fallbackWhy[u.id] === 'frame'
    ? 'Its code doesn’t pass the updated Scene frame’s checks, so a plain fallback Scene plays here.'
    : 'Its code failed checks 3 times, so a plain fallback Scene plays here.';
  return html`<div class=${`note ${fallback ? 'fallback' : 'flagged'}`}>
    <div class="row" style="gap:8px"><span class="t-sm" style="font-weight:500">${unitLabel(f, u.id)}</span><${StatusBadge} st=${st} /></div>
    ${fallback ? html`<p class="t-sm note-text">${why}</p>`
      : html`<ul class="t-sm note-text">${notes.map((n) => html`<li>${n}</li>`)}</ul>
        ${compact && u.notes.length > 1 && html`<button class="link t-xs" onClick=${() => setAll(!all)}>${all ? 'Show less' : `Show all ${u.notes.length} notes`}</button>`}`}
    <div class="row" style="gap:6px"><${Btn} sm icon="RotateCcw" onClick=${() => retryUnits([u.id])}>Retry<//><${Btn} sm kind="ghost" icon="MessageSquare" onClick=${() => reviseScenes(u.scenes)}>Revise…<//></div>
  </div>`;
}
function ApprovalCard() {
  const a = S.v[S.format].approval;
  if (!a) return null;
  return html`<div class="note approval" role="alert">
    <div class="t-sm" style="font-weight:500">Approve this agent run?</div>
    <p class="t-sm note-text">${a.kind === 'retry' ? 'Retry' : 'Revision'} regenerates ${a.units.map((u) => unitLabel(S.format, u)).join(', ')}. Estimated $${a.est[0].toFixed(2)}–$${a.est[1].toFixed(2)}; $${costOf(S.format).toFixed(2)} of this Project’s $15.00 cap is used.</p>
    <div class="row" style="gap:6px"><${Btn} sm kind="primary" onClick=${approve} data-autofocus>Approve<//><${Btn} sm kind="ghost" onClick=${cancelApproval}>Cancel<//></div>
  </div>`;
}
function QueueBar({ f }) {
  const v = S.v[f];
  if (!v.queue.length) return null;
  return html`<div class="queue-bar">
    <${Icon} name="Clock" size=${14} />
    <span class="t-sm grow">${v.queue.length} queued${v.queuePaused ? html`<span class="muted"> · paused</span>` : ''}</span>
    ${v.queuePaused && html`<${Btn} sm icon="Play" onClick=${resumeQueue}>Resume queue<//>`}
  </div>`;
}
function ScopeChips({ f }) {
  const v = S.v[f];
  if (!v.selection.length) return html`<div class="scope"><span class="chip neutral">Whole video</span><span class="t-xs muted">Select Scenes to narrow the request</span></div>`;
  return html`<div class="scope">${v.selection.map((id) => html`<span class="chip">${sceneName(fmtOf(f).scenesById[id])}
    <button aria-label=${`Remove ${sceneName(fmtOf(f).scenesById[id])} from the request`} onClick=${() => toggleSel(id, true)}><${Icon} name="X" size=${12} /></button></span>`)}</div>`;
}
function Composer({ f, placeholder = 'Describe a change…' }) {
  const [text, setText] = useState('');
  const v = S.v[f];
  const go2 = () => { if (!text.trim()) return; send(text.trim()); setText(''); };
  const hint = v.queuePaused ? 'Queues behind the paused messages' : busy(f) ? 'Queues behind the current job' : 'Enter to send · Shift+Enter for a new line';
  return html`<div class="composer">
    <${ScopeChips} f=${f} />
    <textarea rows="2" value=${text} placeholder=${placeholder} aria-label="Revision request"
      onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go2(); } }} />
    <div class="row" style="gap:8px">
      <span class="t-xs muted grow">${hint}</span>
      <${IconBtn} icon="ArrowUp" kind="primary" label="Send (Enter)" disabled=${!text.trim()} onClick=${go2} />
    </div>
  </div>`;
}
function Msg({ m, f }) {
  if (m.role === 'event') {
    const fl = flaggedUnits(f).length;
    return html`<div class="msg-event">${m.kind === 'genDone' ? `Generation finished${fl ? ` · ${fl} need a look` : ' · all Scenes passed review'}` : 'Generation stopped · finished Scenes kept'}</div>`;
  }
  if (m.role === 'system' && m.kind === 'version') {
    const [n, ...rest] = m.text.split(' · ');
    return html`<div class="msg-event"><span class="vtag num">${n}</span>${rest.join(' · ')}</div>`;
  }
  if (m.role === 'system') return html`<div class="msg-note t-xs muted">${m.text}</div>`;
  if (m.role === 'user') {
    return html`<div class="msg-user">
      ${m.scenes?.length > 0 && html`<div class="row" style="gap:4px;flex-wrap:wrap;margin-bottom:6px">${m.scenes.map((id) => html`<span class="chip">${sceneName(fmtOf(f).scenesById[id])}</span>`)}</div>`}
      ${m.text}${m.queued && html`<div class="t-xs muted" style="margin-top:6px;display:flex;gap:5px;align-items:center"><${Icon} name="Clock" size=${12} />Queued</div>`}
    </div>`;
  }
  return html`<div class="msg-agent">
    <span class=${`agent-dot${m.live ? ' live' : ''}`}></span>
    <div class="col" style="gap:2px"><span class="t-xs muted">${m.live ? 'Agent · working' : 'Agent'}</span><span>${m.text}</span></div>
  </div>`;
}
function GenFeed({ f }) {
  const v = S.v[f], fmt = fmtOf(f), sch = SCHED[f], phase = genPhase(f);
  const [open, setOpen] = useState(false);
  const c = v.gen.stoppedAt ?? v.gen.clock;
  return html`<div class="col" style="gap:10px">
    <div class="msg-event">Transcript ready · ${W.length} words · English · ${mmss(DUR)}</div>
    <div class="feed">
      ${c < sch.SB ? html`<div class="row" style="gap:8px"><span class="job-dot"></span><span class="t-sm">Writing the Storyboard</span></div>`
        : html`<div class="row"><span class="t-sm grow" style="font-weight:500">Storyboard · ${fmt.scenes.length} Scenes</span>
            <button class="link t-xs" onClick=${() => setOpen(!open)}>${open ? 'Hide' : 'Show'}</button></div>
          ${open && html`<div class="col" style="gap:2px;margin-top:6px">${fmt.scenes.map((s) => html`<button class="feed-row" onClick=${() => seek(s.start)}>
            <span class="muted num" style="width:18px">${s.n}</span><span style="width:86px">${TYPE_LABEL[s.type]}</span><span class="muted grow ellipsis">${elementsOf(s.content)[0]?.text}</span></button>`)}</div>`}`}
      ${c >= sch.SB && (phase === 'scenes' || phase === 'review') && html`<div class="col" style="gap:6px;margin-top:10px">
        ${fmt.units.map((u) => { const st = unitState(f, u.id); return html`<div class="row t-xs" style="gap:8px"><span class="grow ellipsis">${unitLabel(f, u.id)}</span>
          ${st.status === 'ready' ? html`<${Icon} name="Check" size=${14} class="muted" />` : html`<${StatusBadge} st=${st} />`}</div>`; })}
      </div>`}
    </div>
  </div>`;
}
function Thread({ f, feed }) {
  const v = S.v[f];
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = 1e9; }, [v.messages.length, genPhase(f)]);
  return html`<div ref=${ref} class="thread scroll">
    ${feed && html`<${GenFeed} f=${f} />`}
    ${!feed && !v.messages.length && html`<div class="empty-chat">
      <p class="t-sm">Ask for a change in plain words.</p>
      <p class="t-xs muted">Select Scenes in the timeline first to scope the request; otherwise the agent picks the Scenes to change.</p>
    </div>`}
    ${v.messages.map((m) => {
      if (feed && m.role === 'event') {
        const fl = flaggedUnits(f);
        return html`<div class="col" style="gap:8px"><${Msg} m=${m} f=${f} />
          ${fl.map((u) => html`<${FlagCard} f=${f} unitId=${u.id} compact />`)}
          ${fl.length > 1 && html`<div><${RetryAllFlagged} f=${f} /></div>`}
        </div>`;
      }
      return html`<${Msg} m=${m} f=${f} />`;
    })}
  </div>`;
}

// ---------- Style and Versions ----------
export function PresetArt({ id }) {
  const art = {
    Blueprint: html`<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#0b1730" />
      <path d="M0 15h160M0 30h160M0 45h160M0 60h160M0 75h160M20 0v90M40 0v90M60 0v90M80 0v90M100 0v90M120 0v90M140 0v90" stroke="#1b2f55" stroke-width=".6" />
      <rect x="20" y="32" width="40" height="26" rx="3" fill="#0b1730" stroke="#dce8ff" stroke-width="1.4" /><rect x="100" y="32" width="40" height="26" rx="3" fill="#0b1730" stroke="#dce8ff" stroke-width="1.4" />
      <path d="M61 45h34M90 41l5 4-5 4" fill="none" stroke="#ff7a3d" stroke-width="1.6" /></svg>`,
    Whiteboard: html`<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#f6f5f0" />
      <ellipse cx="48" cy="44" rx="24" ry="17" fill="none" stroke="#1f2a44" stroke-width="2.2" stroke-linecap="round" />
      <path d="M74 44c10-1 18 0 26 0M94 39l7 5-7 5" fill="none" stroke="#1f2a44" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <rect x="104" y="30" width="36" height="28" rx="4" fill="none" stroke="#2f6fe0" stroke-width="2.2" /><path d="M110 70h28" stroke="#e5484d" stroke-width="2.6" stroke-linecap="round" /></svg>`,
    Sketchbook: html`<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#efe5cf" />
      <path d="M22 30c14-2 28 1 40-1M21 31c1 9-1 18 1 28M23 59c12 1 26-1 39 0M61 29c1 10 0 20 1 31" fill="none" stroke="#3b2f24" stroke-width="1.5" stroke-linecap="round" />
      <path d="M28 52l10-14M34 56l14-20M44 56l12-18" stroke="#c0763a" stroke-width="1" />
      <path d="M70 45c12-2 22 1 34-1M98 40l7 4-7 5" fill="none" stroke="#3b2f24" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="126" cy="44" r="15" fill="none" stroke="#3b2f24" stroke-width="1.5" /></svg>`,
    Terminal: html`<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#050805" />
      <g font-family="ui-monospace, Consolas, monospace" font-size="9" fill="#46e07a"><text x="12" y="24">$ curl -I cdn.example</text><text x="12" y="40" fill="#9be8b3">HTTP/2 200</text><text x="12" y="54" fill="#9be8b3">x-cache: HIT</text></g>
      <rect x="12" y="62" width="6" height="10" fill="#46e07a" /></svg>`,
  }[id];
  return html`<div class="preset-art">${art}</div>`;
}
function StylePanel({ f }) {
  const v = S.v[f];
  const field = (key, opts, label) => html`<label class="field"><span class="lbl">${label}</span>
    <select class="select" value=${v[key]} onChange=${(e) => styleChange(key, e.target.value, `${label}: ${e.target.value}`)}>${opts.map((o) => html`<option>${o}</option>`)}</select></label>`;
  return html`<div class="col" style="gap:22px">
    <section class="col" style="gap:10px">
      <div><h3 class="sec-title">Style Preset</h3><p class="t-xs muted sec-help">Changing it regenerates every Scene with the agent.</p></div>
      <div class="preset-list" role="radiogroup" aria-label="Style Preset">
        ${PRESETS.map((p) => html`<button role="radio" aria-checked=${v.preset === p.id} class=${`preset-row${v.preset === p.id ? ' on' : ''}`}
          onClick=${() => v.preset !== p.id && setV({ restyleConfirm: p.id })}>
          <${PresetArt} id=${p.id} /><span class="col grow" style="gap:2px;text-align:left"><span class="t-sm">${p.id}</span><span class="t-xs muted">${p.blurb}</span></span>
          ${v.preset === p.id && html`<${Icon} name="Check" size=${16} />`}
        </button>`)}
      </div>
      ${v.restyleConfirm && html`<div class="note approval">
        <div class="t-sm" style="font-weight:500">Restyle to ${v.restyleConfirm}?</div>
        <p class="t-sm note-text">Every Scene regenerates: about 10 minutes and $4–6 (or about 25% of your 5-hour window). v${v.versions.length} stays restorable.</p>
        <div class="row" style="gap:6px"><${Btn} sm kind="primary" onClick=${confirmRestyle}>Restyle<//><${Btn} sm kind="ghost" onClick=${() => setV({ restyleConfirm: null })}>Cancel<//></div>
      </div>`}
    </section>
    <section class="col" style="gap:12px">
      <div><h3 class="sec-title">Instant changes</h3><p class="t-xs muted sec-help">No agent run and no cost. Each change saves a Version.</p></div>
      <div class="field"><span class="lbl">Palette</span>
        <div class="palette-grid" role="radiogroup" aria-label="Palette">${PALETTES.map((p) => html`<button role="radio" aria-checked=${v.palette === p.id} class=${`palette${v.palette === p.id ? ' on' : ''}`}
          onClick=${() => v.palette !== p.id && styleChange('palette', p.id, `Palette: ${p.name}`)}>
          <span class="sw">${p.sw.map((c) => html`<span style=${{ background: c }}></span>`)}</span><span class="t-sm">${p.name}</span></button>`)}</div>
      </div>
      ${field('typography', ['Inter Display', 'Space Grotesk', 'IBM Plex Sans', 'JetBrains Mono'], 'Typography')}
      ${field('captionStyle', ['Bold pop', 'Clean lower', 'Boxed'], 'Caption style')}
      <div class="row switch-row"><span class="col grow" style="gap:2px"><span class="t-sm">Captions</span>
        ${f === 'vertical' && html`<span class="t-xs muted">Prototype: the spike’s 9:16 video has them burned in.</span>`}</span>
        <${Switch} checked=${v.captions} label="Captions" onChange=${(on) => styleChange('captions', on, on ? 'Captions on' : 'Captions off')} />
      </div>
    </section>
  </div>`;
}
function VersionsList({ f }) {
  const v = S.v[f];
  if (!v.versions.length) return html`<div class="empty-chat"><p class="t-sm">No Versions yet.</p><p class="t-xs muted">v1 is saved when the first generation finishes or stops.</p></div>`;
  return html`<div class="col" style="gap:10px">
    <p class="t-xs muted" style="margin:0">Restoring saves a new Version, so nothing is lost.</p>
    <div class="col" style="gap:2px">${[...v.versions].reverse().map((x, i) => html`<div class=${`version${i === 0 ? ' current' : ''}`}>
      <span class="vtag num">v${x.n}</span><span class="grow t-sm ellipsis" title=${x.label}>${x.label}</span><span class="t-xs muted num">${x.time}</span>
      ${i === 0 ? html`<span class="t-xs muted">Current</span>` : html`<${Btn} sm kind="ghost" icon="History" onClick=${() => restore(x.n)} disabled=${busy(f)}>Restore<//>`}
    </div>`)}</div>
  </div>`;
}

// ---------- Variant A: Editor ----------
export function WordEdit({ i, style }) {
  const ref = useRef();
  useEffect(() => { ref.current.focus(); ref.current.select(); }, []);
  return html`<input ref=${ref} class="word-edit" style=${style} value=${wordText(i)} aria-label="Fix this Transcript word"
    onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.stopPropagation(); set({ editWord: null }); } }}
    onBlur=${(e) => { if (S.editWord === i) fixWord(i, e.target.value); }} />`;
}
function Timeline({ f, height: paneH }) {
  const fmt = fmtOf(f), v = S.v[f];
  const [px, setPx] = useState(96);
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el || !S.playing) return;
    const x = S.t * px;
    if (x < el.scrollLeft + 60 || x > el.scrollLeft + el.clientWidth - 160) el.scrollLeft = x - 100;
  });
  // Scene cards take whatever height the pane leaves after the header, ruler, Canvas row and word lane.
  const cardH = Math.max(40, paneH - 44 - 12 - 84);
  const thumbH = Math.min(cardH - 12, f === 'horizontal' ? 150 : 180);
  const thumbW = f === 'horizontal' ? thumbH * 16 / 9 : thumbH * 9 / 16;
  const sbDone = v.exists && genPhase(f) !== 'storyboard';
  const canvases = [...new Set(fmt.scenes.filter((s) => s.canvas).map((s) => s.canvas))].map((c) => fmt.scenes.filter((s) => s.canvas === c));
  const RULER = 22, top = RULER + 18, wordsTop = top + cardH + 10, height = wordsTop + 34;
  const ticks = [];
  for (let s = 0; s <= DUR; s += 1) ticks.push(s);
  const onRuler = dragSeek((e, el) => (e.clientX - el.getBoundingClientRect().left) / px);
  const fit = () => setPx(Math.max(20, (ref.current.clientWidth - 24) / DUR));
  const selN = v.selection.length;
  return html`<div class="tl" style=${{ height: `${paneH}px` }}>
    <div class="tl-head">
      <span class="t-sm"><span style="font-weight:500">${sbDone ? `${fmt.scenes.length} Scenes` : 'Storyboard in progress'}</span><span class="muted num"> · ${mmss(DUR)}</span></span>
      <span class="t-xs muted ellipsis">${selN ? `${selN} Scene${selN > 1 ? 's' : ''} selected for the chat · Esc to clear` : 'Click a Scene to scope the chat to it · Shift+click to add more · Double-click a word to fix it'}</span>
      <span class="spacer"></span>
      <${RetryAllFlagged} f=${f} />
      <div class="zoom">
        <${IconBtn} sm icon="ZoomOut" label="Zoom out" onClick=${() => setPx(Math.max(20, px / 1.4))} />
        <input type="range" min="20" max="240" value=${px} aria-label="Timeline zoom" onInput=${(e) => setPx(Number(e.target.value))} />
        <${IconBtn} sm icon="ZoomIn" label="Zoom in" onClick=${() => setPx(Math.min(240, px * 1.4))} />
        <${Btn} sm kind="ghost" onClick=${fit}>Fit<//>
      </div>
    </div>
    <div ref=${ref} class="tl-scroll scroll">
      <div class="tl-inner" style=${{ width: `${DUR * px + 24}px`, height: `${height}px` }}>
        <div class="ruler" style=${{ height: `${RULER}px` }} onPointerDown=${onRuler}>
          ${ticks.map((s) => { const major = s % 5 === 0; if (!major && px < 40) return null; return html`<span class=${`tick${major ? ' major' : ''}`} style=${{ left: `${s * px}px` }}>${major && html`<span class="num">${mmss(s)}</span>`}</span>`; })}
        </div>
        ${sbDone && canvases.map((g) => html`<div class="canvas-bracket" style=${{ left: `${g[0].start * px}px`, width: `${(g[g.length - 1].end - g[0].start) * px - 3}px`, top: `${RULER + 2}px` }}>
          <span>${g.length > 1 ? `Canvas · camera moves across Scenes ${g[0].n}–${g[g.length - 1].n}` : `Canvas · camera moves within Scene ${g[0].n}`}</span></div>`)}
        ${!sbDone && html`<div class="shimmer tl-pending" style=${{ top: `${top}px`, width: `${DUR * px}px`, height: `${cardH}px` }}>
          <span class="t-sm muted">${v.exists ? 'Writing the Storyboard: Scenes appear here' : `No ${FORMAT_LABEL[f]} video yet`}</span></div>`}
        ${sbDone && fmt.scenes.map((s, i) => {
          const st = sceneState(f, s);
          const wpx = (s.end - s.start) * px - 3;
          const selected = v.selection.includes(s.id);
          const roomy = wpx > thumbW + 84;
          const tw = Math.min(thumbW, wpx - 12);
          const [ticon, tname] = TRANSITION[s.transitionIn] ?? ['Blend', s.transitionIn];
          return html`
            <button class=${`scene${selected ? ' sel' : ''}`} aria-pressed=${selected} title=${`${sceneName(s)} · ${TYPE_LABEL[s.type]}\n${s.intent}`}
              onClick=${(e) => { toggleSel(s.id, e.shiftKey || e.ctrlKey || e.metaKey); seek(s.start); }}
              style=${{ left: `${s.start * px}px`, width: `${wpx}px`, top: `${top}px`, height: `${cardH}px` }}>
              ${tw > 8 && html`<${Thumb} f=${f} scene=${s} w=${tw} h=${tw === thumbW ? thumbH : tw / (thumbW / thumbH)} />`}
              ${roomy && html`<span class="scene-meta">
                <span class="t-xs scene-name"><span class="num muted">${s.n}</span> ${TYPE_LABEL[s.type]}</span>
                <${StatusBadge} st=${st} />
              </span>`}
            </button>
            ${i > 0 && px >= 40 && html`<span class="tmark" title=${`${tname} into ${sceneName(s)}`} style=${{ left: `${s.start * px - 1.5}px`, top: `${top + cardH / 2}px` }}><${Icon} name=${ticon} size=${10} /></span>`}`;
        })}
        ${CHUNKS.map((c, k) => {
          const start = W[c[0]].s, next = CHUNKS[k + 1] ? W[CHUNKS[k + 1][0]].s : DUR;
          return html`<div class=${`phrase${c.includes(S.editWord) ? ' editing' : ''}`} style=${{ left: `${start * px}px`, top: `${wordsTop}px`, width: `${(next - start) * px - 4}px` }}>
            ${c.map((i) => {
              if (S.editWord === i && S.screen === 'editor') return html`<${WordEdit} i=${i} style=${{ position: 'static' }} />`;
              const now = S.t >= W[i].s && S.t < W[i].e + 0.05;
              return html`<span class=${`word${now ? ' now' : ''}${S.edits[i] ? ' fixed' : ''}`} onClick=${() => seek(W[i].s)} onDblClick=${() => set({ editWord: i })}>${wordText(i)}</span>`;
            })}
          </div>`;
        })}
        <div class="playhead" style=${{ left: `${S.t * px}px` }}></div>
      </div>
    </div>
  </div>`;
}

export function VariantA() {
  const f = S.format, v = S.v[f];
  const [tab, setTab] = useState('Chat');
  const selFlags = [...new Set(v.selection.map((id) => fmtOf(f).scenesById[id].unit))].filter((u) => ['flagged', 'fallback'].includes(unitState(f, u).status));
  return html`<div class="screen">
    <header class="toolbar">
      <${IconBtn} icon="House" label="Home" onClick=${() => go('home')} />
      <${ProjectTitle} />
      <${FormatTabs} />
      <span class="spacer"></span>
      <${JobStatus} f=${f} />
      <${UsageMeter} f=${f} />
      <${ExportButton} f=${f} />
      <${WindowControls} />
    </header>
    <${Notice} f=${f} />
    <div class="row grow" style="align-items:stretch;min-height:0">
      <main class="stage col grow">${v.exists ? html`<${FitPlayer} f=${f} /><${Transport} f=${f} />` : html`<${MissingFormat} f=${f} />`}</main>
      <${Splitter} dir="x" invert label="Resize the side panel" value=${S.layout.panelW} min=${300} max=${Math.round(innerWidth * 0.45)}
        onChange=${(panelW) => setLayout({ panelW })} onReset=${() => setLayout({ panelW: LAYOUT.panelW })} />
      <aside class="panel col" style=${{ width: `${S.layout.panelW}px` }}>
        <${Seg} full label="Panel" value=${tab} onChange=${setTab} options=${[['Chat', 'Chat'], ['Style', 'Style'], ['Versions', html`Versions${v.versions.length ? html`<span class="muted num"> ${v.versions.length}</span>` : ''}`]]} />
        ${tab === 'Chat' && html`
          ${selFlags.map((u) => html`<${FlagCard} f=${f} unitId=${u} compact />`)}
          <${Thread} f=${f} />
          <div class="col" style="gap:8px"><${QueueBar} f=${f} /><${ApprovalCard} /><${Composer} f=${f} /></div>`}
        ${tab === 'Style' && html`<div class="scroll grow panel-body"><${StylePanel} f=${f} /></div>`}
        ${tab === 'Versions' && html`<div class="scroll grow panel-body"><${VersionsList} f=${f} /></div>`}
      </aside>
    </div>
    <${Splitter} dir="y" invert label="Resize the timeline" value=${S.layout.tlH} min=${150} max=${Math.round(innerHeight * 0.6)}
      onChange=${(tlH) => setLayout({ tlH })} onReset=${() => setLayout({ tlH: LAYOUT.tlH })} />
    <${Timeline} f=${f} height=${S.layout.tlH} />
  </div>`;
}

// ---------- Variant B: Chat-first ----------
function ScenePills({ f }) {
  const fmt = fmtOf(f), v = S.v[f];
  if (!v.exists) return null;
  if (genPhase(f) === 'storyboard') return html`<div class="shimmer" style="height:32px;border-radius:32px"></div>`;
  const cur = sceneAt(fmt, S.t);
  return html`<div class="pills" role="group" aria-label="Scenes">
    ${fmt.scenes.map((s, i) => {
      const st = sceneState(f, s);
      const linked = s.canvas && fmt.scenes[i + 1]?.canvas === s.canvas;
      return html`<span class="row" style="gap:0">
        <button class=${`scene-pill ${segTone(st)}${cur.id === s.id ? ' cur' : ''}${v.selection.includes(s.id) ? ' sel' : ''}`} aria-pressed=${v.selection.includes(s.id)}
          title=${`${sceneName(s)} · ${TYPE_LABEL[s.type]}${st.status !== 'ready' ? ` · ${statusText(st)}` : ''}`}
          onClick=${(e) => { toggleSel(s.id, e.shiftKey || e.ctrlKey || e.metaKey); seek(s.start); }}><span class="num">${s.n}</span></button>
        ${linked && html`<span class="pill-link" title="Same Canvas"></span>`}
      </span>`;
    })}
  </div>`;
}
function CurrentLine({ f }) {
  const fmt = fmtOf(f);
  if (!S.v[f].exists || genPhase(f) === 'storyboard') return html`<div class="current"></div>`;
  const s = sceneAt(fmt, S.t);
  const words = [];
  for (let k = s.from; k <= s.to; k++) words.push(k);
  return html`<div class="current">
    <div class="t-xs muted"><span style="color:var(--ink)">${sceneName(s)} · ${TYPE_LABEL[s.type]}</span> · ${s.intent}</div>
    <p class="current-words">${words.map((k) => (S.editWord === k
      ? html`<${WordEdit} i=${k} style=${{ position: 'static' }} /> `
      : html`<span class=${`${S.t >= W[k].s && S.t < W[k].e + 0.05 ? 'now' : ''}${S.edits[k] ? ' fixed' : ''}`} onClick=${() => seek(W[k].s)} onDblClick=${() => set({ editWord: k })}>${wordText(k)}</span> `))}</p>
  </div>`;
}
export function VariantB() {
  const f = S.format, v = S.v[f];
  const [pop, setPop] = useState(null);
  return html`<div class="screen" style="flex-direction:row">
    <section class="b-left col" style=${{ width: `${S.layout.chatW}px` }}>
      <header class="toolbar"><${IconBtn} icon="House" label="Home" onClick=${() => go('home')} /><${ProjectTitle} /></header>
      <div class="b-usage"><${JobStatus} f=${f} /><span class="spacer"></span><${UsageMeter} f=${f} /></div>
      <${Thread} f=${f} feed />
      <div class="col b-compose"><${QueueBar} f=${f} /><${ApprovalCard} /><${Composer} f=${f} placeholder="Ask for a change…" /></div>
    </section>
    <${Splitter} dir="x" label="Resize the chat" value=${S.layout.chatW} min=${340} max=${Math.round(innerWidth * 0.5)}
      onChange=${(chatW) => setLayout({ chatW })} onReset=${() => setLayout({ chatW: LAYOUT.chatW })} />
    <section class="col grow" style="min-width:0">
      <header class="toolbar">
        <${FormatTabs} /><span class="spacer"></span>
        <div class="pop-anchor">
          <${Btn} icon="Palette" kind=${pop === 'style' ? 'lift' : 'tertiary'} onClick=${() => setPop(pop === 'style' ? null : 'style')} aria-expanded=${pop === 'style'}>Style<//>
          ${pop === 'style' && html`<${Popover} onClose=${() => setPop(null)} cls="panel-pop scroll" style="right:0;top:calc(100% + 8px)"><${StylePanel} f=${f} /><//>`}
        </div>
        <div class="pop-anchor">
          <${Btn} icon="History" kind=${pop === 'versions' ? 'lift' : 'tertiary'} onClick=${() => setPop(pop === 'versions' ? null : 'versions')} aria-expanded=${pop === 'versions'}>v${v.versions.length || '–'}<//>
          ${pop === 'versions' && html`<${Popover} onClose=${() => setPop(null)} cls="panel-pop scroll" style="right:0;top:calc(100% + 8px)"><${VersionsList} f=${f} /><//>`}
        </div>
        <${ExportButton} f=${f} />
        <${WindowControls} />
      </header>
      <${Notice} f=${f} />
      <main class="stage col grow">
        ${v.exists ? html`<${FitPlayer} f=${f} /><${Transport} f=${f} />` : html`<${MissingFormat} f=${f} />`}
        <div class="row" style="gap:12px;align-items:flex-start"><div class="grow"><${ScenePills} f=${f} /></div><${RetryAllFlagged} f=${f} /></div>
        <${CurrentLine} f=${f} />
      </main>
    </section>
  </div>`;
}
