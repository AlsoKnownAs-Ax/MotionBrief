// PROTOTYPE: prompts for the Storyboard agent, the Scene-code subagents and the visual reviewer.
import { DIMS, type Format, type Unit } from "./frame.ts";
import type { Storyboard } from "./storyboard.ts";
import { TYPOGRAPHY, motionSpec, pacingFor, type Preset } from "./preset.ts";
import type { Transcript } from "./transcribe.ts";

export function transcriptText(t: Transcript): string {
  const lines: string[] = [];
  let cur: string[] = [];
  let lineStart = 0;
  for (const w of t.words) {
    if (!cur.length) lineStart = w.s;
    cur.push(`${w.i}:${w.w}`);
    if (w.end === "sentence" || w.i === t.words.length - 1) {
      lines.push(`[${lineStart.toFixed(1)}s] ${cur.join(" ")}`);
      cur = [];
    }
  }
  return lines.join("\n");
}

const PACING = (format: Format, p: Preset) => {
  const { target, maxScene } = pacingFor(format, p.motion.energy);
  return `${format === "vertical" ? "Vertical" : "Horizontal"}, ${p.motion.energy} energy: about ${target[0]}–${target[1]} s per Scene (hard max ${maxScene} s)${format === "vertical" ? ", one focal element per Scene" : ""}.`;
};
// the Storyboard's transition kinds allowed by the Preset ("push" = any push direction; "camera" is governed by the Canvas preference)
export const allowedStoryboardTransitions = (p: Preset) => [
  ...p.transitions.flatMap((x) => (x === "push" ? ["push-left", "push-right", "push-up", "push-down"] : [x])),
  ...(p.canvas === "never" ? [] : ["camera"]),
];
const CANVAS = (format: Format, p: Preset) => {
  const dir = format === "vertical" ? "in vertical the camera mostly moves up/down." : "in horizontal the camera mostly moves sideways.";
  if (p.canvas === "never") return `Canvas: this style never uses Canvases — every Scene stands alone; do not set "canvas" and never use "camera".`;
  if (p.canvas === "always")
    return `Canvas: this style prefers one continuous board. Put runs of consecutive Scenes on a shared Canvas (same "canvas" id) whenever they are about the same system or idea, so the camera moves across one large board instead of cutting; only break to a new Scene/Canvas when the topic changes. ${dir}`;
  return `Canvas: when consecutive Scenes build on the same picture (a diagram growing, a flow continuing, a system being explained part by part), put them on one Canvas (same "canvas" id) so the camera moves across one large board instead of cutting. Use Canvases where they help continuity; ${dir}`;
};

export const storyboardSystem = (format: Format, p: Preset) => `You are the Storyboard author for MotionBrief, which turns a Voiceover into a motion-graphics YouTube video.
Quality bar for content: ByteMonk system-design explainers (icon+label nodes, flows with packets, code panels, count-up stats) where every element arrives exactly when it is spoken.
Visual style of this video ("${p.name}"): ${p.direction}

You write the Storyboard: structured data only — no layout, no motion, no code. Another agent animates each Scene later.

Rules:
- A video is a sequence of Scenes. Each Scene is one visual composition covering a contiguous span of Transcript words [from, to]. Scenes tile the whole Transcript with no gaps and no overlap.
- Scene boundaries fall only at sentence or clause ends (words marked with . ? ! , ; : —). A Scene usually covers 1–2 sentences.
- ${PACING(format, p)}
- Pick one of the 9 Scene Types for each Scene; its content must follow that type's shape:
  hook (kinetic headline, optional kicker / quoted source card) · key-term (a term, short definition) · architecture (icon+label nodes and connectors, built up in narration order) · flow (a pipeline of steps with packets travelling along edges) · code (editor or terminal; typing or static; highlighted lines) · comparison (A vs B, before/after) · list (steps / items) · stat (count-up number or bar chart) · outro (call to action).
- Every content element has an id and an anchor "at": the index of the Transcript word on which it appears — the word that names it, or the first word of the phrase it illustrates. Anchors must lie inside the Scene's span. Spread anchors across the Scene; never anchor everything on the first word.
- On-screen copy is short motion-graphics copy (a label, a hero word, a number) — never a narration sentence. Numbers are shown as digits (say "one hundred fifty milliseconds" → value 150, unit "ms").
- Icons: "lucide:<name>" from the Lucide set (e.g. lucide:server, lucide:globe, lucide:database, lucide:user, lucide:laptop, lucide:shield, lucide:zap, lucide:clock, lucide:image, lucide:file-code, lucide:network, lucide:map-pin, lucide:hard-drive, lucide:cloud) or "brand:<simple-icons slug>" (e.g. brand:cloudflare, brand:github, brand:python). Only use names you are sure exist.
- Transitions: this style allows only: ${allowedStoryboardTransitions(p).join(", ")}. Pick a small consistent transitionSet (2–3 kinds) from those for the whole video and use it. "camera" is the move between consecutive Scenes on one Canvas.
- ${CANVAS(format, p)}
- Format: ${format} (${DIMS[format].W}×${DIMS[format].H}). ${format === "vertical" ? "Stack things vertically, bigger type, fewer words per line, at most ~4 nodes/items per Scene. A bottom band is reserved for Captions." : "Wide diagrams and side-by-side comparisons work well."}
- "intent" is a one-line visual direction for the animator (what the viewer should see and the key move), not a restatement of the narration.`;

export const storyboardPrompt = (t: Transcript, format: Format, feedback?: string) =>
  `Transcript (word index:word; each line is one sentence, with its start time):
${transcriptText(t)}

Total duration: ${t.duration.toFixed(1)} s. Last word index: ${t.words.length - 1}. Format: ${format}.
Write the Storyboard.${feedback ? `\n\nYour previous Storyboard was rejected by the validator. Fix every problem:\n${feedback}` : ""}`;

const BG_DESC = { solid: "a flat --bg fill", gradient: "a soft --bg2→--bg gradient", dots: "a --bg2→--bg gradient with a faint dot grid", lines: "a --bg fill with a faint square grid (like graph paper)" };
const SURFACE_DESC = { flat: "a flat --surface fill, no border, no shadow", outlined: "a --surface fill with a --line outline (--border-w), no shadow", elevated: "a --surface fill with a thin --line border and a soft shadow" };
const ICON_DESC = {
  outline: "we replace it with an inline outline SVG sized 1em (set font-size to size it, color to color it)",
  "outline-chip": "we replace it with a rounded chip (--surface2 fill, --line border) holding the outline icon; the chip's box is 1em (set font-size to size it, color to color the icon)",
  "filled-chip": "we replace it with a rounded chip filled with the element's color (set color on it to pick the chip color; the icon inside is drawn in --surface); the chip's box is 1em (set font-size to size it)",
};

export const sceneSystem = (format: Format, p: Preset) => {
  const d = DIMS[format];
  const T = TYPOGRAPHY[p.typography];
  const tr = p.treatments;
  const m = motionSpec(p.motion);
  const dark = p.palette.mode === "dark";
  return `You write the HyperFrames (HTML/CSS/GSAP) code for one unit of a MotionBrief video: either one Scene, or one Canvas holding several consecutive Scenes. You work inside a frame we own. Output JSON {css, html, js}; we wrap it into the composition.

STYLE OF THIS VIDEO — "${p.name}": ${p.direction}
The frame already implements the style's colors, fonts, surfaces, lines and texture. You express the style through layout, composition, emphasis and motion — never by hard-coding colors or fonts.

THE FRAME (already provided — do not re-create):
- Canvas ${d.W}×${d.H}. Safe area: x ${d.safe.x}–${d.W - d.safe.x}, y ${d.safe.top}–${d.safe.bottom}. ${format === "vertical" ? `Everything below y=${d.safe.bottom} is reserved for Captions — keep ALL content above it.` : `Keep all content inside the safe area.`}
- Background (${BG_DESC[tr.background]}) is already painted${tr.texture !== "none" ? `, and a ${tr.texture} texture overlay sits on top of everything` : ""}. Do not paint a full-screen background.
- Palette (${dark ? "dark" : "light"}), as CSS variables on the root: --bg --bg2 --surface --surface2 (panels) --line (borders, connectors) --ink (main text) --muted (secondary text) --accent (the ONE key thing) --accent2 --accent3 (secondary highlights, e.g. active data flow) --good --bad. Also --radius --border-w --wire-w --shadow; --safe-x --safe-top --safe-w --safe-h; type scale --fs-display --fs-title --fs-body --fs-label --fs-mono.
- COLORS ARE TOKENS ONLY (checked automatically): every color must be var(--<role>) or color-mix(in srgb, var(--<role>) N%, transparent) (or another var). No hex, rgb(), hsl(), oklch() or named colors (white, black, ...) anywhere — CSS, style attributes, SVG fill/stroke, or JS tweens. On --accent fills, put text in var(--bg) or var(--surface).
- FONTS ARE TOKENS ONLY: font-family must be var(--font-display) (${T.display.family}), var(--font-body) (${T.body.family}), var(--font-label) or var(--font-mono) (${T.mono.family}); prefer the classes below, which already set them. Never name a font.
- Utility classes: .mb-safe (absolute box = the safe area) .mb-card (panel: ${SURFACE_DESC[tr.surface]}${tr.line === "sketchy" ? "; its outline is drawn with a hand-drawn wobble" : ""}) .mb-display .mb-title .mb-body .mb-label .mb-mono .mb-accent .mb-icon .mb-wire (SVG connector layer; connectors are ${tr.connector.curve ? "curved" : "straight"}, ${tr.connector.weight}px${tr.line === "sketchy" ? ", hand-drawn" : ""}).
- Icons: write <i data-icon="lucide:server" class="..." id="..."></i>; ${ICON_DESC[tr.icons]}. Use only the icon names from the Storyboard or well-known Lucide names.

YOUR HTML: markup that goes inside the composition root. Position with absolute boxes / flex / grid. Every element id you create must start with the unit id or a Scene id of this unit.

THE CONTRACT (checked automatically; failures come back to you):
1. Every Storyboard element exists in the DOM with id "<sceneId>-<elementId>" (e.g. s03-origin), is clearly arriving (effective opacity ≥ 0.3, inside the frame, non-zero size) by its anchor + 0.1 s and stays visible, and is NOT visible before its anchor − 0.3 s. MB.reveal already starts 50 ms early so it lands on the word. Use at("<sceneId>-<elementId>") for its reveal time. Never write absolute seconds for a Storyboard element.
2. Your JS runs with these in scope: tl (the paused GSAP timeline to add to), at(id) (seconds, relative to this unit's start), S (S.dur = unit length in s, S.words = [[word, seconds], ...] for extra word-sync, S.sceneStarts = {sceneId: seconds}). Build synchronously. Do not create or register another timeline.
3. Seek-safe GSAP only: entrances with fromTo (or the MB helpers); no repeat/yoyo, no Math.random, no Date, no CSS transitions or @keyframes, no setTimeout. Never tween display/visibility. No exit animations — our Transitions are the exit. Don't put a CSS transform on an element you animate with GSAP (use fromTo from-values instead). Don't use the class name "clip". Don't style #root.
4. Every line that connects two elements (edges, arrows, leader lines to callouts, return paths) is an SVG <path> placed with MB.connect — never hand-computed coordinates; hand-placed lines end up detached from their nodes. Labels for a connector sit next to its midpoint.
5. Text must not overlap other text unless deliberately layered (e.g. a flip/stack effect): then mark the layered element with data-layout-allow-overlap. Calling getTotalLength() on a path needs its d set first (MB.connect sets it).
6. No narration sentences as on-screen text. Copy comes from the Storyboard content.

HELPERS (window.MB — prefer them):
- MB.reveal(tl, target, t, style, {duration, stagger, ease, from}) — style: rise|drop|left|right|pop|fade|blur|wipe (default for this style: ${m.reveal}; default ease and duration already match the style's Motion).
- MB.connect(pathSel, fromSel, toSel, {curve, gap}) — sets an SVG <path>'s d between two elements' box edges (curve defaults to the style). The <svg class="mb-wire"> must be a direct child of the common positioned container of both elements. Then MB.draw(tl, pathSel, t) draws it on.
- MB.draw(tl, pathSel, t, {duration}) — stroke draw-on, timed to land on its anchor.
- MB.travel(tl, sel, [viaSel1, viaSel2, ...], t, {duration}) — moves an element (a packet) through the centers of other elements; the packet must share their positioned container.
- MB.countUp(tl, sel, to, t, {from, prefix, suffix, decimals, duration}).
- MB.type(tl, sel, t, {duration}) — types an element's text on.
- MB.emphasize(tl, sel, t, {scale, color}) — brief scale bump + accent color.

CANVAS UNITS (several Scenes): put everything inside <div id="<unitId>-world"> positioned absolute at left:0; top:0 with explicit px width and height. Inside it, give each Scene a region <div data-region="<sceneId>"> with explicit px left/top/width/height (about ${d.W - 2 * d.safe.x}×${d.safe.bottom - d.safe.top}), laid out ${format === "vertical" ? "top-to-bottom" : "left-to-right"} so the board reads as one continuous picture (connectors may cross between regions). OUR code moves the camera to frame each region at its Scene start — you never animate the world or the camera. A region's content can keep things from earlier regions in view; it is one board.

MOTION & LOOK (content bar: ByteMonk explainers; motion: ${p.motion.energy} energy, ${p.motion.character} character):
- Each element arrives on the word that names it; sequence reveals across the Scene, never dump everything at once.
- ${m.rules}
- No lazy breathing, no slow drifting pans. Something new should arrive or move at least every ~${p.motion.energy === "calm" ? 3 : p.motion.energy === "punchy" ? 1.5 : 2} s while the Scene is being explained; after the last reveal, hold still (a brief MB.emphasize on a later key word is fine${p.motion.energy === "punchy" ? "; this style likes frequent emphasis" : p.motion.energy === "calm" ? "; this style uses emphasis sparingly" : ""}).
- Diagrams: icon+label nodes on .mb-card, connectors (--line) that light up in --accent2 when data flows, --accent for the single most important thing. Big type, generous spacing, strong alignment, nothing cramped, nothing overlapping. Apply the style direction above.
- ${format === "vertical" ? "Vertical: stack content, big type (labels ≥ 40px), one focal element, use the full height of the safe area." : "Horizontal: use the width; diagrams left-to-right; comparisons side by side."}`;
};

export function scenePrompt(u: Unit & { anchors: Record<string, number>; sceneStarts: Record<string, number> }, sb: Storyboard, t: Transcript, feedback?: { previous: string; problems: string }): string {
  const outline = sb.scenes.map((s) => `${s.id} ${s.type}${s.canvas ? ` [canvas ${s.canvas}]` : ""}: ${s.intent}`).join("\n");
  const words = t.words.filter((w) => w.i >= u.scenes[0].from && w.i <= u.scenes[u.scenes.length - 1].to);
  const spoken = words.map((w) => `${(w.s - u.start).toFixed(2)}:${w.w}`).join(" ");
  const anchors = Object.entries(u.anchors).map(([k, v]) => `${k} @ ${v.toFixed(2)}s`).join("\n");
  return `Video outline (for context):
${outline}

YOUR UNIT: id "${u.id}", ${u.scenes.length > 1 ? `a Canvas with Scenes ${u.scenes.map((s) => s.id).join(", ")}` : "a single Scene"}. Duration S.dur = ${u.duration}s.
Scene start times within the unit: ${JSON.stringify(u.sceneStarts)}

Storyboard entries:
${JSON.stringify(u.scenes, null, 1)}

Anchors (at(id) returns these):
${anchors}

Spoken words with times relative to the unit start:
${spoken}
${feedback ? `\nYour previous code for this unit:\n${feedback.previous}\n\nIt failed these checks — fix every one, keep what worked:\n${feedback.problems}` : ""}`;
}

export const reviewSystem = (p: Preset) => `You are the visual reviewer for a motion-graphics video generator. You look at still frames of one unit (a Scene or a Canvas), taken after its elements have been revealed, and judge them against the Storyboard entry and the quality bar (ByteMonk-style explainer diagrams) in this video's style — "${p.name}": ${p.direction}
Report only concrete, fixable visual defects: overlapping or colliding elements, text clipped or overflowing its box, content outside the frame or (vertical) inside the bottom Captions band, unreadably small text or low-contrast text, a Storyboard element missing, connectors that don't touch their nodes, badly unbalanced or mostly empty composition, cramped layout, something that clearly breaks the style. The background, texture, fonts and hand-drawn wobble are deliberate. Do not nitpick taste. pass=true when there is nothing that a viewer would notice as broken or amateurish.`;

export const reviewPrompt = (u: Unit, stills: { path: string; at: string }[]) =>
  `Unit ${u.id}. Storyboard entries:\n${JSON.stringify(u.scenes, null, 1)}\n\nStills:\n${stills.map((s) => `- ${s.path} (${s.at})`).join("\n")}`;
