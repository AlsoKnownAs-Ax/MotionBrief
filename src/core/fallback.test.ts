import { describe, expect, it } from "vitest";
import type { StoryboardRules } from "../contract";
import horizontal from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import verticalCaptions from "./fixtures/storyboard/vertical-captions.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";

describe("fallback Scenes", () => {
  it(
    "draw every Scene Type, and a Canvas, so that they pass every check in horizontal",
    async () => {
      const report = await connect().checker.check({ storyboard: horizontal, transcript, rules: RULES, preset: BLUEPRINT, code: {} });

      expect(report.findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "pass every check in vertical, with Captions on",
    async () => {
      const rules: StoryboardRules = { ...RULES, format: "vertical", captions: true };

      const report = await connect().checker.check({ storyboard: verticalCaptions, transcript, rules, preset: BLUEPRINT, code: {} });

      expect(report.findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );
});
