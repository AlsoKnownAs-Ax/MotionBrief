// PROTOTYPE (throwaway): rendering helpers and UI primitives for Prototype: Preview UX (MotionBrief #19).
import { h, render } from 'https://esm.sh/preact@10.24.3';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.24.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import * as L from 'https://esm.sh/lucide-preact@0.460.0?deps=preact@10.24.3&exports=ArrowLeft,ArrowUp,AudioLines,Blend,Check,ChevronDown,CircleAlert,CircleCheck,Clock,Copy,Download,Ellipsis,ExternalLink,FileAudio,Film,FolderOpen,History,House,Info,KeyRound,Languages,LoaderCircle,Lock,MessageSquare,Palette,Pause,Pencil,Play,Plus,RotateCcw,Scissors,Settings,Square,TriangleAlert,Trash2,Upload,Video,X,ZoomIn,ZoomOut';

export const html = htm.bind(h);
export { render, useState, useEffect, useRef };

export function Icon({ name, size = 16, ...rest }) {
  const C = L[name];
  return html`<${C} size=${size} strokeWidth=${1.75} aria-hidden="true" ...${rest} />`;
}

export function Btn({ kind = 'tertiary', sm, icon, children, cls = '', ...rest }) {
  return html`<button class=${`pill ${kind}${sm ? ' sm' : ''} ${cls}`} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${sm ? 14 : 16} />`}${children}
  </button>`;
}

export function IconBtn({ icon, label, sm, kind = '', size, ...rest }) {
  return html`<button class=${`icon-btn ${kind}${sm ? ' sm' : ''}`} aria-label=${label} title=${label} ...${rest}>
    <${Icon} name=${icon} size=${size ?? (sm ? 14 : 16)} />
  </button>`;
}

export function Seg({ options, value, onChange, label, full }) {
  return html`<div class=${`seg${full ? ' full' : ''}`} role="tablist" aria-label=${label}>
    ${options.map(([v, l]) => html`<button role="tab" aria-selected=${v === value} class=${v === value ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}
  </div>`;
}

export function Switch({ checked, onChange, label }) {
  return html`<button role="switch" aria-checked=${checked} aria-label=${label} class="switch" onClick=${() => onChange(!checked)}><span></span></button>`;
}

export function Progress({ value, tone = '', label, width }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return html`<div class=${`progress ${tone}`} style=${width ? { width: `${width}px` } : {}} role="progressbar" aria-label=${label} aria-valuenow=${Math.round(pct)} aria-valuemin="0" aria-valuemax="100">
    <span style=${{ width: `${pct}%` }}></span>
  </div>`;
}

// Closes a popover on a pointer-down outside it or on Escape.
export function useDismiss(ref, onClose) {
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    const id = setTimeout(() => document.addEventListener('pointerdown', down), 0);
    addEventListener('keydown', key);
    return () => { clearTimeout(id); document.removeEventListener('pointerdown', down); removeEventListener('keydown', key); };
  }, []);
}

export function Popover({ onClose, children, cls = '', style = {} }) {
  const ref = useRef();
  useDismiss(ref, onClose);
  return html`<div ref=${ref} class=${`popover ${cls}`} style=${style}>${children}</div>`;
}

export function Menu({ items, onClose, style }) {
  return html`<${Popover} onClose=${onClose} cls="menu" style=${style}>
    <div role="menu">
      ${items.map((it) => (it === '-' ? html`<hr />` : html`<button role="menuitem" class=${it.danger ? 'danger' : ''} onClick=${() => { onClose(); it.onClick(); }}>
        <${Icon} name=${it.icon} size=${15} /><span class="grow">${it.label}</span>${it.hint && html`<span class="muted t-xs">${it.hint}</span>`}
      </button>`))}
    </div>
  <//>`;
}

export function Dialog({ title, icon, tone = '', children, actions, onClose }) {
  const ref = useRef();
  useEffect(() => {
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return html`<div class="scrim" onPointerDown=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div ref=${ref} class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
      ${icon && html`<div class=${`dialog-icon ${tone}`}><${Icon} name=${icon} size=${20} /></div>`}
      <h2 id="dlg-title">${title}</h2>
      <div class="dialog-body">${children}</div>
      <div class="dialog-actions">${actions}</div>
    </div>
  </div>`;
}

// Pane divider. dir 'x' sizes a width (vertical bar), 'y' a height; invert when dragging toward the start grows the pane.
export function Splitter({ dir, value, min, max, onChange, invert, label, onReset }) {
  const clamp = (v) => Math.round(Math.max(min, Math.min(max, v)));
  const pos = (e) => (dir === 'x' ? e.clientX : e.clientY);
  const onDown = (e) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = pos(e), v0 = value;
    document.body.classList.add(`resizing-${dir}`);
    el.onpointermove = (ev) => { const d = pos(ev) - start; onChange(clamp(v0 + (invert ? -d : d))); };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; document.body.classList.remove(`resizing-${dir}`); };
  };
  const onKey = (e) => {
    const grow = dir === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : (invert ? 'ArrowUp' : 'ArrowDown');
    const shrink = dir === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : (invert ? 'ArrowDown' : 'ArrowUp');
    if (e.key === grow) { e.preventDefault(); onChange(clamp(value + 16)); }
    if (e.key === shrink) { e.preventDefault(); onChange(clamp(value - 16)); }
  };
  return html`<div class=${`splitter ${dir}`} role="separator" tabindex="0" aria-label=${label} aria-orientation=${dir === 'x' ? 'vertical' : 'horizontal'}
    aria-valuenow=${Math.round(value)} aria-valuemin=${min} aria-valuemax=${max} title="Drag to resize · double-click to reset"
    onPointerDown=${onDown} onKeyDown=${onKey} onDblClick=${onReset}></div>`;
}

// Windows 11 caption buttons; the prototype runs in a browser, so they do nothing.
export function WindowControls() {
  const line = (d) => html`<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d=${d} stroke="currentColor" stroke-width="1" fill="none" /></svg>`;
  return html`<div class="winctl" title="Window controls (not wired in the prototype)">
    <button aria-label="Minimize" tabindex="-1">${line('M0 5.5h10')}</button>
    <button aria-label="Maximize" tabindex="-1">${line('M.5.5h9v9h-9z')}</button>
    <button aria-label="Close" class="close" tabindex="-1">${line('M0 0l10 10M10 0L0 10')}</button>
  </div>`;
}

export function Mark({ size = 20 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 20 20" aria-hidden="true">
    <rect width="20" height="20" rx="6" fill="#ff7a3d" />
    <path d="M5 13V9M8.5 15V5M12 12V8M15.5 14V6" stroke="#000" stroke-width="2" stroke-linecap="round" />
  </svg>`;
}
