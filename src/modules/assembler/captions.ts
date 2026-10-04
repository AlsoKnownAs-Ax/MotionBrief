import type { CaptionStyle, Format, Motion, StoryboardTranscript, StylePreset } from "../../contract";
import { FRAME_SIZES } from "../frame";

/** A word of a caption line, timed in seconds on the Voiceover: current from `start` until `end`. */
export type CaptionWord = { text: string; start: number; end: number };

/** A caption line: the words on screen together, from its first word until the next line or a pause. */
export type CaptionLine = { start: number; end: number; words: CaptionWord[] };

/**
 * How Captions sit in each Format. Vertical puts them in the band below the safe zone, which the frame
 * keeps free for them, in short lines read on a phone; horizontal runs one longer line along the bottom.
 */
const LAYOUT = {
  vertical: { fontSize: 64, maxChars: 24, position: (safeBottom: number) => `top: ${safeBottom + 48}px;` },
  horizontal: { fontSize: 46, maxChars: 44, position: () => "bottom: 44px;" },
} satisfies Record<Format, { fontSize: number; maxChars: number; position: (safeBottom: number) => string }>;

/** Caption lines play on their own track of the root composition, above the Scenes'. */
const CAPTIONS_TRACK = 20;

/** A line stays up this long after its last word starts when a pause follows, so Captions don't linger over silence. */
const HOLD_SECONDS = 1.2;

/** A word ending a sentence or clause; the next one starts a new line. */
const CLAUSE_END = /[.?!,;:–—-]["')\]”’]*$/;

/**
 * Breaks the Transcript into caption lines: a new line after a sentence or clause ends, or when the
 * next word would make the line longer than the Format allows. Each word is current until the next
 * one starts; a line ends when the next one starts, or soon after its last word when a pause follows.
 */
export function captionLines(transcript: StoryboardTranscript, format: Format): CaptionLine[] {
  const { maxChars } = LAYOUT[format];
  const groups = transcript.words.reduce<{ text: string; start: number }[][]>((lines, word, index) => {
    const line = lines.at(-1);
    const previous = transcript.words[index - 1];
    const length = (line ?? []).reduce((sum, { text }) => sum + text.length + 1, word.text.length);

    if (!line || (previous && CLAUSE_END.test(previous.text)) || length > maxChars) {
      return [...lines, [word]];
    }

    line.push(word);

    return lines;
  }, []);

  return groups.map((group, index) => {
    const first = group[0]!;
    const last = group.at(-1)!;
    const next = groups[index + 1]?.[0]?.start ?? transcript.duration;
    const end = seconds(Math.max(Math.min(next, last.start + HOLD_SECONDS), first.start + 0.1));

    return {
      start: seconds(first.start),
      end,
      words: group.map(({ text, start }, at) => ({ text, start: seconds(start), end: Math.min(seconds(group[at + 1]?.start ?? end), end) })),
    };
  });
}

/**
 * Captions on the root composition: each line a clip in the band the Format keeps for them, drawn in
 * the Preset's display face and Palette, with its words timed on the root timeline in the Preset's
 * caption style: the current word highlighted, each word popping in as it is spoken, or plain.
 */
export function captionsLayer({ transcript, format, preset }: { transcript: StoryboardTranscript; format: Format; preset: StylePreset }) {
  const lines = captionLines(transcript, format);

  return {
    css: captionsCss(format, preset),
    html: lines.map((line, index) => lineHtml(line, index, preset.captions)).join("\n"),
    js: captionsJs(lines, preset),
  };
}

function lineHtml(line: CaptionLine, index: number, style: CaptionStyle): string {
  const words = line.words.map(({ text }, at) => `<span id="mb-caption-${index}-${at}" class="mb-caption-word">${escapeHtml(text)}</span>`);

  return `<p id="mb-caption-${index}" class="clip mb-caption mb-caption-${style}" data-start="${line.start}" data-duration="${seconds(line.end - line.start)}" data-track-index="${CAPTIONS_TRACK}">${words.join(" ")}</p>`;
}

function captionsCss(format: Format, { palette, typography, treatments }: StylePreset): string {
  const { safe } = FRAME_SIZES[format];
  const { fontSize, position } = LAYOUT[format];
  const { display } = typography;

  return `.mb-caption {
  position: absolute; left: ${safe.x}px; right: ${safe.x}px; ${position(safe.bottom)}
  width: fit-content; margin: 0 auto; padding: .1em .4em;
  border-radius: ${Math.min(treatments.radius, 24)}px; background: color-mix(in srgb, ${palette.colors.bg} 80%, transparent);
  text-align: center; color: ${palette.colors.ink}; font-family: "${display.family}"; font-weight: ${display.weight};
  font-size: ${Math.round(fontSize * (display.scale ?? 1))}px; letter-spacing: ${display.tracking ?? "0"}; line-height: 1.18;
}
.mb-caption-word { display: inline-block; border-radius: .18em; padding: 0 .06em; }
.mb-caption-pop .mb-caption-word { opacity: 0; }`;
}

/** How a word pops in: with a little spring, except in stepped Motion, which snaps. */
const POP_EASE = { smooth: "back.out(2)", springy: "back.out(2)", snappy: "back.out(2)", stepped: "steps(2)" } satisfies Record<Motion["character"], string>;

/** How the current word looks: in the accent, or on it when the Palette keeps the accent to fills, as it is too faint to read as text. */
function currentWord({ palette }: StylePreset): { on: Record<string, string>; off: Record<string, string> } {
  const { ink, accent } = palette.colors;

  if (palette.fills?.includes("accent")) {
    return { on: { backgroundColor: accent }, off: { backgroundColor: "transparent" } };
  }

  return { on: { color: accent }, off: { color: ink } };
}

/**
 * Times the words on the root timeline `tl`: highlight marks each word current while it is spoken, pop
 * brings each word in as it starts, plain shows each line as it is. Every tween is seek-safe.
 */
function captionsJs(lines: CaptionLine[], preset: StylePreset): string {
  if (preset.captions === "plain") {
    return "";
  }

  const timing = JSON.stringify(lines.map(({ words }) => words.map(({ start, end }) => [start, end])));
  const word = `document.getElementById("mb-caption-" + line + "-" + at)`;

  if (preset.captions === "highlight") {
    const { on, off } = currentWord(preset);

    return `  ${timing}.forEach(function (words, line) {
    words.forEach(function (time, at) {
      var word = ${word};
      tl.set(word, ${JSON.stringify(on)}, time[0]);
      tl.set(word, ${JSON.stringify(off)}, time[1]);
    });
  });`;
  }

  const ease = POP_EASE[preset.motion.character];

  return `  ${timing}.forEach(function (words, line) {
    words.forEach(function (time, at) {
      tl.fromTo(${word}, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.16, ease: "${ease}", immediateRender: false }, Math.max(0, time[0] - 0.05));
    });
  });`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
