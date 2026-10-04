import type { CheckFinding, Format, StoryboardIssue, StoryboardRules, StylePreset, Transcript } from "../../contract";
import type { Unit } from "../assembler";
import { FRAME_SIZES } from "../frame";
import type { Storyboard } from "../storyboard";
import { pacingFor, type PresetBrief } from "../style";

/**
 * What the agents are told. The Storyboard agent plans structure and content only; each Scene-code
 * subagent writes one unit inside the frame, which owns tokens, treatments, timing and Transitions.
 * Tuned in the spike (#7) and the Style Preset spike; the rules the code checks are stated here so
 * the agent meets them on its first try, and every check failure goes back to it as written.
 */

export const STORYBOARD_TOOL = "submit_storyboard";
export const SCENE_CODE_TOOL = "submit_scene_code";

/** Ends a sentence, optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.?!]["')\]”’]*$/;

export function storyboardSystem({ format, captions }: StoryboardRules, brief: PresetBrief): string {
  const { width, height } = FRAME_SIZES[format];
  const { min, max } = pacingFor(format, "balanced");

  return `You are the Storyboard author for MotionBrief, which turns a Voiceover into a motion-graphics explainer video.
The quality bar is diagram-heavy system-design explainers where every node, code line and number appears exactly when it is spoken.

You write the Storyboard: structured content only, with no layout, no motion and no code. Other agents animate each Scene later, inside a frame MotionBrief owns. Hand it in with the ${STORYBOARD_TOOL} tool; MotionBrief validates it when your turn ends and sends back every issue to fix.

Rules:
- The video is a sequence of Scenes. Each Scene covers a contiguous span of Transcript words, from "from" to "to" (both word indexes, inclusive). Scenes tile the whole Transcript: the first starts at word 0, each starts right after the one before, and the last ends at the last word.
- Scenes break only after a word that ends a sentence or clause (. ? ! , ; : or a dash). A Scene usually covers one or two sentences.
- Pacing: a ${format} Scene lasts ${min}-${max} s. A Scene starts 0.25 s before its first word and lasts until the next Scene starts.
- Each Scene has one of the 9 Scene Types, and its content follows that type's shape: hook (a kinetic headline, an optional kicker or quoted source), key-term (a term and a short definition), architecture-diagram (icon and label nodes joined by edges, built up in narration order), flow (steps with packets travelling along edges), code (an editor or terminal with highlighted lines), comparison (two sides, an optional verdict), list (items), stat-chart (a count-up number or bars), outro (a closing headline and call to action).
- Every content element has an id and "at": the index of the Transcript word it appears on, the word that names it or starts the phrase it illustrates. Anchors lie inside the Scene's span. Spread them across the Scene; never put everything on its first word.
- Timing is only ever word indexes, never seconds.
- On-screen copy is short motion-graphics copy (a label, a hero word, a number), never a narration sentence. Numbers are digits: "two hundred milliseconds" is value 200 with unit "ms".
- Icons: "lucide:<name>" from Lucide (lucide:server, lucide:database, lucide:globe, lucide:user, lucide:laptop, lucide:shield, lucide:zap, lucide:clock, lucide:cloud, lucide:network, lucide:hard-drive) or "brand:<simple-icons slug>" (brand:github, brand:cloudflare, brand:python). Only use names you are sure exist.
- Every Scene but the last names the Transition into the next Scene.
- Format: ${format} (${width}x${height}). ${FORMAT_NOTES[format]}
- ${captionsRule(captions)}

${brief.storyboard}`;
}

const FORMAT_NOTES = {
  horizontal: "Wide diagrams and side-by-side comparisons work well.",
  vertical: "Stack things, keep at most about 4 nodes or items per Scene. A bottom band is reserved for Captions.",
} satisfies Record<Format, string>;

function captionsRule(captions: boolean): string {
  if (captions) {
    return "Captions are on: they show every spoken word, so on-screen copy is labels, numbers or hero words of a few words, never sentences.";
  }

  return "Captions are off.";
}

/** The Transcript as the Storyboard agent reads it: each sentence on a line with its start time, every word with its index. */
export function storyboardMessage(transcript: Transcript): string {
  const sentences = transcript.words.reduce<{ start: number; words: string[] }[]>((lines, word, index) => {
    const line = lines.at(-1);
    const entry = `${index}:${word.text}`;

    if (!line || SENTENCE_END.test(transcript.words[index - 1]?.text ?? "")) {
      lines.push({ start: word.start, words: [entry] });
      return lines;
    }

    line.words.push(entry);
    return lines;
  }, []);

  return `Transcript (index:word; one sentence per line, with the time it starts):
${sentences.map(({ start, words }) => `[${start.toFixed(1)} s] ${words.join(" ")}`).join("\n")}

The Voiceover lasts ${transcript.duration.toFixed(1)} s; the last word is ${transcript.words.length - 1}.
Write the Storyboard and hand it in with ${STORYBOARD_TOOL}.`;
}

export function storyboardIssuesMessage(issues: StoryboardIssue[]): string {
  return `The validator rejected the Storyboard. Fix every issue and hand in the whole Storyboard again with ${STORYBOARD_TOOL}:
${issues.map(issueLine).join("\n")}`;
}

function issueLine({ code, sceneId, field, message }: StoryboardIssue): string {
  const where = [sceneId, field].filter(Boolean).join(" ");

  return `- [${code}]${where ? ` ${where}:` : ""} ${message}`;
}

export function noStoryboardMessage(): string {
  return `No Storyboard was handed in. Hand in the whole Storyboard with the ${STORYBOARD_TOOL} tool.`;
}

/**
 * The frame and the motion doctrine: what Scene code may use, what it must never do, and what it is
 * checked against. Followed by the Style Preset's own direction for Scene code.
 */
export function sceneCodeSystem(format: Format, brief: PresetBrief): string {
  const { width, height, safe } = FRAME_SIZES[format];

  return `You write the HyperFrames (HTML, CSS and GSAP) code for one unit of a MotionBrief video: one Scene, or the Scenes sharing one Canvas. You work inside a frame MotionBrief owns, and hand in {css, html, js} with the ${SCENE_CODE_TOOL} tool; MotionBrief wraps it into the unit's composition and checks it when your turn ends.

THE FRAME (already there; never re-create it):
- The unit is ${width}x${height}. Content stays in the safe area: x ${safe.x}-${width - safe.x}, y ${safe.top}-${safe.bottom}.${format === "vertical" ? ` Below y ${safe.bottom} is reserved for Captions: keep everything above it.` : ""}
- The background, its treatment and any texture are painted by the frame. Never paint a full-frame background.
- Tokens, as CSS variables: colors --bg --bg2 --surface --surface2 --line --ink --muted --accent (the one key thing) --accent2 --accent3 --good --bad; fonts --font-display --font-body --font-label --font-mono; type sizes --fs-display --fs-title --fs-body --fs-label --fs-mono; --radius; the safe area --safe-x --safe-top --safe-w --safe-h.
- Classes: .mb-safe (an absolute box over the safe area), .mb-card (a surface in the Style Preset's treatment), .mb-display .mb-title .mb-body .mb-label .mb-mono (type), .mb-accent, .mb-icon, .mb-wire (an SVG connector layer).
- Colors and fonts come only from the tokens: no hex, rgb(), hsl() or color names, and no font-family but var(--font-*). Tints are color-mix(in srgb, var(--accent) 20%, transparent).
- Icons: <i data-icon="lucide:server"></i> becomes an inline SVG 1em in size; set font-size to size it and color to color it.

YOUR HTML goes inside the unit's root. Lay it out with absolute boxes, flex or grid. Every id you create starts with this unit's id or one of its Scene ids.

THE CONTRACT (checked; failures come back to you):
1. Every Storyboard element exists with the DOM id "<sceneId>-<elementId>" (s03-origin), is clearly arriving (opacity at least 0.3, inside the frame, a real size) by its anchor + 0.1 s and stays visible, and is hidden before its anchor - 0.3 s. Time its entrance with at("<sceneId>-<elementId>"); MB.reveal starts 50 ms early so it lands on the word. Never write seconds for a Storyboard element.
2. Your JS runs with tl (the unit's paused GSAP timeline: add to it), at(id) (seconds from the unit's start) and S (S.duration; S.sceneStarts, each Scene's start in seconds). Build synchronously; never create or register another timeline.
3. Seek-safe only: entrances with fromTo or the MB helpers; no repeat or yoyo, no Math.random, no Date, no CSS transitions or @keyframes, no timers. Never tween display or visibility. No exit animations: the Transitions are MotionBrief's. Don't put a CSS transform on an element you animate. Don't use the class name "clip". Don't style #root.
4. Every line between two elements is an SVG <path> laid out with MB.connect, never hand-computed coordinates; a connector's label sits by its midpoint.
5. Text never overlaps other text or sits under an icon or image, unless it is deliberately layered: mark that element data-layout-allow-overlap.
6. On-screen copy comes from the Storyboard content, never narration sentences.

HELPERS (window.MB; prefer them, their defaults follow the Style Preset's Motion):
- MB.reveal(tl, target, time, style, {duration, stagger, ease}): style rise, drop, left, right, pop, fade, blur or wipe.
- MB.connect(path, from, to, {curve, gap}): lays an SVG <path> between two elements' box edges; its <svg class="mb-wire"> is a direct child of their common positioned container. Then MB.draw(tl, path, time) draws it on.
- MB.draw(tl, target, time, {duration}): draws SVG strokes on.
- MB.travel(tl, target, [via, ...], time, {duration}): moves an element (a packet) through the centres of others in its container.
- MB.countUp(tl, target, value, time, {from, prefix, suffix, decimals, duration}).
- MB.type(tl, target, time, {duration}): types an element's text on.
- MB.emphasize(tl, target, time, {scale}): a brief bump in the accent color.

A CANVAS UNIT (several Scenes): put everything in <div id="<unitId>-world"> at left 0, top 0 with an explicit px size, and give each Scene a region <div data-region="<sceneId>"> with explicit px left, top, width and height, laid out ${format === "vertical" ? "top to bottom" : "left to right"} as one continuous picture. MotionBrief moves the camera between regions; never animate the world or the camera.

MOTION AND LOOK:
- Each element arrives on the word that names it; sequence reveals across the Scene, never everything at once.
- Something new arrives or moves at least every 2 s while the Scene explains; after the last reveal, hold still (a brief MB.emphasize on a later key word is fine). No idle breathing, no slow drifting pans.
- Big, bold type, generous spacing, strong alignment; nothing cramped, nothing overlapping.
- ${format === "vertical" ? "Vertical: stack content, labels at least 40 px, one focal element, use the full height of the safe area." : "Horizontal: use the width; diagrams run left to right, comparisons side by side."}

${brief.sceneCode}`;
}

/** What a Scene-code subagent writes from: the Storyboard, the Style Preset, its own entries, and exact anchor and spoken-word times. */
export function unitMessage({ storyboard, preset, unit, transcript }: { storyboard: Storyboard; preset: StylePreset; unit: Unit; transcript: Transcript }): string {
  const first = unit.scenes[0]?.from ?? 0;
  const last = unit.scenes.at(-1)?.to ?? first;
  const spoken = transcript.words
    .slice(first, last + 1)
    .map(({ text, start }) => `${seconds(start - unit.start)} ${text}`)
    .join("\n");
  const anchors = Object.entries(unit.anchors)
    .map(([id, time]) => `${id} @ ${seconds(time)} s`)
    .join("\n");
  const scenes = unit.scenes.map(({ id }) => id).join(", ");

  return `The whole Storyboard, for context:
${JSON.stringify(storyboard, null, 1)}

The Style Preset (reach its colors and fonts only through the tokens):
${JSON.stringify(presetForCode(preset), null, 1)}

YOUR UNIT: "${unit.id}", ${unit.scenes.length > 1 ? `a Canvas with Scenes ${scenes}` : "a lone Scene"}. It lasts ${seconds(unit.duration)} s (S.duration).
Scene starts within the unit, in seconds: ${JSON.stringify(unit.sceneStarts)}

Its Storyboard entries:
${JSON.stringify(unit.scenes, null, 1)}

Anchors (what at(id) returns, in seconds from the unit's start):
${anchors}

Spoken words, in seconds from the unit's start:
${spoken}

Write the unit and hand it in with ${SCENE_CODE_TOOL}.`;
}

export function findingsMessage(findings: CheckFinding[]): string {
  return `The checks failed. Fix every problem, keep what worked, and hand in the whole unit again with ${SCENE_CODE_TOOL}:
${findings.map(findingLine).join("\n")}`;
}

export function noCodeMessage(): string {
  return `No code was handed in. Hand in the unit's {css, html, js} with the ${SCENE_CODE_TOOL} tool.`;
}

export function findingLine({ source, code, message, selector, time }: CheckFinding): string {
  const where = [selector, time === undefined ? undefined : `at ${seconds(time)} s`].filter(Boolean).join(", ");

  return `- [${source} ${code}] ${message}${where ? ` (${where})` : ""}`;
}

/** The Preset as Scene code may use it: Palette roles and fonts by token, never their values. */
function presetForCode({ name, palette, typography, treatments, motion, direction }: StylePreset) {
  return {
    name,
    palette: { mode: palette.mode, roles: Object.keys(palette.colors).map((role) => `var(--${role})`) },
    typography: Object.fromEntries((["display", "body", "label", "mono"] as const).map((role) => [role, `var(--font-${role}), ${typography[role].family} ${typography[role].weight}`])),
    treatments,
    motion,
    direction,
  };
}

function seconds(value: number): string {
  return value.toFixed(2);
}
