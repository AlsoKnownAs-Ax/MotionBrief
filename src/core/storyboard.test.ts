import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { Format, StoryboardRules, StoryboardTranscript } from "../contract";
import { createCore } from "./composition-root";
import horizontal from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import verticalCaptions from "./fixtures/storyboard/vertical-captions.json";

/** A Blueprint-like horizontal video: every Transition kind allowed, Canvases where they help, no Captions. */
const HORIZONTAL: StoryboardRules = {
  format: "horizontal",
  captions: false,
  transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"],
  canvas: "where-it-helps",
};

function connect() {
  const { router } = createCore({ appVersion: "1.2.3" });

  return createRouterClient(router);
}

const VERTICAL: StoryboardRules = { ...HORIZONTAL, format: "vertical" };

/** A vertical video with Captions on, as a vertical video starts out. */
const VERTICAL_CAPTIONS: StoryboardRules = { ...VERTICAL, captions: true };

async function validate(storyboard: unknown, rules: StoryboardRules = HORIZONTAL, words: StoryboardTranscript = transcript) {
  const { issues } = await connect().storyboard.validate({ storyboard, transcript: words, rules });

  return issues;
}

/** A Transcript with hand-picked word onsets, for checking Scene lengths to the hundredth of a second. */
function timed(words: [text: string, start: number][], duration: number): StoryboardTranscript {
  return { duration, words: words.map(([text, start]) => ({ text, start })) };
}

/** Two sentences, the second spoken from `secondAt` seconds, over a Voiceover of `duration` seconds. */
function twoSentences(secondAt: number, duration: number) {
  return timed(
    [
      ["Caches", 0.4],
      ["help.", 0.9],
      ["Use", secondAt],
      ["them.", secondAt + 0.5],
    ],
    duration,
  );
}

/** One hook Scene per sentence of `twoSentences`. */
function twoHooks(format: Format) {
  return {
    format,
    scenes: [
      { id: "s01", type: "hook", from: 0, to: 1, transition: { type: "cut" }, content: { headline: { id: "headline", text: "Caches help", at: 0 } } },
      { id: "s02", type: "hook", from: 2, to: 3, content: { headline: { id: "headline", text: "Use them", at: 2 } } },
    ],
  };
}

/** A copy of a fixture Storyboard with one deliberate change, as an agent might have written it. */
function changed<T>(fixture: T, change: (storyboard: T) => void) {
  const storyboard = structuredClone(fixture);
  change(storyboard);

  return storyboard;
}

/** The parts of an issue that say where it is: what an agent needs to find and fix it. */
function located(issues: { code: string; sceneId?: string; field: string }[]) {
  return issues.map(({ code, sceneId, field }) => ({ code, sceneId, field }));
}

describe("Storyboard validation", () => {
  it("accepts a horizontal Storyboard using all 9 Scene Types", async () => {
    expect(await validate(horizontal)).toEqual([]);
  });

  it("rejects a Scene Type outside the 9, naming the Scene", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[1]!, { type: "custom" });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s02", field: "type" }]);
  });

  it("rejects an anchor written in seconds rather than as a Transcript word", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[0]!.content, { headline: { id: "headline", text: "Your request travels far", at: 0.75 } });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s01", field: "content.headline.at" }]);
  });

  it("rejects content that doesn't fit its Scene Type's shape", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[2]!.content, { nodes: [{ id: "browser", label: "Browser", at: 26 }] });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s03", field: "content.nodes" }]);
  });

  it("rejects fields a Storyboard doesn't have, such as layout, rather than dropping them", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[2]!, { layout: { columns: 3 } });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s03", field: "layout" }]);
  });

  it("rejects motion written into a Scene's content", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[0]!.content, {
        headline: { id: "headline", text: "Your request travels far", at: 1, motion: "fade" },
      });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s01", field: "content.headline.motion" }]);
  });

  it("accepts any DOM-safe Scene id", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      scenes[0]!.id = "intro";
    });

    expect(await validate(storyboard)).toEqual([]);
  });

  it("rejects a hyphen in a Scene id, which would make `<sceneId>-<elementId>` ambiguous, naming the Scene by it", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      scenes[2]!.id = "scene-3";
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "scene-3", field: "id" }]);
  });

  it("locates a schema error by position when the Scene has no id to name it by", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      Object.assign(scenes[2]!, { id: 3 });
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: undefined, field: "scenes[2].id" }]);
  });

  it("rejects something that isn't a Storyboard at all", async () => {
    const issues = await validate("Here is your Storyboard!");

    expect(issues.map(({ code, sceneId }) => ({ code, sceneId }))).toEqual([{ code: "SCHEMA", sceneId: undefined }]);
  });

  it("rejects two Scenes with the same id, which would collide in the assembled page", async () => {
    const storyboard = changed(horizontal, ({ scenes }) => {
      scenes[4]!.id = "s04";
    });

    expect(located(await validate(storyboard))).toEqual([{ code: "DUPLICATE_ID", sceneId: "s04", field: "id" }]);
  });

  it("is specific to one Format: a horizontal Storyboard is rejected for the vertical video", async () => {
    const issues = await validate(horizontal, { ...HORIZONTAL, format: "vertical" });

    expect(located(issues)).toContainEqual({ code: "FORMAT", sceneId: undefined, field: "format" });
  });

  describe("Transcript spans", () => {
    it("rejects a gap between Scenes", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[2]!.from = 26;
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "SPAN", sceneId: "s03", field: "from" }]);
    });

    it("rejects Scenes that overlap", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[2]!.from = 24;
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "SPAN", sceneId: "s03", field: "from" }]);
    });

    it("rejects a Storyboard that doesn't start at the Transcript's first word", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[0]!.from = 1;
      });

      expect(located(await validate(storyboard))).toContainEqual({ code: "SPAN", sceneId: "s01", field: "from" });
    });

    it("rejects a Storyboard that stops before the Transcript's last word", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[8]!.to = 109;
      });

      expect(located(await validate(storyboard))).toContainEqual({ code: "SPAN", sceneId: "s09", field: "to" });
    });

    it("rejects a span past the end of the Transcript", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[8]!.to = 140;
      });

      expect(located(await validate(storyboard))).toContainEqual({ code: "SPAN", sceneId: "s09", field: "to" });
    });

    it("rejects a Scene that ends before it starts", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[4]!.to = 50;
      });

      expect(located(await validate(storyboard))).toContainEqual({ code: "SPAN", sceneId: "s05", field: "to" });
    });

    it("rejects a Scene break in the middle of a clause", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[0]!.to = 8;
        scenes[1]!.from = 9;
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "BOUNDARY", sceneId: "s01", field: "to" }]);
    });

    it("accepts a Scene break at a clause end", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[3]!.to = 47;
        scenes[4]!.from = 48;
      });

      expect(located(await validate(storyboard))).not.toContainEqual(expect.objectContaining({ code: "BOUNDARY" }));
    });
  });

  describe("elements", () => {
    it("rejects an element anchored on a word outside its Scene", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[1]!.content, { term: { id: "term", text: "Latency", at: 30 } });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "ANCHOR", sceneId: "s02", field: "content.term.at" }]);
    });

    it("rejects two elements with the same id in one Scene", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[6]!.content, {
          items: [
            { id: "caching", text: "Caching", at: 84 },
            { id: "caching", text: "A CDN", at: 86 },
          ],
        });
      });

      expect(located(await validate(storyboard))).toEqual([
        { code: "DUPLICATE_ID", sceneId: "s07", field: "content.items[1].id" },
      ]);
    });

    it("allows the same element id in different Scenes", async () => {
      const ids = horizontal.scenes.filter((scene) => "headline" in scene.content).map((scene) => scene.id);

      expect(ids).toEqual(["s01", "s09"]);
      expect(await validate(horizontal)).toEqual([]);
    });

    it("rejects a diagram edge to a node that doesn't exist", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[2]!.content, {
          edges: [{ id: "browser-database", from: "browser", to: "database", at: 27 }],
        });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "REFERENCE", sceneId: "s03", field: "content.edges[0].to" }]);
    });

    it("rejects a flow packet travelling through a step that doesn't exist", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[3]!.content, {
          packets: [{ id: "answer", label: "Answer", path: ["database", "client"], at: 51 }],
        });
      });

      expect(located(await validate(storyboard))).toEqual([
        { code: "REFERENCE", sceneId: "s04", field: "content.packets[0].path[1]" },
      ]);
    });

    it("rejects a code Scene without anchored blocks of code", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[4]!.content, { blocks: [] });
      });

      expect(located(await validate(storyboard))).toContainEqual({ code: "SCHEMA", sceneId: "s05", field: "content.blocks" });
    });

    it("rejects a code highlight past the last line", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[4]!.content, { highlights: [{ id: "fetch-call", lines: [2], at: 60 }] });
      });

      expect(located(await validate(storyboard))).toEqual([
        { code: "CONTENT", sceneId: "s05", field: "content.highlights[0].lines[0]" },
      ]);
    });

    it("rejects more code than a Scene can show legibly, counted across blocks", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[4]!.content, {
          blocks: [
            { id: "setup", lines: Array.from({ length: 8 }, (_, line) => `const a${line} = ${line};`), at: 58 },
            { id: "fetch-line", lines: Array.from({ length: 7 }, (_, line) => `await fetch(a${line});`), at: 59 },
          ],
        });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "CONTENT", sceneId: "s05", field: "content.blocks" }]);
    });

    it("numbers code lines across blocks, in any programming language", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[4]!.content, {
          language: "elixir",
          blocks: [
            { id: "request", lines: ["url = \"https://example.com\""], at: 58 },
            { id: "fetch-line", lines: ["Req.get!(url)"], at: 59 },
          ],
          highlights: [{ id: "fetch-call", lines: [2], at: 60 }],
        });
      });

      expect(await validate(storyboard)).toEqual([]);
    });

    it("rejects a bar chart without bars", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[7]!.content, { kind: "bars" });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "CONTENT", sceneId: "s08", field: "content.bars" }]);
    });
  });

  describe("Transitions", () => {
    it("rejects a Transition the Style Preset doesn't allow", async () => {
      const issues = await validate(horizontal, { ...HORIZONTAL, transitions: ["cut", "crossfade", "push", "carry-over", "camera"] });

      expect(located(issues)).toEqual([{ code: "TRANSITION", sceneId: "s05", field: "transition" }]);
    });

    it("treats every push direction as the Style Preset's push", async () => {
      const issues = await validate(horizontal, {
        ...HORIZONTAL,
        transitions: ["cut", "crossfade", "zoom-through", "carry-over", "camera"],
      });

      expect(located(issues)).toEqual([{ code: "TRANSITION", sceneId: "s04", field: "transition" }]);
    });

    it("rejects a camera move the Style Preset doesn't allow, even on a Canvas", async () => {
      const issues = await validate(horizontal, {
        ...HORIZONTAL,
        transitions: ["cut", "crossfade", "push", "zoom-through", "carry-over"],
      });

      expect(located(issues)).toEqual([{ code: "TRANSITION", sceneId: "s03", field: "transition" }]);
    });

    it("needs a Transition into the next Scene from every Scene but the last", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        delete scenes[1]!.transition;
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "TRANSITION", sceneId: "s02", field: "transition" }]);
    });

    it("rejects a Transition out of the last Scene", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[8]!, { transition: { type: "cut" } });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "TRANSITION", sceneId: "s09", field: "transition" }]);
    });

    it("requires a carry-over to name the element it morphs", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[5]!, { transition: { type: "carry-over" } });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "SCHEMA", sceneId: "s06", field: "transition.element" }]);
    });

    it("rejects a carry-over of an element the next Scene doesn't have", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[6]!.content, {
          items: [
            { id: "cache", text: "Caching", at: 84 },
            { id: "cdn", text: "A CDN", at: 86 },
          ],
        });
      });

      expect(located(await validate(storyboard))).toEqual([
        { code: "TRANSITION", sceneId: "s06", field: "transition.element" },
      ]);
    });

    it("rejects a carry-over of an element this Scene doesn't have", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[5]!, { transition: { type: "carry-over", element: "cdn" } });
      });

      expect(located(await validate(storyboard))).toEqual([
        { code: "TRANSITION", sceneId: "s06", field: "transition.element" },
      ]);
    });

    it("rejects a camera move between Scenes that aren't on the same Canvas", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[0]!, { transition: { type: "camera" } });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "TRANSITION", sceneId: "s01", field: "transition" }]);
    });

    it("moves the camera between Scenes on the same Canvas", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        Object.assign(scenes[2]!, { transition: { type: "crossfade" } });
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "TRANSITION", sceneId: "s03", field: "transition" }]);
    });
  });

  describe("Canvas groupings", () => {
    /** The fixture with its one Canvas taken apart into two lone Scenes. */
    const noCanvas = changed(horizontal, ({ scenes }) => {
      delete scenes[2]!.canvas;
      delete scenes[3]!.canvas;
      Object.assign(scenes[2]!, { transition: { type: "crossfade" } });
    });

    it("rejects any Canvas when the Style Preset never uses one", async () => {
      const issues = await validate(horizontal, { ...HORIZONTAL, canvas: "never" });

      expect(located(issues)).toEqual([
        { code: "CANVAS", sceneId: "s03", field: "canvas" },
        { code: "CANVAS", sceneId: "s04", field: "canvas" },
      ]);
    });

    it("accepts a Storyboard without a Canvas when the Style Preset never uses one", async () => {
      expect(await validate(noCanvas, { ...HORIZONTAL, canvas: "never" })).toEqual([]);
    });

    it("leaves Canvases to the agent when the Style Preset uses them where they help", async () => {
      expect(await validate(noCanvas, HORIZONTAL)).toEqual([]);
    });

    it("leaves Canvases to the agent when the Style Preset uses them whenever possible", async () => {
      expect(await validate(noCanvas, { ...HORIZONTAL, canvas: "whenever-possible" })).toEqual([]);
    });

    it("rejects a Canvas that isn't one run of consecutive Scenes", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[5]!.canvas = "c1";
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "CANVAS", sceneId: "s06", field: "canvas" }]);
    });

    it("rejects a Canvas holding a single Scene", async () => {
      const storyboard = changed(horizontal, ({ scenes }) => {
        scenes[7]!.canvas = "c2";
      });

      expect(located(await validate(storyboard))).toEqual([{ code: "CANVAS", sceneId: "s08", field: "canvas" }]);
    });
  });

  describe("Captions", () => {
    it("accepts a vertical Storyboard whose copy is labels, numbers and hero words", async () => {
      expect(await validate(verticalCaptions, VERTICAL_CAPTIONS)).toEqual([]);
    });

    it("rejects longer copy with Captions on, since the Captions already say it", async () => {
      const issues = await validate(horizontal, { ...HORIZONTAL, captions: true });

      expect(located(issues)).toEqual([{ code: "CAPTIONS", sceneId: "s02", field: "content.definition.text" }]);
    });

    it("rejects a sentence as a node label with Captions on", async () => {
      const storyboard = changed(verticalCaptions, ({ scenes }) => {
        Object.assign(scenes[2]!.content, {
          nodes: [
            { id: "browser", label: "Your browser talks to it", at: 26 },
            { id: "balancer", label: "Load balancer", at: 30 },
            { id: "servers", label: "3 servers", at: 36 },
          ],
        });
      });

      expect(located(await validate(storyboard, VERTICAL_CAPTIONS))).toEqual([
        { code: "CAPTIONS", sceneId: "s03", field: "content.nodes[0].label" },
      ]);
    });

    it("rejects copy that reads as a sentence with Captions on, but not a punctuated hero word", async () => {
      const storyboard = changed(verticalCaptions, ({ scenes }) => {
        Object.assign(scenes[6]!.content, {
          items: [
            { id: "caching", text: "Fast!", at: 84 },
            { id: "cdn", text: "Use a CDN.", at: 86 },
          ],
        });
      });

      expect(located(await validate(storyboard, VERTICAL_CAPTIONS))).toEqual([
        { code: "CAPTIONS", sceneId: "s07", field: "content.items[1].text" },
      ]);
    });

    it("allows longer copy with Captions off", async () => {
      expect(await validate(horizontal, { ...HORIZONTAL, captions: false })).toEqual([]);
    });
  });

  describe("Format pacing", () => {
    it("starts a Scene 0.25 s before its first word, so a 10.2 s gap still makes a 9.95 s horizontal Scene", async () => {
      const issues = await validate(twoHooks("horizontal"), HORIZONTAL, twoSentences(10.2, 15));

      expect(issues).toEqual([]);
    });

    it("rejects a horizontal Scene longer than 10 s", async () => {
      const issues = await validate(twoHooks("horizontal"), HORIZONTAL, twoSentences(10.3, 15));

      expect(located(issues)).toEqual([{ code: "PACING", sceneId: "s01", field: "to" }]);
    });

    it("rejects a horizontal Scene shorter than 3 s", async () => {
      const issues = await validate(twoHooks("horizontal"), HORIZONTAL, twoSentences(4, 6.6));

      expect(located(issues)).toEqual([{ code: "PACING", sceneId: "s02", field: "to" }]);
    });

    it("accepts a 2.85 s vertical Scene", async () => {
      const issues = await validate(twoHooks("vertical"), VERTICAL, twoSentences(4, 6.6));

      expect(issues).toEqual([]);
    });

    it("rejects a vertical Scene longer than 7 s", async () => {
      const issues = await validate(twoHooks("vertical"), VERTICAL, twoSentences(7.4, 12));

      expect(located(issues)).toEqual([{ code: "PACING", sceneId: "s01", field: "to" }]);
    });

    it("rejects a vertical Scene shorter than 2.5 s", async () => {
      const issues = await validate(twoHooks("vertical"), VERTICAL, twoSentences(4, 6.1));

      expect(located(issues)).toEqual([{ code: "PACING", sceneId: "s02", field: "to" }]);
    });

    it("lets a single Scene cover a Voiceover shorter than the minimum", async () => {
      const storyboard = { ...twoHooks("horizontal"), scenes: [{ ...twoHooks("horizontal").scenes[0]!, transition: undefined }] };

      const issues = await validate(storyboard, HORIZONTAL, timed([["Caches", 0.2], ["help.", 0.7]], 1.5));

      expect(issues).toEqual([]);
    });
  });
});
