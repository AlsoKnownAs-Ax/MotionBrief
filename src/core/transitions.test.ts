import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UnitCode } from "../contract";
import { unitsToRegenerate } from "../modules/assembler";
import type { FramePage } from "../modules/checker";
import type { Storyboard } from "../modules/storyboard";
import horizontalJson from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";
import { closeFrame, openFrame, type OpenFrame } from "./test-support/frame";

const horizontal = horizontalJson as Storyboard;

/** Hand-written Scene code for a Canvas (c1: s03 and s04) and a carry-over (s06 into s07), in `fixtures/transitions`. */
async function unitCode(unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(
    ["css", "html", "js"].map((part) => readFile(join(import.meta.dirname, "fixtures", "transitions", `${unit}.${part}`), "utf8")),
  );

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

async function handWritten() {
  return { c1: await unitCode("c1"), s06: await unitCode("s06"), s07: await unitCode("s07") };
}

describe("hand-written Scene code for a Canvas and a carry-over", () => {
  it(
    "passes lint, check and the contract",
    async () => {
      const report = await connect().checker.check({ storyboard: horizontal, transcript, rules: RULES, preset: BLUEPRINT, code: await handWritten() });

      expect(report.findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "tells Canvas Scene code without a world what the camera needs",
    async () => {
      const c1 = await unitCode("c1");
      const code = { c1: { ...c1, html: c1.html.replace('id="c1-world" ', "") } };

      const { findings } = await connect().checker.check({ storyboard: horizontal, transcript, rules: RULES, preset: BLUEPRINT, code });

      expect(findings).toContainEqual(expect.objectContaining({ unit: "c1", message: expect.stringContaining('<div id="c1-world">') }));
    },
    BROWSER_TIMEOUT_MS,
  );

  describe("in the frame", () => {
    let frame: OpenFrame | undefined;

    beforeAll(async () => {
      frame = await openFrame(horizontal, transcript, await handWritten(), BLUEPRINT);
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => closeFrame(frame));

    const page = () => frame!.page;

    // s04 starts 0.25 s before "The", spoken at 15.7 s; the camera moves over 0.9 s around it.
    it("moves the camera across the Canvas from the first Scene's region to the next", async () => {
      await page().seek(14);
      const first = await rectOf(page(), '[data-region="s04"]');
      await page().seek(16.5);
      const next = await rectOf(page(), '[data-region="s04"]');

      expect(first.x).toBe(1920);
      expect(next.x).toBe(0);
    });

    it("never moves the world in Scene code: the camera alone does", async () => {
      await page().seek(12);

      expect(await rectOf(page(), "#c1-world")).toEqual({ x: 0, y: 0, width: 3840, height: 1080 });
    });

    // s06 carries "caching" into s07, which starts at 32.25 s.
    it("morphs the carried element across the two units", async () => {
      await page().seek(32.2);
      const outgoing = centreOf(await rectOf(page(), "#s06-caching"));
      await page().seek(32.27);
      const leaving = centreOf(await rectOf(page(), "#s07-caching"));
      await page().seek(33.5);
      const landed = centreOf(await rectOf(page(), "#s07-caching"));

      expect(leaving.x).toBeCloseTo(outgoing.x, -1);
      expect(leaving.y).toBeCloseTo(outgoing.y, -1);
      expect(Math.hypot(landed.x - outgoing.x, landed.y - outgoing.y)).toBeGreaterThan(100);
    });
  });
});

describe("a carry-over out of an element Scene code has moved", () => {
  /** s06 slides its verdict, "caching", 360 px right and 40 px up after revealing it. */
  async function movedCode() {
    return { ...(await handWritten()), s06: { ...(await unitCode("s06")), js: await readFile(join(import.meta.dirname, "fixtures", "transitions", "s06-moved.js"), "utf8") } };
  }

  /**
   * Opens a fresh page, so the flight is measured on its first play, seeks `first` and then 32.27 s
   * (just into s07); gives where the carried element starts its flight, and where the viewer saw
   * the outgoing element at 32.2 s, as s06 ends.
   */
  async function flightFrom(first: number) {
    const frame = await openFrame(horizontal, transcript, await movedCode(), BLUEPRINT);

    try {
      await frame.page.seek(first);
      await frame.page.seek(32.27);
      const leaving = centreOf(await rectOf(frame.page, "#s07-caching"));
      await frame.page.seek(32.2);
      const outgoing = centreOf(await rectOf(frame.page, "#s06-caching"));
      const layout = await frame.page.evaluate<{ x: number; y: number }>(
        `(() => { let x = 0, y = 0, node = document.querySelector("#s06-caching"); const e = node; for (; node; node = node.offsetParent) { x += node.offsetLeft; y += node.offsetTop; } return { x: x + e.offsetWidth / 2, y: y + e.offsetHeight / 2 }; })()`,
      );

      return { leaving, outgoing, layout };
    } finally {
      await closeFrame(frame);
    }
  }

  it(
    "starts from where the viewer last saw it, not from its layout box, playing forward",
    async () => {
      const { leaving, outgoing, layout } = await flightFrom(31);

      expect(outgoing.x - layout.x).toBeCloseTo(360, -1);
      expect(leaving.x).toBeCloseTo(outgoing.x, -1);
      expect(leaving.y).toBeCloseTo(outgoing.y, -1);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "starts from the same place when the flight is first played seeking backwards",
    async () => {
      const { leaving, outgoing } = await flightFrom(40);

      expect(leaving.x).toBeCloseTo(outgoing.x, -1);
      expect(leaving.y).toBeCloseTo(outgoing.y, -1);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "starts from the same place when the page's first seek lands in the flight",
    async () => {
      const { leaving, outgoing } = await flightFrom(32.27);

      expect(leaving.x).toBeCloseTo(outgoing.x, -1);
      expect(leaving.y).toBeCloseTo(outgoing.y, -1);
    },
    BROWSER_TIMEOUT_MS,
  );
});

describe("which units a change regenerates", () => {
  /** The fixture Storyboard with a change made to a copy. */
  function changed(change: (storyboard: Storyboard) => void): Storyboard {
    const copy = structuredClone(horizontal);
    change(copy);

    return copy;
  }

  it("regenerates a lone Scene's own unit when it changes", () => {
    expect(unitsToRegenerate(horizontal, horizontal, ["s05"])).toEqual(["s05"]);
  });

  it("regenerates the whole Canvas when one of its Scenes changes", () => {
    expect(unitsToRegenerate(horizontal, horizontal, ["s04"])).toEqual(["c1"]);
  });

  it("regenerates nothing when nothing changed", () => {
    expect(unitsToRegenerate(horizontal, horizontal, [])).toEqual([]);
  });

  it("regenerates a Canvas that gains a Scene, though no Scene's content changed", () => {
    const grown = changed(({ scenes }) => {
      scenes[3]!.transition = { type: "camera" };
      scenes[4]!.canvas = "c1";
    });

    expect(unitsToRegenerate(horizontal, grown, [])).toEqual(["c1"]);
  });

  it("regenerates the Scenes of a Canvas taken apart as lone Scenes", () => {
    const apart = changed(({ scenes }) => {
      delete scenes[2]!.canvas;
      delete scenes[3]!.canvas;
    });

    expect(unitsToRegenerate(horizontal, apart, [])).toEqual(["s03", "s04"]);
  });

  it("regenerates lone Scenes grouped into a new Canvas", () => {
    const grouped = changed(({ scenes }) => {
      scenes[7]!.canvas = "c2";
      scenes[7]!.transition = { type: "camera" };
      scenes[8]!.canvas = "c2";
    });

    expect(unitsToRegenerate(horizontal, grouped, [])).toEqual(["c2"]);
  });
});

type Box = { x: number; y: number; width: number; height: number };

function rectOf(page: FramePage, selector: string) {
  return page.evaluate<Box>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`,
  );
}

function centreOf({ x, y, width, height }: Box) {
  return { x: x + width / 2, y: y + height / 2 };
}
