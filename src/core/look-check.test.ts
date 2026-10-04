import { describe, expect, it } from "vitest";
import type { Format } from "../contract";
import { bundledPreset, storyboardRules } from "../modules/style";
import transcript from "./fixtures/checker/transcript.json";
import { BROWSER_TIMEOUT_MS, connect } from "./test-support/checker";
import { lookCheckCode, lookCheckStoryboard } from "./test-support/look-check";

const PRESETS = ["blueprint", "whiteboard", "sketchbook", "terminal"] as const;

/** Captions are on by default in vertical, off in horizontal. */
const CAPTIONS = { horizontal: false, vertical: true } satisfies Record<Format, boolean>;

describe("the look check", () => {
  describe.each(PRESETS)("renders the token-only demo through %s", (id) => {
    it.each(["horizontal", "vertical"] as const)(
      "in %s, with no lint or check problems and no late or early anchors",
      async (format) => {
        const preset = bundledPreset(id);
        const rules = storyboardRules(preset, { format, captions: CAPTIONS[format] });

        const report = await connect().checker.check({
          storyboard: lookCheckStoryboard(preset, format),
          transcript,
          rules,
          preset,
          code: await lookCheckCode(format),
        });

        expect(report.findings).toEqual([]);
      },
      BROWSER_TIMEOUT_MS,
    );
  });
});
