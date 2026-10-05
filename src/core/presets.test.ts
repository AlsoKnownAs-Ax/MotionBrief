import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FramePage } from "../modules/checker";
import { bundledPreset } from "../modules/style";
import transcript from "./fixtures/checker/transcript.json";
import { CLOSE_TIMEOUT_MS, closeFrame, FRAME_TIMEOUT_MS, openFrame, type OpenFrame } from "./test-support/frame";
import { lookCheckCode, lookCheckStoryboard } from "./test-support/look-check";

type PresetId = Parameters<typeof bundledPreset>[0];

/** The look check's demo in a bundled Preset, horizontal, open in the headless browser. */
function presetFrame(id: PresetId) {
  let frame: OpenFrame | undefined;

  beforeAll(async () => {
    const preset = bundledPreset(id);
    frame = await openFrame(lookCheckStoryboard(preset, "horizontal"), transcript, await lookCheckCode("horizontal"), preset);
    // Every element is in place by then.
    await frame.page.seek(8);
  }, FRAME_TIMEOUT_MS);

  afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

  return () => frame!.page;
}

type Style = Record<string, string>;

/** Computed styles of the element a selector matches, or of one of its pseudo-elements. */
function styleOf(page: FramePage, selector: string, properties: string[], pseudo?: string) {
  return page.evaluate<Style>(
    `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo ?? null)}); return Object.fromEntries(${JSON.stringify(properties)}.map((p) => [p, s.getPropertyValue(p)])); })()`,
  );
}

function pathOf(page: FramePage, id: string) {
  return page.evaluate<string>(`document.getElementById(${JSON.stringify(id)}).getAttribute("d")`);
}

type Box = { width: number; height: number; fontSize: number };

/** The chip around an icon, with its font size: a 1em chip is as wide and tall as its font is big. */
function chipOf(page: FramePage, selector: string) {
  return page.evaluate<Box & { icon: number; className: string }>(
    `(() => {
      const chip = document.querySelector(${JSON.stringify(selector)} + " .mb-chip");
      const box = chip.getBoundingClientRect();
      return { width: box.width, height: box.height, fontSize: parseFloat(getComputedStyle(chip).fontSize), icon: chip.querySelector("svg.mb-icon").getBoundingClientRect().width, className: chip.getAttribute("class") };
    })()`,
  );
}

/** The root composition's texture overlay: where it sits and how strong it is. */
function textureOf(page: FramePage) {
  return page.evaluate<{ inRoot: boolean; opacity: number; pointerEvents: string; zIndex: string } | null>(
    `(() => {
      const overlay = document.getElementById("mb-texture");
      if (!overlay) return null;
      const s = getComputedStyle(overlay);
      return { inRoot: overlay.parentElement.getAttribute("data-composition-id") === "main", opacity: Number(s.opacity), pointerEvents: s.pointerEvents, zIndex: s.zIndex };
    })()`,
  );
}

/**
 * Runs one MB helper on a fresh element in the page and samples its tween across its length:
 * `ratio` is GSAP's eased progress, which goes past 1 when an ease overshoots.
 */
function sampleHelper(page: FramePage, call: string) {
  return page.evaluate<{ duration: number; ratios: number[] }>(
    `(() => {
      const holder = document.createElement("div");
      holder.innerHTML = '<div style="position: absolute; width: 100px; height: 100px">x</div><svg width="200" height="20"><path d="M0 10 L200 10" stroke="black"></path></svg>';
      document.body.appendChild(holder);
      const el = holder.firstChild;
      const path = holder.querySelector("path");
      const tl = gsap.timeline({ paused: true });
      ${call};
      const tween = tl.getChildren()[0];
      const ratios = [];
      for (let i = 0; i <= 100; i++) { tl.seek(tl.duration() * i / 100); ratios.push(tween.ratio); }
      holder.remove();
      return { duration: tween.duration(), ratios };
    })()`,
  );
}

/** Which of these faces the page has loaded from its bundled files, as "<family> <weight>". */
function loadedFaces(page: FramePage, faces: string[]) {
  return page.evaluate<string[]>(
    `Promise.all(${JSON.stringify(faces)}.map((face) => document.fonts.load(face))).then((sets) => sets.flat().filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "") + " " + face.weight))`,
  );
}

const SKETCH = 'url("#mb-sketch")';

describe("Blueprint, in the frame", () => {
  const page = presetFrame("blueprint");

  it("draws elevated surfaces with 22 px corners", async () => {
    const card = await styleOf(page(), "#s01-server", ["box-shadow", "border-top-width", "border-top-left-radius"]);

    expect(card["box-shadow"]).not.toBe("none");
    expect(card).toMatchObject({ "border-top-width": "2px", "border-top-left-radius": "22px" });
  });

  it("lays a dot grid behind each Scene", async () => {
    const grid = await styleOf(page(), "#s01-bg", ["background-image"], "::after");

    expect(grid["background-image"]).toMatch(/^radial-gradient/);
  });

  it("draws straight, clean connectors of weight 4", async () => {
    expect(await pathOf(page(), "s01-browser-server")).toMatch(/^M[-\d. ]+ L[-\d. ]+$/);
    expect(await styleOf(page(), "#s01-browser-server", ["stroke-width", "filter"])).toEqual({ "stroke-width": "4px", filter: "none" });
  });

  it("inlines outline icons with no chip", async () => {
    const icon = await page().evaluate<{ chips: number; className: string }>(
      `({ chips: document.querySelectorAll(".mb-chip").length, className: document.querySelector("#s01-server svg").getAttribute("class") })`,
    );

    expect(icon).toEqual({ chips: 0, className: "mb-icon lc-icon" });
  });

  it("has no texture and no sketch filter", async () => {
    expect(await textureOf(page())).toBeNull();
    expect(await page().evaluate<boolean>(`document.getElementById("mb-sketch") !== null`)).toBe(false);
  });
});

describe("Whiteboard, in the frame", () => {
  const page = presetFrame("whiteboard");

  it("loads Manrope and IBM Plex Mono from the bundled files", async () => {
    const faces = await loadedFaces(page(), ["800 40px Manrope", "600 40px Manrope", '400 30px "IBM Plex Mono"']);

    expect(faces).toEqual(expect.arrayContaining(["Manrope 800", "Manrope 600", "IBM Plex Mono 400"]));
  });

  it("draws outlined surfaces with no shadow and 14 px corners", async () => {
    const card = await styleOf(page(), "#s01-server", ["box-shadow", "border-top-width", "border-top-style", "border-top-left-radius"]);

    expect(card).toEqual({ "box-shadow": "none", "border-top-width": "2px", "border-top-style": "solid", "border-top-left-radius": "14px" });
  });

  it("lays a line grid behind each Scene", async () => {
    const grid = await styleOf(page(), "#s01-bg", ["background-image"], "::after");

    expect(grid["background-image"]).toMatch(/^linear-gradient/);
  });

  it("draws curved connectors of weight 3", async () => {
    expect(await pathOf(page(), "s01-browser-server")).toMatch(/^M[-\d. ]+ C[-\d. ]+$/);
    expect(await styleOf(page(), "#s01-browser-server", ["stroke-width"])).toEqual({ "stroke-width": "3px" });
  });

  it("puts each icon in an outline chip that keeps the icon's 1em box and takes its classes", async () => {
    const chip = await chipOf(page(), "#s01-server");

    expect(chip.className).toBe("mb-chip lc-icon");
    expect(chip).toMatchObject({ width: 64, height: 64, fontSize: 64 });
    expect(chip.icon).toBeCloseTo(64 * 0.58, 0);
    expect(await styleOf(page(), "#s01-server .mb-chip", ["border-top-style"])).toEqual({ "border-top-style": "solid" });
  });
});

describe("Sketchbook, in the frame", () => {
  const page = presetFrame("sketchbook");

  it("loads Fredoka and Nunito from the bundled files", async () => {
    const faces = await loadedFaces(page(), ["600 40px Fredoka", "700 40px Nunito"]);

    expect(faces).toEqual(expect.arrayContaining(["Fredoka 600", "Nunito 700"]));
  });

  it("draws card outlines through the displacement filter, behind crisp text", async () => {
    const card = await styleOf(page(), "#s01-server", ["border-top-color", "filter"]);
    const outline = await styleOf(page(), "#s01-server", ["filter", "border-top-width", "border-top-style"], "::before");
    const text = await styleOf(page(), "#s01-server .mb-body", ["filter"]);

    expect(card).toEqual({ "border-top-color": "rgba(0, 0, 0, 0)", filter: "none" });
    expect(outline).toEqual({ filter: SKETCH, "border-top-width": "4px", "border-top-style": "solid" });
    expect(text).toEqual({ filter: "none" });
  });

  it("defines the displacement filter once in the page", async () => {
    const filters = await page().evaluate<number>(`document.querySelectorAll("filter#mb-sketch feDisplacementMap").length`);

    expect(filters).toBe(1);
  });

  it("draws icons through the displacement filter, in filled chips that keep a 1em box", async () => {
    const chip = await chipOf(page(), "#s01-server");
    const filters = await page().evaluate<{ chip: string; icon: string }>(
      `({ chip: getComputedStyle(document.querySelector("#s01-server .mb-chip")).filter, icon: getComputedStyle(document.querySelector("#s01-server .mb-chip svg")).filter })`,
    );

    expect(chip).toMatchObject({ width: 64, height: 64, fontSize: 64 });
    expect(filters).toEqual({ chip: SKETCH, icon: "none" });
  });

  it("wobbles connectors in their geometry rather than through a filter", async () => {
    const d = await pathOf(page(), "s01-browser-server");

    expect(d.match(/ Q/g)?.length).toBeGreaterThanOrEqual(2);
    expect(await styleOf(page(), "#s01-browser-server", ["filter", "stroke-width"])).toEqual({ filter: "none", "stroke-width": "5px" });
  });

  it("lays a paper texture over every Scene in the root, below 0.6 opacity", async () => {
    const texture = await textureOf(page());

    expect(texture).toMatchObject({ inRoot: true, pointerEvents: "none", zIndex: "50" });
    expect(texture?.opacity).toBeGreaterThan(0);
    expect(texture?.opacity).toBeLessThan(0.6);
  });

  describe("with springy Motion", () => {
    it("overshoots a pop and settles", async () => {
      const { ratios } = await sampleHelper(page(), `MB.reveal(tl, el, 0.05, "pop")`);

      expect(Math.max(...ratios)).toBeGreaterThan(1);
      expect(ratios.at(-1)).toBe(1);
    });

    it.each([
      ["a wipe", `MB.reveal(tl, el, 0.05, "wipe")`],
      ["a blur", `MB.reveal(tl, el, 0.05, "blur")`],
      ["a draw-on", `MB.draw(tl, path, 0.05)`],
    ])("never overshoots %s", async (_name, call) => {
      const { ratios } = await sampleHelper(page(), call);

      expect(Math.max(...ratios)).toBeLessThanOrEqual(1);
      expect(ratios.at(-1)).toBe(1);
    });
  });
});

describe("Terminal, in the frame", () => {
  const page = presetFrame("terminal");

  it("loads VT323 and IBM Plex Mono from the bundled files", async () => {
    const faces = await loadedFaces(page(), ["400 40px VT323", '500 30px "IBM Plex Mono"']);

    expect(faces).toEqual(expect.arrayContaining(["VT323 400", "IBM Plex Mono 500"]));
  });

  it("draws outlined surfaces with square corners", async () => {
    expect(await styleOf(page(), "#s01-server", ["border-top-left-radius", "box-shadow"])).toEqual({ "border-top-left-radius": "0px", "box-shadow": "none" });
  });

  it("lays scanlines over every Scene in the root, below 0.6 opacity", async () => {
    const texture = await textureOf(page());

    expect(texture).toMatchObject({ inRoot: true, pointerEvents: "none" });
    expect(texture?.opacity).toBeLessThan(0.6);
  });

  it("plays each unit at 12 fps with stepped Motion, holding each frame until the next", async () => {
    // "round" is spoken 0.5 s into unit s02: #s02-caption fades in from 0.45 s. The unit's own
    // timeline is sampled every 5 ms, since the player's seek snaps to its frame rate.
    const opacities = await page().evaluate<number[]>(
      `(() => {
        const tl = window.__timelines["s02"];
        const caption = document.querySelector("#s02-caption");
        const opacities = [];
        for (let i = 0; i <= 100; i++) { tl.seek(0.4 + i * 0.005); opacities.push(Number(getComputedStyle(caption).opacity)); }
        return opacities;
      })()`,
    );

    const holds = runLengths(opacities)
      .slice(1, -1)
      .map((samples) => samples * 0.005);
    expect(holds.length).toBeGreaterThanOrEqual(2);
    holds.forEach((hold) => expect(hold).toBeCloseTo(1 / 12, 1.7));
  });

  it("still lands stepped entrances by their word + 0.1 s", async () => {
    await page().seek(4.65 + 0.1);

    expect(await page().evaluate<number>(`Number(getComputedStyle(document.querySelector("#s02-caption")).opacity)`)).toBeGreaterThanOrEqual(0.3);
  });
});

describe("Motion energy", () => {
  const calm = presetFrame("whiteboard");
  const balanced = presetFrame("blueprint");
  const punchy = presetFrame("sketchbook");

  it("sets how long the helpers take: longer when calm, shorter when punchy", async () => {
    const countUp = `MB.countUp(tl, el, 100, 0)`;
    const durations = await Promise.all([calm(), balanced(), punchy()].map(async (page) => (await sampleHelper(page, countUp)).duration));

    expect(durations).toEqual([1.5, 1.2, 0.96]);
  });

  it("stretches entrances with the same Motion character", async () => {
    const reveal = `MB.reveal(tl, el, 0.05, "fade")`;
    const calmReveal = await sampleHelper(calm(), reveal);
    const balancedReveal = await sampleHelper(balanced(), reveal);

    expect(calmReveal.duration).toBeCloseTo(balancedReveal.duration * 1.25, 5);
  });
});

describe("Motion character", () => {
  const smooth = presetFrame("blueprint");

  it("sets the easing family: smooth never overshoots, even on a pop", async () => {
    const { ratios } = await sampleHelper(smooth(), `MB.reveal(tl, el, 0.05, "pop")`);

    expect(Math.max(...ratios)).toBeLessThanOrEqual(1);
  });
});

/** How many samples in a row hold each value. */
function runLengths(values: number[]): number[] {
  return values.reduce<number[]>((runs, value, index) => {
    if (index > 0 && value === values[index - 1]) {
      runs[runs.length - 1]! += 1;

      return runs;
    }

    return [...runs, 1];
  }, []);
}
