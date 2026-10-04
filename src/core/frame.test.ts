import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StoryboardTranscript, UnitCode } from "../contract";
import type { FramePage } from "../modules/checker";
import { inlineIcons } from "../modules/frame";
import type { Storyboard } from "../modules/storyboard";
import storyboardJson from "./fixtures/checker/storyboard.json";
import transcript from "./fixtures/checker/transcript.json";
import horizontalJson from "./fixtures/storyboard/horizontal.json";
import longTranscript from "./fixtures/storyboard/transcript.json";
import verticalJson from "./fixtures/storyboard/vertical-captions.json";
import { BLUEPRINT } from "./test-support/checker";
import { CLOSE_TIMEOUT_MS, closeFrame, FRAME_TIMEOUT_MS as BROWSER_TIMEOUT_MS, openFrame as openPresetFrame, type OpenFrame } from "./test-support/frame";

const storyboard = storyboardJson as Storyboard;
const vertical = verticalJson as Storyboard;
const horizontal = horizontalJson as Storyboard;

/** Assembles a Storyboard's units in the frame, in Blueprint, and opens the page; units without code are fallback Scenes. */
function openFrame(board: Storyboard, words: StoryboardTranscript, code: Record<string, UnitCode>): Promise<OpenFrame> {
  return openPresetFrame(board, words, code, BLUEPRINT);
}

async function unitCode(unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(
    ["css", "html", "js"].map((part) => readFile(join(import.meta.dirname, "fixtures", "checker", "good", `${unit}.${part}`), "utf8")),
  );

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

type Box = { x: number; y: number; width: number; height: number };

function opacityOf(page: FramePage, selector: string) {
  return page.evaluate<number>(`Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity)`);
}

/** How much of a connector's stroke is drawn on, 0 to 1. */
function drawnOf(page: FramePage, id: string) {
  return page.evaluate<number>(`window.__mbProbe(${JSON.stringify(id)}, 1920, 1080).drawn`);
}

describe("the frame, in a headless browser", () => {
  describe("with hand-written Scene code", () => {
    let frame: OpenFrame | undefined;

    beforeAll(async () => {
      frame = await openFrame(storyboard, transcript, { s01: await unitCode("s01"), s02: await unitCode("s02") });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    const page = () => frame!.page;

    describe("tokens", () => {
      it("exposes every Palette role as a CSS variable", async () => {
        await page().seek(2);

        const palette = await page().evaluate<Record<string, string>>(
          `(() => { const s = getComputedStyle(document.querySelector("#s01-browser")); return Object.fromEntries(["bg", "bg2", "surface", "surface2", "line", "ink", "muted", "accent", "accent2", "accent3", "good", "bad"].map((role) => [role, s.getPropertyValue("--" + role).trim()])); })()`,
        );

        expect(palette).toEqual({
          bg: "#070b14",
          bg2: "#0d1424",
          surface: "#111a2e",
          surface2: "#17223b",
          line: "#2a3a5c",
          ink: "#eef3fb",
          muted: "#93a1bd",
          accent: "#ff7a3d",
          accent2: "#38bdf8",
          accent3: "#a78bfa",
          good: "#22c55e",
          bad: "#f43f5e",
        });
      });

      it("sets the typography roles from the tokens", async () => {
        await page().seek(6);

        const display = await page().evaluate<{ family: string; weight: string }>(
          `(() => { const s = getComputedStyle(document.querySelector("#s02-round-trip")); return { family: s.fontFamily, weight: s.fontWeight }; })()`,
        );
        const fonts = await page().evaluate<Record<string, string>>(
          `(() => { const s = getComputedStyle(document.querySelector("#s01-browser")); return Object.fromEntries(["display", "body", "label", "mono"].map((role) => [role, s.getPropertyValue("--font-" + role).trim()])); })()`,
        );

        expect(display).toEqual({ family: "Inter", weight: "800" });
        expect(fonts).toEqual({ display: '"Inter"', body: '"Inter"', label: '"Inter"', mono: '"JetBrains Mono"' });
      });

      it("loads its fonts from the bundled files, with no network", async () => {
        const loaded = await page().evaluate<string[]>(
          `Promise.all([document.fonts.load('800 40px Inter'), document.fonts.load('400 30px "JetBrains Mono"')]).then((sets) => sets.flat().filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "") + " " + face.weight))`,
        );

        expect(loaded).toEqual(expect.arrayContaining(["Inter 800", "JetBrains Mono 400"]));
      });
    });

    describe("safe zones", () => {
      it("keeps horizontal Scene content inside 120 px sides, 100 px top and a reserved bottom from 980 px", async () => {
        await page().seek(2);

        expect(await page().evaluate<Box>(safeZoneOf("s01-browser"))).toEqual({ x: 120, y: 100, width: 1680, height: 880 });
      });
    });

    it("carries its contract version", async () => {
      expect(await page().evaluate<string>("MB.version")).toBe("1.0.0");
    });

    describe("at(id)", () => {
      it("gives an anchor's time from the start of its Scene's unit, injected at assembly", async () => {
        const anchors = await page().evaluate<number[]>(`[MB.scene("s01").at("s01-browser"), MB.scene("s02").at("s02-round-trip")]`);

        // "browser" is spoken at 0.55 s in a unit from 0; "two" at 5.7 s in a unit from 5.7 − 1.3 − 0.25 = 4.15.
        expect(anchors).toEqual([0.55, 1.55]);
      });

      it("refuses an id the Storyboard doesn't have", async () => {
        const message = await page().evaluate<string>(`(() => { try { MB.scene("s01").at("s01-cache"); return ""; } catch (error) { return error.message; } })()`);

        expect(message).toBe("MB: no anchor for s01-cache in s01");
      });
    });

    describe("MB.reveal", () => {
      // #s01-browser rises on "browser", spoken at 0.55 s, over 0.5 s.
      it("starts 50 ms before the word", async () => {
        await page().seek(0.45);
        const before = await opacityOf(page(), "#s01-browser");
        await page().seek(0.55);
        const onWord = await opacityOf(page(), "#s01-browser");

        expect(before).toBe(0);
        expect(onWord).toBeGreaterThan(0);
      });

      it("eases out, so the element is clearly there by the word + 0.1 s and mostly there halfway", async () => {
        await page().seek(0.65);
        const arriving = await opacityOf(page(), "#s01-browser");
        await page().seek(0.75);
        const halfway = await opacityOf(page(), "#s01-browser");

        expect(arriving).toBeGreaterThanOrEqual(0.3);
        expect(halfway).toBeGreaterThan(0.7);
      });
    });

    describe("MB.draw", () => {
      // #s01-browser-server draws on "server,", spoken at 1.45 s.
      it("starts 50 ms before the word and is over 30% drawn by the word + 0.1 s", async () => {
        await page().seek(1.35);
        const before = await drawnOf(page(), "s01-browser-server");
        await page().seek(1.45);
        const onWord = await drawnOf(page(), "s01-browser-server");
        await page().seek(1.55);
        const arriving = await drawnOf(page(), "s01-browser-server");

        expect(before).toBe(0);
        expect(onWord).toBeGreaterThan(0);
        expect(arriving).toBeGreaterThanOrEqual(0.3);
      });
    });

    describe("MB.connect", () => {
      it("lays a connector out between the two elements' box edges, 14 px out, from the measured layout", async () => {
        await page().seek(4);

        const layout = await page().evaluate<{ d: string; marked: boolean; from: Box; to: Box }>(
          `(() => {
            const path = document.querySelector("#s01-browser-server");
            const box = (id) => { const e = document.querySelector(id); return { x: e.offsetLeft, y: e.offsetTop, width: e.offsetWidth, height: e.offsetHeight }; };
            return { d: path.getAttribute("d"), marked: path.hasAttribute("data-mb-connect"), from: box("#s01-browser"), to: box("#s01-server") };
          })()`,
        );
        const [startX, startY, endX, endY] = (layout.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

        expect(layout.marked).toBe(true);
        expect(startX).toBeCloseTo(layout.from.x + layout.from.width + 14, 1);
        expect(startY).toBeCloseTo(layout.from.y + layout.from.height / 2, 1);
        expect(endX).toBeCloseTo(layout.to.x - 14, 1);
        expect(endY).toBeCloseTo(layout.to.y + layout.to.height / 2, 1);
      });
    });

    describe("icons", () => {
      it("inlines a Lucide icon in a 1em box, keeping the sizes of its inner shapes", async () => {
        await page().seek(4);

        const icon = await page().evaluate<{ className: string; size: Box; fontSize: string; rects: { width: string | null; box: number }[] }>(
          `(() => {
            const svg = document.querySelector("#s01-server svg");
            const r = svg.getBoundingClientRect();
            return {
              className: svg.getAttribute("class"),
              size: { x: 0, y: 0, width: r.width, height: r.height },
              fontSize: getComputedStyle(svg).fontSize,
              rects: [...svg.querySelectorAll("rect")].map((rect) => ({ width: rect.getAttribute("width"), box: rect.getBBox().width })),
            };
          })()`,
        );

        expect(icon.className).toBe("mb-icon node-icon");
        expect(icon.fontSize).toBe("64px");
        expect(icon.size).toEqual({ x: 0, y: 0, width: 64, height: 64 });
        expect(icon.rects).toEqual([
          { width: "20", box: 20 },
          { width: "20", box: 20 },
        ]);
      });

      it("inlines a Simple Icons brand logo drawn in the text color", async () => {
        await page().seek(8);

        const logo = await page().evaluate<{ fill: string | null; color: string; iconColor: string }>(
          `(() => { const svg = document.querySelector("#s02-hit svg"); return { fill: svg.getAttribute("fill"), color: getComputedStyle(svg).fill, iconColor: getComputedStyle(svg).color }; })()`,
        );

        expect(logo.fill).toBe("currentColor");
        expect(logo.color).toBe(logo.iconColor);
      });

      it("reports an icon name that isn't bundled and leaves nothing in its place", async () => {
        const { html, unknownIcons } = await inlineIcons('<p><i data-icon="lucide:no-such-icon" class="x"></i>Cache</p>');

        expect(html).toBe("<p>Cache</p>");
        expect(unknownIcons).toEqual(["lucide:no-such-icon"]);
      });
    });
  });

  describe("the fallback Scene", () => {
    let frame: OpenFrame | undefined;

    beforeAll(async () => {
      frame = await openFrame(storyboard, transcript, {});
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    const page = () => frame!.page;

    it("shows each element of a Scene's content as plain text in the Preset's tokens", async () => {
      await page().seek(4);

      const lines = await page().evaluate<{ text: string; color: string }[]>(
        `["#s01-browser", "#s01-server", "#s01-database", "#s01-browser-server", "#s01-server-database"].map((id) => { const e = document.querySelector(id); return { text: e.textContent, color: getComputedStyle(e).color }; })`,
      );

      // Blueprint's ink, #eef3fb.
      const ink = "rgb(238, 243, 251)";
      expect(lines).toEqual([
        { text: "Browser", color: ink },
        { text: "Server", color: ink },
        { text: "Database", color: ink },
        { text: "Browser → Server", color: ink },
        { text: "Server → Database", color: ink },
      ]);
    });

    it("reveals each element on its word", async () => {
      // "two" is spoken at 5.7 s: the number is hidden 0.3 s before and arriving 0.1 s after.
      await page().seek(5.4);
      const before = await opacityOf(page(), "#s02-round-trip");
      await page().seek(5.8);
      const after = await opacityOf(page(), "#s02-round-trip");

      expect(before).toBe(0);
      expect(after).toBeGreaterThanOrEqual(0.3);
    });

    it("writes a stat as its number, unit and label", async () => {
      expect(await page().evaluate<string>(`document.querySelector("#s02-round-trip").textContent`)).toBe("200ms round trip");
    });
  });

  describe("Transitions", () => {
    let frame: OpenFrame | undefined;
    /** The fixture with s04's first element on its first word, "The", for the camera to land before. */
    const firstWord = structuredClone(horizontal);
    const s04 = firstWord.scenes[3]!;

    if (s04.type === "flow") {
      s04.content.steps[0]!.at = 38;
    }

    beforeAll(async () => {
      frame = await openFrame(firstWord, longTranscript, {});
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    const page = () => frame!.page;

    // s01 cuts to s02, which starts 0.25 s before "That", spoken at 4.9 s.
    it("cut: the next Scene replaces the last one at its start", async () => {
      await page().seek(4.6);
      const before = [await effectiveOpacity(page(), "#s01-headline"), await effectiveOpacity(page(), "#s02-bg")];
      await page().seek(4.7);
      const after = [await effectiveOpacity(page(), "#s01-headline"), await effectiveOpacity(page(), "#s02-bg")];

      expect(before).toEqual([1, 0]);
      expect(after).toEqual([0, 1]);
    });

    // s02 crossfades into the Canvas c1, which starts 0.25 s before "Your", spoken at 10.5 s, over 0.5 s.
    it("crossfade: the two Scenes fade through each other over half a second from the next Scene's start", async () => {
      await page().seek(10.2);
      const before = [await effectiveOpacity(page(), "#s02-term"), await effectiveOpacity(page(), "#c1-bg")];
      await page().seek(10.5);
      const halfway = [await effectiveOpacity(page(), "#s02-term"), await effectiveOpacity(page(), "#c1-bg")];
      await page().seek(10.8);
      const after = [await effectiveOpacity(page(), "#s02-term"), await effectiveOpacity(page(), "#c1-bg")];

      expect(before).toEqual([1, 0]);
      expect(halfway[0]).toBeCloseTo(0.5, 1);
      expect(halfway[1]).toBeCloseTo(0.5, 1);
      expect(after).toEqual([0, 1]);
    });

    it("crossfade: plays back the same after seeking backwards", async () => {
      await page().seek(11);
      await page().seek(10.5);
      const halfway = [await effectiveOpacity(page(), "#s02-term"), await effectiveOpacity(page(), "#c1-bg")];

      expect(halfway[0]).toBeCloseTo(0.5, 1);
      expect(halfway[1]).toBeCloseTo(0.5, 1);
    });

    // s03 and s04 share the Canvas c1, side by side; s04 starts 0.25 s before "The", spoken at 15.7 s.
    // The camera moves over 0.9 s and lands 50 ms before that word, at 15.65 s.
    it("camera: rests on the first Scene's region, then moves across the Canvas to the next one before its first word", async () => {
      await page().seek(14.7);
      const resting = [(await rectOf(page(), '[data-region="s03"]')).x, (await rectOf(page(), '[data-region="s04"]')).x];
      await page().seek(15.2);
      const moving = (await rectOf(page(), '[data-region="s04"]')).x;
      await page().seek(15.7);
      const arrived = [(await rectOf(page(), '[data-region="s03"]')).x, (await rectOf(page(), '[data-region="s04"]')).x];

      expect(resting).toEqual([0, 1920]);
      expect(moving).toBeGreaterThan(0);
      expect(moving).toBeLessThan(1920);
      expect(arrived).toEqual([-1920, 0]);
    });

    it("camera: has landed when an element on the next Scene's first word arrives, wholly in the frame", async () => {
      // #s04-server is anchored to "The", s04's first word, in this page's Storyboard.
      await page().seek(15.8);
      const server = await rectOf(page(), "#s04-server");

      expect(server.x).toBeGreaterThanOrEqual(120);
      expect(server.x + server.width).toBeLessThanOrEqual(1800);
      expect(await effectiveOpacity(page(), "#s04-server")).toBeGreaterThanOrEqual(0.3);
    });

    // The Canvas c1 pushes left into s05, which starts 0.25 s before "In", spoken at 21.7 s, over 0.55 s.
    it("push-left: the next Scene pushes the last one out to the left", async () => {
      await page().seek(21.4);
      const before = (await rectOf(page(), "#el-c1")).x;
      await page().seek(21.73);
      const [outgoing, incoming] = [await rectOf(page(), "#el-c1"), await rectOf(page(), "#el-s05")];
      await page().seek(22.1);
      const after = [(await rectOf(page(), "#el-s05")).x, await effectiveOpacity(page(), "#c1-bg")];

      expect(before).toBe(0);
      expect(outgoing.x).toBeLessThan(0);
      expect(outgoing.x).toBeGreaterThan(-1920);
      expect(incoming.x).toBeCloseTo(outgoing.x + 1920, 0);
      expect(after).toEqual([0, 0]);
    });

    // s05 zooms through into s06, which starts 0.25 s before "Without", spoken at 26.1 s, over 0.45 s.
    it("zoom-through: the last Scene grows past the camera and fades as the next one grows into place", async () => {
      await page().seek(25.8);
      const before = (await rectOf(page(), "#el-s05")).width;
      await page().seek(26.07);
      const during = [(await rectOf(page(), "#el-s05")).width, (await rectOf(page(), "#el-s06")).width, await effectiveOpacity(page(), "#s06-bg")];
      await page().seek(26.4);
      const after = [(await rectOf(page(), "#el-s06")).width, await effectiveOpacity(page(), "#s06-bg")];

      expect(before).toBe(1920);
      expect(during[0]).toBeGreaterThan(1920);
      expect(during[1]).toBeLessThan(1920);
      expect(during[2]).toBeGreaterThan(0);
      expect(during[2]).toBeLessThan(1);
      expect(after).toEqual([1920, 1]);
    });

    // s06 carries "caching" (its verdict, "Cache wins") into s07 (a list item, "Caching"), which starts
    // 0.25 s before "Three", spoken at 32.5 s; the element flies for 0.6 s.
    describe("carry-over", () => {
      it("starts the incoming element over the outgoing one and flies it to its own place", async () => {
        await page().seek(32.2);
        const outgoing = centreOf(await rectOf(page(), "#s06-caching"));
        await page().seek(32.27);
        const leaving = centreOf(await rectOf(page(), "#s07-caching"));
        await page().seek(32.55);
        const flying = centreOf(await rectOf(page(), "#s07-caching"));
        await page().seek(33);
        const landed = centreOf(await rectOf(page(), "#s07-caching"));
        await page().seek(35);
        const own = centreOf(await rectOf(page(), "#s07-caching"));

        expect(leaving.x).toBeCloseTo(outgoing.x, -1);
        expect(leaving.y).toBeCloseTo(outgoing.y, -1);
        expect(landed).toEqual(own);
        expect(Math.hypot(landed.x - outgoing.x, landed.y - outgoing.y)).toBeGreaterThan(100);
        expect(Math.hypot(flying.x - outgoing.x, flying.y - outgoing.y)).toBeGreaterThan(10);
        expect(Math.hypot(flying.x - landed.x, flying.y - landed.y)).toBeGreaterThan(10);
      });

      it("shows the carried element from the start, as the Scene cuts in around it", async () => {
        await page().seek(32.27);

        expect(await effectiveOpacity(page(), "#s07-caching")).toBe(1);
        expect(await effectiveOpacity(page(), "#s06-caching")).toBe(0);
      });

      it("flies the same way when the page is first seeked past it and back", async () => {
        await page().seek(40);
        await page().seek(32.27);
        const leaving = centreOf(await rectOf(page(), "#s07-caching"));
        await page().seek(32.2);
        const outgoing = centreOf(await rectOf(page(), "#s06-caching"));

        expect(leaving.x).toBeCloseTo(outgoing.x, -1);
        expect(leaving.y).toBeCloseTo(outgoing.y, -1);
      });
    });
  });

  describe("push Transitions in every direction", () => {
    let frame: OpenFrame | undefined;
    /** The fixture with its cut, its crossfade into the Canvas and a later crossfade turned into pushes. */
    const pushes = structuredClone(horizontal);
    const PUSH_FROM = { s01: "push-right", s02: "push-up", s07: "push-down" } as const;

    pushes.scenes
      .filter((scene) => scene.id in PUSH_FROM)
      .forEach((scene) => {
        scene.transition = { type: PUSH_FROM[scene.id as keyof typeof PUSH_FROM] };
      });

    beforeAll(async () => {
      frame = await openFrame(pushes, longTranscript, {});
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame));

    const page = () => frame!.page;

    /** Seeks halfway through a 0.55 s push starting at `start`, and gives where the two units are. */
    async function halfway(start: number, from: string, to: string) {
      await page().seek(start + 0.28);

      return [await rectOf(page(), `#el-${from}`), await rectOf(page(), `#el-${to}`)] as const;
    }

    // s02 starts 0.25 s before "That", spoken at 4.9 s.
    it("push-right: the next Scene pushes the last one out to the right", async () => {
      const [outgoing, incoming] = await halfway(4.65, "s01", "s02");

      expect(outgoing.x).toBeGreaterThan(0);
      expect(incoming.x).toBeCloseTo(outgoing.x - 1920, 0);
      expect([outgoing.y, incoming.y]).toEqual([0, 0]);
    });

    // c1 starts 0.25 s before "Your", spoken at 10.5 s.
    it("push-up: the next Scene pushes the last one out the top", async () => {
      const [outgoing, incoming] = await halfway(10.25, "s02", "c1");

      expect(outgoing.y).toBeLessThan(0);
      expect(incoming.y).toBeCloseTo(outgoing.y + 1080, 0);
      expect([outgoing.x, incoming.x]).toEqual([0, 0]);
    });

    // s08 starts 0.25 s before "Done", spoken at 36.9 s.
    it("push-down: the next Scene pushes the last one out the bottom", async () => {
      const [outgoing, incoming] = await halfway(36.65, "s07", "s08");

      expect(outgoing.y).toBeGreaterThan(0);
      expect(incoming.y).toBeCloseTo(outgoing.y - 1080, 0);
    });

    it("leaves the next Scene in place once the push is over", async () => {
      await page().seek(37.4);

      expect(await rectOf(page(), "#el-s08")).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });
  });

  describe("anchors after a Transcript change", () => {
    let frame: OpenFrame | undefined;
    // "browser" is now spoken 0.4 s later; the Scene code stays the same.
    const later = { ...transcript, words: transcript.words.map((word, index) => (index === 1 ? { ...word, start: 0.95 } : word)) };

    beforeAll(async () => {
      frame = await openFrame(storyboard, later, { s01: await unitCode("s01"), s02: await unitCode("s02") });
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("are injected into at(id) at assembly, so the same Scene code lands on the new word", async () => {
      expect(await frame!.page.evaluate<number>(`MB.scene("s01").at("s01-browser")`)).toBe(0.95);

      await frame!.page.seek(0.85);
      const before = await opacityOf(frame!.page, "#s01-browser");
      await frame!.page.seek(1.05);
      const arriving = await opacityOf(frame!.page, "#s01-browser");

      expect(before).toBe(0);
      expect(arriving).toBeGreaterThanOrEqual(0.3);
    });
  });

  describe("in vertical", () => {
    let frame: OpenFrame | undefined;

    beforeAll(async () => {
      frame = await openFrame(vertical, longTranscript, {});
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

    it("keeps Scene content above the Captions area, the bottom 420 px of the frame", async () => {
      await frame!.page.seek(2);

      expect(await frame!.page.evaluate<Box>(safeZoneOf("s01-headline"))).toEqual({ x: 72, y: 180, width: 936, height: 1320 });
    });
  });
});

/** An element's opacity as the viewer sees it: its own times every ancestor's, 0 when it isn't displayed. */
function effectiveOpacity(page: FramePage, selector: string) {
  return page.evaluate<number>(`(() => {
    let opacity = 1;
    for (let node = document.querySelector(${JSON.stringify(selector)}); node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      opacity *= Number(style.opacity);
    }
    return Math.round(opacity * 1000) / 1000;
  })()`);
}

/** Where an element is drawn in the frame, transforms included. */
function rectOf(page: FramePage, selector: string) {
  return page.evaluate<Box>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`,
  );
}

function centreOf({ x, y, width, height }: Box) {
  return { x: x + width / 2, y: y + height / 2 };
}

/** The box of the `.mb-safe` container around an element. */
function safeZoneOf(id: string): string {
  return `(() => { const r = document.querySelector(${JSON.stringify(`#${id}`)}).closest(".mb-safe").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;
}
