// PROTOTYPE (throwaway): the screens around the Project for Prototype: Preview UX (MotionBrief #19):
// first-run setup, Home (checklist + recent Projects), New Project, and the prompts shown when opening a Project.
import { html, useState, useRef, Icon, Btn, IconBtn, Seg, Progress, Menu, Dialog, WindowControls, Mark } from './ui.js';
import {
  S, set, W, DUR, MODEL_MB, FORMAT_LABEL, PRESETS, wordText, mmss, estimate,
  go, toast, openProject, renameProject, duplicateProject, deleteProject,
  setSetup, signIn, connectKey, disconnect, toggleDownload, importModel, setNew, startNewProject, chooseVoiceover, generate,
} from './store.js';
import { PresetArt, WordEdit } from './project.js';

function AppBar({ children, right }) {
  return html`<header class="toolbar">${children}<span class="spacer"></span>${right}<${WindowControls} /></header>`;
}
function Brand() {
  return html`<span class="row" style="gap:9px;padding-left:4px"><${Mark} /><span class="t-sm" style="font-weight:600;letter-spacing:-0.2px">MotionBrief</span></span>`;
}
const claudeReady = () => S.setup.claude === 'connected';
const modelReady = () => S.setup.model.state === 'ready';

// ---------- first-run setup ----------
function StepMark({ n, done }) {
  return html`<span class=${`step-mark${done ? ' done' : ''}`}>${done ? html`<${Icon} name="Check" size=${15} />` : n}</span>`;
}
function ConnectClaude() {
  const su = S.setup;
  const [key, setKey] = useState('');
  if (su.claude === 'connected') {
    return html`<div class="connected">
      <${Icon} name="CircleCheck" size=${18} class="ok" />
      <span class="t-sm grow">${S.auth === 'apikey' ? 'Connected with an Anthropic API key' : 'Connected with your Claude subscription'}</span>
      <${Btn} sm kind="ghost" onClick=${disconnect}>Disconnect<//>
    </div>`;
  }
  return html`<div class="col" style="gap:10px">
    <div class="option">
      <div class="col grow" style="gap:4px">
        <h3 class="t-body" style="font-weight:500">Claude subscription</h3>
        <p class="t-sm muted">Use your Pro or Max plan. Generation counts against its usage limits.</p>
      </div>
      ${su.claude === 'waiting'
        ? html`<div class="row" style="gap:10px"><span class="t-sm muted row" style="gap:6px"><${Icon} name="LoaderCircle" size=${15} class="spin" />Finish signing in in your browser</span><${Btn} sm kind="ghost" onClick=${disconnect}>Cancel<//></div>`
        : html`<${Btn} kind="primary" icon="ExternalLink" onClick=${signIn}>Sign in with Claude<//>`}
      <p class="caveat t-xs"><${Icon} name="Info" size=${14} />Anthropic hasn’t confirmed that third-party apps may use subscription logins. An API key is the supported path.</p>
    </div>
    <div class="option">
      <div class="col grow" style="gap:4px">
        <h3 class="t-body" style="font-weight:500">Anthropic API key</h3>
        <p class="t-sm muted">Pay per use. Adds a spending cap and an approval before each agent run.</p>
      </div>
      <form class="row" style="gap:8px" onSubmit=${(e) => { e.preventDefault(); connectKey(key); }}>
        <input class=${`input${su.keyError ? ' invalid' : ''}`} type="password" placeholder="sk-ant-…" value=${key} aria-label="API key" aria-invalid=${su.keyError}
          onInput=${(e) => { setKey(e.target.value); if (su.keyError) setSetup({ keyError: false }); }} style="width:260px" />
        <${Btn} type="submit" disabled=${!key.trim()}>Connect<//>
      </form>
      ${su.keyError && html`<p class="t-xs error" role="alert">That key was rejected. Check it in the Anthropic Console and paste it again.</p>`}
    </div>
  </div>`;
}
function ModelDownload({ compact }) {
  const m = S.setup.model;
  const left = Math.max(1, Math.round((MODEL_MB - m.mb) / 30 / 60));
  if (m.state === 'ready') {
    return html`<div class="connected"><${Icon} name="CircleCheck" size=${18} class="ok" /><span class="t-sm grow">Ready · Whisper large-v3-turbo runs on this computer</span></div>`;
  }
  if (m.state === 'verifying') {
    return html`<div class="connected"><${Icon} name="LoaderCircle" size=${16} class="spin muted" /><span class="t-sm grow">Checking the file…</span></div>`;
  }
  const paused = m.state === 'paused';
  return html`<div class="col" style="gap:8px">
    <div class="row" style="gap:12px">
      <div class="col grow" style="gap:7px">
        <${Progress} value=${m.mb / MODEL_MB} label="Model download" />
        <span class="t-xs muted num">${paused ? 'Paused at ' : ''}${Math.round(m.mb)} of ${MODEL_MB} MB${paused ? '' : ` · about ${left} min left`}</span>
      </div>
      <${Btn} sm icon=${paused ? 'Play' : 'Pause'} onClick=${toggleDownload}>${paused ? 'Resume' : 'Pause'}<//>
    </div>
    ${!compact && html`<button class="link t-xs" style="align-self:flex-start" onClick=${importModel}>Already have the file? Import it…</button>`}
  </div>`;
}
export function Setup() {
  const done = claudeReady() && modelReady();
  return html`<div class="screen">
    <${AppBar}><${Brand} /><//>
    <div class="scroll grow"><div class="setup">
      <h1 class="t-display">Set up MotionBrief</h1>
      <p class="lead muted">Two things before your first video. Both keep going in the background, so you can skip ahead and finish from Home.</p>
      <section class="setup-step">
        <${StepMark} n="1" done=${claudeReady()} />
        <div class="col grow" style="gap:14px">
          <div><h2 class="t-head">Connect Claude</h2><p class="t-sm muted step-help">The agent runs on your own Claude account. MotionBrief has no servers in between.</p></div>
          <${ConnectClaude} />
        </div>
      </section>
      <section class="setup-step">
        <${StepMark} n="2" done=${modelReady()} />
        <div class="col grow" style="gap:14px">
          <div><h2 class="t-head">Download the transcription model</h2><p class="t-sm muted step-help">Transcription runs on this computer, so your Voiceover never leaves it. ${MODEL_MB} MB, downloaded once.</p></div>
          <${ModelDownload} />
        </div>
      </section>
      <div class="setup-foot">
        ${!done && html`<span class="t-xs muted">Unfinished steps stay on Home’s checklist.</span>`}
        <${Btn} kind=${done ? 'primary' : 'secondary'} onClick=${() => { setSetup({ dismissed: done }); go('home'); }}>Continue to Home<//>
      </div>
    </div></div>
  </div>`;
}

// ---------- Home ----------
function Checklist() {
  return html`<section class="checklist" aria-label="Finish setting up">
    <div class="col" style="gap:3px;width:220px;flex:none"><h2 class="t-sm" style="font-weight:500">Finish setting up</h2><p class="t-xs muted">You can start a Project now. Generate waits for both.</p></div>
    <div class="check-item">
      <${StepMark} n="1" done=${claudeReady()} />
      <span class="t-sm grow">Connect Claude</span>
      ${claudeReady() ? html`<span class="t-xs muted">Done</span>` : html`<${Btn} sm onClick=${() => go('setup')}>${S.setup.claude === 'waiting' ? 'Signing in…' : 'Connect'}<//>`}
    </div>
    <div class="check-item">
      <${StepMark} n="2" done=${modelReady()} />
      <span class="t-sm" style="flex:none">Transcription model</span>
      <div class="grow">${modelReady() ? html`<span class="t-xs muted" style="float:right">Ready</span>` : html`<${ModelDownload} compact />`}</div>
    </div>
  </section>`;
}
function ProjectThumb({ p }) {
  if (!p.still) return html`<div class="pthumb none"><${Icon} name="Film" size=${18} /></div>`;
  return html`<div class=${`pthumb${p.stillFormat === 'vertical' ? ' vertical' : ''}`}><img src=${p.still} alt="" /></div>`;
}
function ProjectRow({ p }) {
  const renaming = S.renaming === p.id;
  const menuOpen = S.menu === p.id;
  const items = [
    { icon: 'FolderOpen', label: 'Open', onClick: () => openProject(p.id) },
    { icon: 'Pencil', label: 'Rename', onClick: () => set({ renaming: p.id }) },
    { icon: 'Copy', label: 'Duplicate', onClick: () => duplicateProject(p.id) },
    { icon: 'ExternalLink', label: 'Show in Explorer', onClick: () => toast('Prototype: Explorer opens on the Project folder.') },
    '-',
    { icon: 'Trash2', label: 'Delete', hint: 'To Recycle Bin', danger: true, onClick: () => deleteProject(p.id) },
  ];
  return html`<div class="prow" role="row" onClick=${(e) => { if (!renaming && !e.target.closest('button,input,.menu')) openProject(p.id); }}
    onContextMenu=${(e) => { e.preventDefault(); set({ menu: p.id }); }}>
    <${ProjectThumb} p=${p} />
    <div class="col" style="gap:3px;min-width:0" role="cell">
      ${renaming
        ? html`<input class="input" value=${p.name} aria-label="Project name" style="height:30px" ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus(), el.select())}
            onKeyDown=${(e) => { if (e.key === 'Enter') renameProject(p.id, e.target.value); if (e.key === 'Escape') set({ renaming: null }); }}
            onBlur=${(e) => renameProject(p.id, e.target.value)} />`
        : html`<button class="pname" onClick=${() => openProject(p.id)}>${p.name}</button>`}
      ${p.where && html`<span class="t-xs muted row ellipsis" style="gap:5px"><${Icon} name="FolderOpen" size=${12} />${p.where}</span>`}
    </div>
    <div role="cell" class="row" style="gap:4px">${p.formats.map((f) => html`<span class="fmt-tag num">${FORMAT_LABEL[f]}</span>`)}</div>
    <span role="cell" class="t-sm muted num">${mmss(p.dur)}</span>
    <span role="cell" class="t-sm muted num">${p.versions}</span>
    <span role="cell" class="t-sm muted num">${p.size}</span>
    <span role="cell" class="t-sm muted">${p.modified}</span>
    <div role="cell" class="pop-anchor">
      <${IconBtn} icon="Ellipsis" label=${`More actions for ${p.name}`} onClick=${() => set({ menu: menuOpen ? null : p.id })} aria-expanded=${menuOpen} />
      ${menuOpen && html`<${Menu} items=${items} onClose=${() => set({ menu: null })} style="right:0;top:calc(100% + 4px)" />`}
    </div>
  </div>`;
}
export function Home() {
  const unfinished = !claudeReady() || !modelReady();
  const ps = S.projects;
  const onDrop = (e) => { e.preventDefault(); set({ dragging: false }); startNewProject(true); };
  return html`<div class="screen" onDragEnter=${(e) => { e.preventDefault(); set({ dragging: true }); }} onDragOver=${(e) => e.preventDefault()}>
    <${AppBar} right=${html`<${IconBtn} icon="Settings" label="Settings" onClick=${() => toast('Settings are out of scope for this prototype.')} />`}><${Brand} /><//>
    <div class="scroll grow"><div class="home">
      ${unfinished && html`<${Checklist} />`}
      <div class="home-head">
        <h1 class="t-head">Projects</h1>
        <span class="spacer"></span>
        <${Btn} icon="FolderOpen" onClick=${() => toast('Prototype: a folder picker opens here.')}>Open Project…<//>
        <${Btn} kind="primary" icon="Plus" onClick=${() => startNewProject()}>New Project<//>
      </div>
      ${ps.length ? html`<div class="ptable" role="table" aria-label="Recent Projects">
          <div class="prow phead" role="row"><span></span><span role="columnheader">Name</span><span role="columnheader">Formats</span><span role="columnheader">Length</span><span role="columnheader">Versions</span><span role="columnheader">Size</span><span role="columnheader">Modified</span><span></span></div>
          ${ps.map((p) => html`<${ProjectRow} key=${p.id} p=${p} />`)}
        </div>
        <p class="t-xs muted home-foot"><${Icon} name="Upload" size=${13} />Drop a Voiceover anywhere on this window to start a new Project. Projects are plain folders in Documents\\MotionBrief.</p>`
        : html`<div class="dropzone big" role="button" tabindex="0" onClick=${() => startNewProject()}>
          <span class="drop-icon"><${Icon} name="AudioLines" size=${24} /></span>
          <h2 class="t-head">Start with a Voiceover</h2>
          <p class="muted t-sm">Drop a recording here, or choose New Project. MotionBrief turns it into a motion-graphics video you revise by asking.</p>
        </div>`}
    </div></div>
    ${S.dragging && html`<div class="drop-overlay" onDragOver=${(e) => e.preventDefault()} onDragLeave=${() => set({ dragging: false })} onDrop=${onDrop}>
      <div class="drop-card"><${Icon} name="AudioLines" size=${28} /><span class="t-head">Drop to start a new Project</span></div>
    </div>`}
  </div>`;
}

// ---------- New Project ----------
function TranscriptPane() {
  const n = S.newp, tx = n.tx;
  const paras = [];
  let cur = [];
  W.forEach((w, i) => {
    if (tx.state !== 'done' && w.s > tx.t) return;
    cur.push(i);
    if (w.end === 'sentence' && (W[i + 1]?.s ?? DUR) - w.e > 0.8) { paras.push(cur); cur = []; }
  });
  if (cur.length) paras.push(cur);
  return html`<section class="tx-pane">
    <div class="row" style="gap:10px">
      <h2 class="t-sm" style="font-weight:500">Transcript</h2>
      ${tx.state === 'running' && html`<span class="badge working"><span class="dot"></span>Transcribing on this computer</span>`}
      ${tx.state === 'done' && html`<span class="t-xs muted num">${W.length} words · English · ${mmss(DUR)}</span>`}
      <span class="spacer"></span>
      ${tx.state === 'done' && html`<span class="t-xs muted">Double-click a word to fix it. Fixes carry into Captions and the Storyboard.</span>`}
    </div>
    ${tx.state === 'waiting' && html`<div class="tx-wait">
      <p class="t-sm">Transcription starts when the model finishes downloading.</p>
      <${ModelDownload} compact />
    </div>`}
    ${tx.state === 'running' && html`<div class="row" style="gap:10px"><${Progress} value=${tx.t / DUR} tone="working" label="Transcription" /><span class="t-xs muted num" style="flex:none">${mmss(tx.t)} of ${mmss(DUR)}</span></div>`}
    <div class="tx-text scroll">
      ${paras.map((p) => html`<p>${p.map((i) => (S.editWord === i && S.screen === 'new'
        ? html`<${WordEdit} i=${i} style=${{ position: 'static' }} /> `
        : html`<span class=${S.edits[i] ? 'fixed' : ''} onDblClick=${() => tx.state === 'done' && set({ editWord: i })}>${wordText(i)}</span> `))}</p>`)}
    </div>
  </section>`;
}
export function NewProject() {
  const n = S.newp;
  const e = estimate();
  const canGo = claudeReady() && n.tx.state === 'done';
  const onDrop = (ev) => { ev.preventDefault(); set({ dragging: false }); chooseVoiceover(); };
  return html`<div class="screen">
    <${AppBar}><${IconBtn} icon="ArrowLeft" label="Back to Home" onClick=${() => go('home')} /><span class="t-body">New Project</span><//>
    ${n.stage === 'drop' ? html`<div class="grow drop-stage">
      <div class=${`dropzone${S.dragging ? ' over' : ''}`} onDragEnter=${(ev) => { ev.preventDefault(); set({ dragging: true }); }} onDragOver=${(ev) => ev.preventDefault()}
        onDragLeave=${() => set({ dragging: false })} onDrop=${onDrop}>
        <span class="drop-icon"><${Icon} name="AudioLines" size=${24} /></span>
        <h2 class="t-head">Drop a Voiceover</h2>
        <p class="muted t-sm">Any audio or video file FFmpeg can read, such as WAV, MP3, M4A or MP4. It’s copied into the Project folder; your original stays where it is.</p>
        <${Btn} kind="primary" onClick=${chooseVoiceover}>Choose file…<//>
      </div>
    </div>` : html`<div class="row grow" style="align-items:stretch;min-height:0">
      <div class="np-form scroll">
        <div class="file-row">
          <span class="file-icon"><${Icon} name="FileAudio" size=${18} /></span>
          <div class="col grow" style="gap:2px;min-width:0"><span class="t-sm ellipsis">${n.file.name}</span><span class="t-xs muted num">${mmss(n.file.dur)} · ${n.file.size}</span></div>
          <${Btn} sm kind="ghost" onClick=${() => setNew({ stage: 'drop', file: null, tx: { state: 'idle', t: 0 } })}>Replace<//>
        </div>
        <label class="field"><span class="lbl">Project name</span>
          <input class="input" value=${n.name} onInput=${(ev) => setNew({ name: ev.target.value })} />
          <span class="t-xs muted help">Saved to Documents\\MotionBrief\\${n.name || 'Untitled'}\\</span></label>
        <div class="field"><span class="lbl">Format</span>
          <${Seg} full label="Format" value=${n.format} onChange=${(f) => setNew({ format: f })} options=${[['horizontal', '16:9 · YouTube'], ['vertical', '9:16 · Shorts']]} />
          <span class="t-xs muted help">You can add the other Format later from the same Transcript.</span></div>
        <div class="field"><span class="lbl">Style Preset</span>
          <div class="preset-grid" role="radiogroup" aria-label="Style Preset">${PRESETS.map((p) => html`<button role="radio" aria-checked=${n.preset === p.id} class=${`preset-card${n.preset === p.id ? ' on' : ''}`} onClick=${() => setNew({ preset: p.id })}>
            <${PresetArt} id=${p.id} /><span class="t-sm">${p.id}</span></button>`)}</div>
          <span class="t-xs muted help">${PRESETS.find((p) => p.id === n.preset).blurb}. Palette and typography can change later without the agent.</span></div>
        <label class="field"><span class="lbl">Language</span>
          <select class="select" value=${n.lang} onChange=${(ev) => setNew({ lang: ev.target.value })}>
            <option value="auto">Auto-detect</option><option value="en">English</option><option value="de">German</option><option value="es">Spanish</option><option value="fr">French</option>
          </select>
          <span class="t-xs muted help">${n.tx.state === 'done' && n.lang === 'auto' ? 'Detected English. ' : ''}English is the only tested language so far.</span></label>
      </div>
      <${TranscriptPane} />
    </div>
    <footer class="np-foot">
      <${Icon} name="Clock" size=${15} class="muted" />
      <span class="t-sm muted grow">${S.auth === 'apikey'
        ? `About ${e.min}–${e.max} minutes and $${e.lo.toFixed(2)}–$${e.hi.toFixed(2)} with the default models. You approve before it starts.`
        : `About ${e.min}–${e.max} minutes with the default models. It counts against your plan’s usage limits.`}</span>
      ${!claudeReady() ? html`<span class="t-xs muted">Connect Claude to generate</span><${Btn} sm onClick=${() => go('setup')}>Connect<//>`
        : n.tx.state !== 'done' && html`<span class="t-xs muted">Generate unlocks when the Transcript is ready</span>`}
      <${Btn} kind="primary" disabled=${!canGo} onClick=${generate}>Generate ${FORMAT_LABEL[n.format]} video<//>
    </footer>`}
  </div>`;
}

// ---------- prompts when opening a Project ----------
export function ProjectDialogs() {
  const d = S.dialog;
  if (!d) return null;
  const p = S.projects.find((x) => x.id === d.id);
  const close = () => set({ dialog: null });
  if (d.kind === 'lock') {
    return html`<${Dialog} title="This Project may be open somewhere else" icon="Lock" tone="warn" onClose=${close}
      actions=${html`<${Btn} kind="ghost" onClick=${close} data-autofocus>Cancel<//><${Btn} kind="secondary" onClick=${() => openProject(p.id, true)}>Open anyway<//>`}>
      <p>“${p.name}” is locked by MotionBrief on this computer, last active 3 hours ago. That usually means the app closed unexpectedly, and opening it is safe.</p>
      <p>If the folder is synced and open on another computer, opening it here can overwrite that computer’s changes.</p>
    <//>`;
  }
  return html`<${Dialog} title="Update MotionBrief to open this Project" icon="CircleAlert" onClose=${close}
    actions=${html`<${Btn} kind="ghost" onClick=${close}>Cancel<//><${Btn} kind="primary" icon="Download" data-autofocus onClick=${() => { close(); toast('Prototype: the updater checks GitHub Releases.'); }}>Check for updates<//>`}>
    <p>“${p.name}” was saved by MotionBrief 1.4. This is version 1.2, which can’t open it without risking your work.</p>
    <p>Nothing in the Project was changed.</p>
  <//>`;
}
export function Toast() {
  const t = S.toast;
  if (!t) return null;
  return html`<div class="toast" role="status"><span>${t.text}</span>
    ${t.undo && html`<${Btn} sm kind="ghost" onClick=${t.undo}>Undo<//>`}
    <${IconBtn} sm icon="X" label="Dismiss" onClick=${() => set({ toast: null })} /></div>`;
}
