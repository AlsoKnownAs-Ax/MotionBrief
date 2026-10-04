import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StylePreset } from "../contract";
import type { FramePage } from "../modules/checker";
import type { Storyboard } from "../modules/storyboard";
import { bundledPreset } from "../modules/style";
import horizontalJson from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import verticalJson from "./fixtures/storyboard/vertical-captions.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";
import { CLOSE_TIMEOUT_MS, closeFrame, openFrame, type OpenFrame } from "./test-support/frame";

const vertical = verticalJson as Storyboard;
const horizontal = horizontalJson as Storyboard;

// The fixture Transcript's first words: "Every"@0.5 "website"@0.9 "you"@1.3 "open"@1.7 "sends"@2.1 "a"@2.5
// "request"@2.9 "further"@3.3 "than"@3.7 "you"@4.1 "think."@4.5 "That"@4.9 ...

type Caption = { text: string; top: number; bottom: number; left: number; right: number; fontFamily: string };

/** The caption lines on screen now, as the viewer sees them. */
function shownCaptions(page: FramePage) {
  return page.evaluate<Caption[]>(`[...document.querySelectorAll(".mb-caption")]
    .filter((line) => { const style = getComputedStyle(line); return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0; })
    .map((line) => { const box = line.getBoundingClientRect(); return { text: line.textContent, top: box.top, bottom: box.bottom, left: box.left, right: box.right, fontFamily: getComputedStyle(line).fontFamily }; })`);
}

/** Each word of the caption line on screen: its text, color, background and opacity. */
function shownWords(page: FramePage) {
  return page.evaluate<{ text: string; color: string; background: string; opacity: number }[]>(`(() => {
    const line = [...document.querySelectorAll(".mb-caption")].find((node) => { const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden"; });
    return line ? [...line.querySelectorAll(".mb-caption-word")].map((word) => { const style = getComputedStyle(word); return { text: word.textContent, color: style.color, background: style.backgroundColor, opacity: Number(style.opacity) }; }) : [];
  })()`);
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

  return `rgb(${r}, ${g}, ${b})`;
}

function inStyle(preset: StylePreset, captions: StylePreset["captions"]): StylePreset {
  return { ...preset, captions };
}

describe("Captions", () => {
  describe("in vertical, highlighting the current word (Blueprint)", () => {
    let frame: OpenFrame | undefined;
    const page = () => frame!.page;

    beforeAll(async () => {
      frame = await openFrame(vertical, transcript, {}, BLUEPRINT, { captions: true });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("shows the Transcript's words in short lines, breaking after sentences and clauses", async () => {
      const lines: string[] = [];

      for (const time of [0.6, 2.2, 3.8, 5.0, 7.0, 7.4]) {
        await page().seek(time);
        lines.push(...(await shownCaptions(page())).map(({ text }) => text));
      }

      expect(lines).toEqual(["Every website you open", "sends a request further", "than you think.", "That delay has a name:", "latency,", "the time between asking"]);
    });

    it("sits in the bottom band the frame keeps free of Scene content, in the Preset's display face", async () => {
      await page().seek(2.2);
      const [line] = await shownCaptions(page());

      expect(line?.top).toBeGreaterThanOrEqual(1500);
      expect(line?.bottom).toBeLessThanOrEqual(1920);
      expect(line?.left).toBeGreaterThanOrEqual(72);
      expect(line?.right).toBeLessThanOrEqual(1080 - 72);
      expect(line?.fontFamily).toContain(BLUEPRINT.typography.display.family);
    });

    it("marks the word being spoken in the accent, and the rest in ink", async () => {
      await page().seek(2.6);
      const words = await shownWords(page());

      expect(words.map(({ text, color }) => [text, color])).toEqual([
        ["sends", rgb(BLUEPRINT.palette.colors.ink)],
        ["a", rgb(BLUEPRINT.palette.colors.accent)],
        ["request", rgb(BLUEPRINT.palette.colors.ink)],
        ["further", rgb(BLUEPRINT.palette.colors.ink)],
      ]);
    });

    it("plays back the same after seeking backwards", async () => {
      await page().seek(3.4);
      await page().seek(2.2);
      const words = await shownWords(page());

      expect(words.map(({ color }) => color)).toEqual([rgb(BLUEPRINT.palette.colors.accent), ...Array.from({ length: 3 }, () => rgb(BLUEPRINT.palette.colors.ink))]);
    });

  });

  it(
    "hide a line soon after its last word when a pause follows",
    // The last line, "networking.", starts at 44.9; the Voiceover runs on in silence.
    async () => {
      const frame = await openFrame(vertical, { ...transcript, duration: 50 }, {}, BLUEPRINT, { captions: true });

      try {
        await frame.page.seek(45.5);
        const during = await shownCaptions(frame.page);
        await frame.page.seek(46.5);

        expect(during.map(({ text }) => text)).toEqual(["networking."]);
        expect(await shownCaptions(frame.page)).toEqual([]);
      } finally {
        await closeFrame(frame);
      }
    },
    BROWSER_TIMEOUT_MS,
  );

  describe("in vertical, popping each word in (Sketchbook)", () => {
    let frame: OpenFrame | undefined;
    const sketchbook = bundledPreset("sketchbook");
    const page = () => frame!.page;

    beforeAll(async () => {
      frame = await openFrame(vertical, transcript, {}, sketchbook, { captions: true });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("brings each word in as it is spoken, so later words aren't there yet", async () => {
      await page().seek(2.6);
      const words = await shownWords(page());

      expect(words.map(({ text, opacity }) => [text, opacity])).toEqual([
        ["sends", 1],
        ["a", 1],
        ["request", 0],
        ["further", 0],
      ]);
    });

    it("plays back the same after seeking backwards", async () => {
      await page().seek(3.6);
      await page().seek(2.6);

      expect((await shownWords(page())).map(({ opacity }) => opacity)).toEqual([1, 1, 0, 0]);
    });

    it("draws the words in the Preset's ink", async () => {
      await page().seek(3.6);

      expect(new Set((await shownWords(page())).map(({ color }) => color))).toEqual(new Set([rgb(sketchbook.palette.colors.ink)]));
    });
  });

  describe("in vertical, plain (Whiteboard)", () => {
    let frame: OpenFrame | undefined;
    const whiteboard = bundledPreset("whiteboard");
    const page = () => frame!.page;

    beforeAll(async () => {
      frame = await openFrame(vertical, transcript, {}, whiteboard, { captions: true });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("shows the whole line at once, every word alike in ink", async () => {
      await page().seek(2.2);
      const words = await shownWords(page());

      expect(words.map(({ text }) => text)).toEqual(["sends", "a", "request", "further"]);
      expect(words.every(({ color, opacity }) => color === rgb(whiteboard.palette.colors.ink) && opacity === 1)).toBe(true);
    });
  });

  describe("in horizontal", () => {
    let frame: OpenFrame | undefined;
    const page = () => frame!.page;

    beforeAll(async () => {
      frame = await openFrame(horizontal, transcript, {}, inStyle(BLUEPRINT, "plain"), { captions: true });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("runs longer lines along the bottom of the frame", async () => {
      await page().seek(2.2);
      const [line] = await shownCaptions(page());

      expect(line?.text).toBe("Every website you open sends a request");
      expect(line?.bottom).toBeLessThanOrEqual(1080 - 40);
      expect(line?.top).toBeGreaterThanOrEqual(900);
    });
  });

  it.each(["highlight", "pop", "plain"] as const)(
    "in the %s style pass lint, check and the contract over the Scenes they are drawn on",
    async (style) => {
      const rules = { ...RULES, format: "vertical" as const, captions: true };

      const report = await connect().checker.check({ storyboard: vertical, transcript, rules, preset: inStyle(BLUEPRINT, style), code: {} });

      expect(report.findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );
});
