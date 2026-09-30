// PROTOTYPE: prompts for the Storyboard agent, the Scene-code subagents and the visual reviewer.
import { DIMS, type Format, type Unit } from "./frame.ts";
import type { Storyboard } from "./storyboard.ts";
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

const PACING = (format: Format) =>
  format === "vertical"
    ? "Vertical: Scenes change faster — about 2.5–6 s each (hard max 7 s), one focal element per Scene."
    : "Horizontal: about 3–8 s per Scene (hard max 10 s).";

export const storyboardSystem = (format: Format) => `You are the Storyboard author for MotionBrief, which turns a Voiceover into a motion-graphics YouTube video.
Quality bar: ByteMonk system-design explainers (clean dark diagrams, icon+label nodes, flows with packets, code panels, count-up stats) with Jamie Fenn-level smooth motion where every element arrives exactly when it is spoken.

You write the Storyboard: structured data only — no layout, no motion, no code. Another agent animates each Scene later.

Rules:
- A video is a sequence of Scenes. Each Scene is one visual composition covering a contiguous span of Transcript words [from, to]. Scenes tile the whole Transcript with no gaps and no overlap.
- Scene boundaries fall only at sentence or clause ends (words marked with . ? ! , ; : —). A Scene usually covers 1–2 sentences.
- ${PACING(format)}
- Pick one of the 9 Scene Types for each Scene; its content must follow that type's shape:
  hook (kinetic headline, optional kicker / quoted source card) · key-term (a term, short definition) · architecture (icon+label nodes and connectors, built up in narration order) · flow (a pipeline of steps with packets travelling along edges) · code (editor or terminal; typing or static; highlighted lines) · comparison (A vs B, before/after) · list (steps / items) · stat (count-up number or bar chart) · outro (call to action).
- Every content element has an id and an anchor "at": the index of the Transcript word on which it appears — the word that names it, or the first word of the phrase it illustrates. Anchors must lie inside the Scene's span. Spread anchors across the Scene; never anchor everything on the first word.
- On-screen copy is short motion-graphics copy (a label, a hero word, a number) — never a narration sentence. Numbers are shown as digits (say "one hundred fifty milliseconds" → value 150, unit "ms").
- Icons: "lucide:<name>" from the Lucide set (e.g. lucide:server, lucide:globe, lucide:database, lucide:user, lucide:laptop, lucide:shield, lucide:zap, lucide:clock, lucide:image, lucide:file-code, lucide:network, lucide:map-pin, lucide:hard-drive, lucide:cloud) or "brand:<simple-icons slug>" (e.g. brand:cloudflare, brand:github, brand:python). Only use names you are sure exist.
- Transitions: pick a small consistent transitionSet (2–3 kinds) for the whole video and use it. "camera" is the move between consecutive Scenes on one Canvas.
- Canvas: when consecutive Scenes build on the same picture (a diagram growing, a flow continuing, a system being explained part by part), put them on one Canvas (same "canvas" id) so the camera moves across one large board instead of cutting. Use Canvases where they help continuity; ${format === "vertical" ? "in vertical the camera mostly moves up/down." : "in horizontal the camera mostly moves sideways."}
- Format: ${format} (${DIMS[format].W}×${DIMS[format].H}). ${format === "vertical" ? "Stack things vertically, bigger type, fewer words per line, at most ~4 nodes/items per Scene. A bottom band is reserved for Captions." : "Wide diagrams and side-by-side comparisons work well."}
- "intent" is a one-line visual direction for the animator (what the viewer should see and the key move), not a restatement of the narration.`;

export const storyboardPrompt = (t: Transcript, format: Format, feedback?: string) =>
  `Transcript (word index:word; each line is one sentence, with its start time):
${transcriptText(t)}

Total duration: ${t.duration.toFixed(1)} s. Last word index: ${t.words.length - 1}. Format: ${format}.
Write the Storyboard.${feedback ? `\n\nYour previous Storyboard was rejected by the validator. Fix every problem:\n${feedback}` : ""}`;

export const sceneSystem = (format: Format) => {
  const d = DIMS[format];
  return `You write the HyperFrames (HTML/CSS/GSAP) code for one unit of a MotionBrief video: either one Scene, or one Canvas holding several consecutive Scenes. You work inside a frame we own. Output JSON {css, html, js}; we wrap it into the composition.

THE FRAME (already provided — do not re-create):
- Canvas ${d.W}×${d.H}. Safe area: x ${d.safe.x}–${d.W - d.safe.x}, y ${d.safe.top}–${d.safe.bottom}. ${format === "vertical" ? `Everything below y=${d.safe.bottom} is reserved for Captions — keep ALL content above it.` : `Keep all content inside the safe area.`}
- Background (dark navy with a faint dot grid) is already painted. Do not paint a full-screen background.
- CSS variables on the root: --bg --surface --surface2 --line --ink --muted --accent (orange: the ONE key thing) --accent2 (cyan) --accent3 (violet) --good --bad --radius; --safe-x --safe-top --safe-w --safe-h; type scale --fs-display --fs-title --fs-body --fs-label --fs-mono.
- Utility classes: .mb-safe (absolute box = the safe area) .mb-card (surface card with border+radius+shadow) .mb-display .mb-title .mb-body .mb-label .mb-mono .mb-accent .mb-icon .mb-wire (SVG connector layer).
- Fonts: only "Inter" (400/600/800) and "JetBrains Mono" (400/700). No other fonts.
- Icons: write <i data-icon="lucide:server" class="..." id="..."></i>; we replace it with an inline SVG sized 1em (set font-size to size it, color to color it). Use only the icon names from the Storyboard or well-known Lucide names.

YOUR HTML: markup that goes inside the composition root. Position with absolute boxes / flex / grid. Every element id you create must start with the unit id or a Scene id of this unit.

THE CONTRACT (checked automatically; failures come back to you):
1. Every Storyboard element exists in the DOM with id "<sceneId>-<elementId>" (e.g. s03-origin), is clearly arriving (effective opacity ≥ 0.3, inside the frame, non-zero size) by its anchor + 0.1 s and stays visible, and is NOT visible before its anchor − 0.3 s. MB.reveal already starts 50 ms early so it lands on the word. Use at("<sceneId>-<elementId>") for its reveal time. Never write absolute seconds for a Storyboard element.
2. Your JS runs with these in scope: tl (the paused GSAP timeline to add to), at(id) (seconds, relative to this unit's start), S (S.dur = unit length in s, S.words = [[word, seconds], ...] for extra word-sync, S.sceneStarts = {sceneId: seconds}). Build synchronously. Do not create or register another timeline.
3. Seek-safe GSAP only: entrances with fromTo (or the MB helpers); no repeat/yoyo, no Math.random, no Date, no CSS transitions or @keyframes, no setTimeout. Never tween display/visibility. No exit animations — our Transitions are the exit. Don't put a CSS transform on an element you animate with GSAP (use fromTo from-values instead). Don't use the class name "clip". Don't style #root.
4. Every line that connects two elements (edges, arrows, leader lines to callouts, return paths) is an SVG <path> placed with MB.connect — never hand-computed coordinates; hand-placed lines end up detached from their nodes. Labels for a connector sit next to its midpoint.
5. Text must not overlap other text unless deliberately layered (e.g. a flip/stack effect): then mark the layered element with data-layout-allow-overlap. Calling getTotalLength() on a path needs its d set first (MB.connect sets it).
6. No narration sentences as on-screen text. Copy comes from the Storyboard content.

HELPERS (window.MB — prefer them):
- MB.reveal(tl, target, t, style, {duration, stagger, ease, from}) — style: rise|drop|left|right|pop|fade|blur|wipe.
- MB.connect(pathSel, fromSel, toSel, {curve, gap}) — sets an SVG <path>'s d between two elements' box edges. The <svg class="mb-wire"> must be a direct child of the common positioned container of both elements. Then MB.draw(tl, pathSel, t) draws it on.
- MB.draw(tl, pathSel, t, {duration}) — stroke draw-on.
- MB.travel(tl, sel, [viaSel1, viaSel2, ...], t, {duration}) — moves an element (a packet) through the centers of other elements; the packet must share their positioned container.
- MB.countUp(tl, sel, to, t, {from, prefix, suffix, decimals, duration}).
- MB.type(tl, sel, t, {duration}) — types an element's text on.
- MB.emphasize(tl, sel, t, {scale, color}) — brief scale bump + accent color.

CANVAS UNITS (several Scenes): put everything inside <div id="<unitId>-world"> positioned absolute at left:0; top:0 with explicit px width and height. Inside it, give each Scene a region <div data-region="<sceneId>"> with explicit px left/top/width/height (about ${d.W - 2 * d.safe.x}×${d.safe.bottom - d.safe.top}), laid out ${format === "vertical" ? "top-to-bottom" : "left-to-right"} so the board reads as one continuous picture (connectors may cross between regions). OUR code moves the camera to frame each region at its Scene start — you never animate the world or the camera. A region's content can keep things from earlier regions in view; it is one board.

MOTION & LOOK (the quality bar is ByteMonk explainers with Jamie Fenn-smooth motion):
- Each element arrives on the word that names it; sequence reveals across the Scene, never dump everything at once.
- Smooth long-tail easing (power3.out / power2.inOut). No bounce, no elastic, no back easing.
- No lazy breathing, no slow drifting pans. Something new should arrive or move at least every ~2 s while the Scene is being explained; after the last reveal, hold still (a brief MB.emphasize on a later key word is fine).
- Clean dark diagrams: icon+label nodes on .mb-card, thin connector lines (--line) that light up in --accent2 when data flows, orange --accent for the single most important thing. Big bold type, generous spacing, strong alignment, nothing cramped, nothing overlapping.
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

export const reviewSystem = `You are the visual reviewer for a motion-graphics video generator. You look at still frames of one unit (a Scene or a Canvas), taken after its elements have been revealed, and judge them against the Storyboard entry and the quality bar (ByteMonk-style clean dark diagrams).
Report only concrete, fixable visual defects: overlapping or colliding elements, text clipped or overflowing its box, content outside the frame or (vertical) inside the bottom Captions band, unreadably small text, a Storyboard element missing, connectors that don't touch their nodes, badly unbalanced or mostly empty composition, cramped layout, off-style colors. Do not nitpick taste. pass=true when there is nothing that a viewer would notice as broken or amateurish.`;

export const reviewPrompt = (u: Unit, stills: { path: string; at: string }[]) =>
  `Unit ${u.id}. Storyboard entries:\n${JSON.stringify(u.scenes, null, 1)}\n\nStills:\n${stills.map((s) => `- ${s.path} (${s.at})`).join("\n")}`;
