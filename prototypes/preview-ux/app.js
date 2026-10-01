// PROTOTYPE (throwaway) for Prototype: Preview UX (MotionBrief #19): how the app looks and behaves around the preview,
// from first-run setup through Home and New Project to the Project screen while a video generates and is revised.
// Variant A (Editor) was picked; B (Chat-first) stays for comparison. Not production code.
import { html, render, useEffect } from './ui.js';
import { S, set, setV, useStore, VARIANTS, SCHED, fmtState, go, togglePlay, seek, clearSel, resetFirstRun } from './store.js';
import { VariantA, VariantB } from './project.js';
import { Setup, Home, NewProject, ProjectDialogs, Toast } from './screens.js';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      if (S.screen !== 'editor' || S.dialog) return;
      if (e.target.closest?.('input,textarea,select,[contenteditable],[role=separator]')) return;
      if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(S.t - 5); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(S.t + 5); }
      if (e.key === 'Escape') clearSel();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

// ---------- prototype controls (not part of the design) ----------
function ProtoBar() {
  const f = S.format, sch = SCHED[f];
  const screen = (s) => (s === 'setup' ? resetFirstRun() : go(s));
  const variant = (k) => { const u = new URL(location.href); u.searchParams.set('variant', k); history.replaceState(null, '', u); set({ variant: k }); };
  return html`<div class="proto-bar" aria-label="Prototype controls">
    <span class="lbl">PROTOTYPE</span>
    <select value=${S.screen} onChange=${(e) => screen(e.target.value)} title="Screen">
      <option value="setup">First-run setup</option><option value="home">Home</option><option value="new">New Project</option><option value="editor">Project</option>
    </select>
    ${S.screen === 'editor' && html`<select value=${S.variant} onChange=${(e) => variant(e.target.value)} title="Layout">${Object.entries(VARIANTS).map(([k, l]) => html`<option value=${k}>${k} · ${l}</option>`)}</select>`}
    <select value=${S.auth} onChange=${(e) => set({ auth: e.target.value })} title="Connection"><option value="subscription">Subscription</option><option value="apikey">API key</option></select>
    ${S.screen === 'editor' && html`
      <select value=${S.placeholder} onChange=${(e) => set({ placeholder: e.target.value })} title="Placeholder while a Scene generates">
        <option value="animatic">Placeholder: animatic</option><option value="skeleton">Placeholder: skeleton</option><option value="words">Placeholder: spoken words</option></select>
      <input type="range" min="0" max=${sch.total} value=${S.v[f].gen.clock} title="Generation clock" onInput=${(e) => setV({ exists: true, gen: { clock: Number(e.target.value), stoppedAt: null }, genDone: false })} />
      <button onClick=${() => setV(fmtState(f))} title="Restart generation">restart</button>`}
    <span class="lbl">sim</span>
    <button onClick=${() => set({ simPlaying: !S.simPlaying })} title="Pause or resume the simulation">${S.simPlaying ? 'pause' : 'play'}</button>
    <select value=${S.speed} onChange=${(e) => set({ speed: Number(e.target.value) })} title="Simulation speed">${[4, 12, 30, 80].map((x) => html`<option value=${x}>${x}×</option>`)}</select>
  </div>`;
}

function App() {
  useStore();
  useShortcuts();
  const screen = { setup: Setup, home: Home, new: NewProject }[S.screen];
  const Editor = S.variant === 'B' ? VariantB : VariantA;
  return html`<div class="window">${screen ? html`<${screen} />` : html`<${Editor} />`}</div><${ProjectDialogs} /><${Toast} /><${ProtoBar} />`;
}
render(html`<${App} />`, document.getElementById('app'));
