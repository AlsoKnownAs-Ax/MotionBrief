import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { CheckFinding, UnitCode } from "../contract";
import storyboard from "./fixtures/checker/storyboard.json";
import transcript from "./fixtures/checker/transcript.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";

/** Scene code for a unit, as hand-written in `fixtures/checker/<variant>/<unit>.{css,html,js}`. */
async function unitCode(variant: string, unit: string): Promise<UnitCode> {
  const [css, html, js] = await Promise.all(
    ["css", "html", "js"].map((part) => readFile(join(import.meta.dirname, "fixtures", "checker", variant, `${unit}.${part}`), "utf8")),
  );

  return { css: css ?? "", html: html ?? "", js: js ?? "" };
}

async function goodCode() {
  return { s01: await unitCode("good", "s01"), s02: await unitCode("good", "s02") };
}

describe("Checker", () => {
  it(
    "passes hand-written, token-only Scene code, deliberate layering and a faint texture included, with no findings",
    async () => {
      const report = await connect().checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code: await goodCode() });

      expect(report).toEqual({ frameContractVersion: "1.0.0", findings: [] });
    },
    BROWSER_TIMEOUT_MS,
  );

  describe("on faulty Scene code", () => {
    let findings: CheckFinding[] = [];

    beforeAll(async () => {
      const code = { s01: await unitCode("faulty", "s01"), s02: await unitCode("faulty", "s02") };
      ({ findings } = await connect().checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code }));
    }, BROWSER_TIMEOUT_MS);

    it("reports a Storyboard element missing from the page", () => {
      expect(located(findings)).toContainEqual({ unit: "s01", source: "contract", code: "MISSING_ELEMENT", selector: "#s01-database" });
    });

    it("reports an element that arrives after its word + 0.1 s", () => {
      expect(located(findings)).toContainEqual({ unit: "s01", source: "contract", code: "LATE", selector: "#s01-browser" });
    });

    it("reports an element already visible 0.3 s before its word", () => {
      expect(located(findings)).toContainEqual({ unit: "s01", source: "contract", code: "EARLY", selector: "#s01-server" });
    });

    it("reports a connector drawn by hand rather than laid out by MB.connect", () => {
      expect(located(findings)).toContainEqual({
        unit: "s01",
        source: "contract",
        code: "HAND_DRAWN_CONNECTOR",
        selector: "#s01-browser-server",
      });
    });

    it("reports an element id used twice in the page", () => {
      expect(located(findings)).toContainEqual({ unit: "s02", source: "contract", code: "DUPLICATE_ELEMENT_ID", selector: "#s02-caption" });
    });

    it("accepts the elements that keep the contract", () => {
      const contract = located(findings).filter(({ source }) => source === "contract");

      expect(contract.map(({ selector }) => selector).sort()).toEqual([
        "#s01-browser",
        "#s01-browser-server",
        "#s01-database",
        "#s01-server",
        "#s02-caption",
      ]);
    });

    it("rejects raw colors and fonts other than the frame's, in the CSS, the markup and the script", () => {
      const tokens = findings.filter(({ source }) => source === "tokens").map(({ unit, code, message }) => ({ unit, code, message }));

      expect(tokens).toEqual([
        { unit: "s01", code: "RAW_COLOR", message: expect.stringMatching(/^Raw color #ffffff in the css\./) },
        { unit: "s01", code: "FOREIGN_FONT", message: expect.stringMatching(/^Raw fontFamily "Comic Sans MS" in the js\./) },
        { unit: "s02", code: "RAW_COLOR", message: expect.stringMatching(/^Raw color name "white" in the html\./) },
        { unit: "s02", code: "RAW_COLOR", message: expect.stringMatching(/^Raw color function rgba\(\) in the js\./) },
      ]);
    });

    it("reports an icon that isn't in the bundled sets", () => {
      expect(located(findings)).toContainEqual({ unit: "s01", source: "icons", code: "UNKNOWN_ICON", selector: undefined });
    });

    it("maps a HyperFrames layout finding to the unit it was found in", () => {
      expect(located(findings)).toContainEqual({ unit: "s02", source: "check", code: "content_overlap", selector: expect.any(String) });
    });
  });

  describe("on Scene code breaking the Checker's own rules", () => {
    let findings: CheckFinding[] = [];

    beforeAll(async () => {
      const code = { s01: await unitCode("rules", "s01"), s02: await unitCode("rules", "s02") };
      ({ findings } = await connect().checker.check({ storyboard, transcript, rules: RULES, code }));
    }, BROWSER_TIMEOUT_MS);

    it("reports an icon laid over text that nothing marks as deliberate layering", () => {
      expect(findings.filter(({ code }) => code === "ICON_OVERLAPS_TEXT")).toEqual([
        {
          unit: "s01",
          source: "rules",
          code: "ICON_OVERLAPS_TEXT",
          selector: "#s01-browser > svg.cursor",
          message: expect.stringMatching(/overlaps the text "Browser".*data-layout-allow-overlap/),
          time: expect.any(Number),
        },
      ]);
    });

    it("reports a texture overlay at opacity 0.6 or above", () => {
      expect(findings.filter(({ code }) => code === "TEXTURE_TOO_OPAQUE")).toEqual([
        {
          unit: "s02",
          source: "rules",
          code: "TEXTURE_TOO_OPAQUE",
          selector: "#root > div.scanlines",
          message: expect.stringMatching(/reaches opacity 0\.7\b.*below 0\.6/),
          time: expect.any(Number),
        },
      ]);
    });

    it("reports nothing else of its own", () => {
      expect(findings.filter(({ source }) => source === "rules").map(({ code }) => code)).toEqual(["ICON_OVERLAPS_TEXT", "TEXTURE_TOO_OPAQUE"]);
    });
  });

  describe("refuses to check", () => {
    it("an invalid Storyboard, with its issues", async () => {
      const invalid = { ...storyboard, scenes: [storyboard.scenes[0], { ...storyboard.scenes[1], id: "s01" }] };

      const check = connect().checker.check({ storyboard: invalid, transcript, rules: RULES, preset: BLUEPRINT, code: {} });

      await expect(check).rejects.toMatchObject({
        code: "INVALID_STORYBOARD",
        data: { issues: [{ code: "DUPLICATE_ID", sceneId: "s01", field: "id", message: expect.any(String) }] },
      });
    });

    it("code for a unit the Storyboard doesn't have", async () => {
      const code = { s01: await unitCode("good", "s01"), s03: await unitCode("good", "s02") };

      const check = connect().checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code });

      await expect(check).rejects.toMatchObject({ code: "UNKNOWN_UNIT", data: { unit: "s03", units: ["s01", "s02"] } });
    });

    it("without the pinned chrome-headless-shell, saying where it should be", async () => {
      const chromePath = join(import.meta.dirname, "no-such-chrome");

      const check = connect({ chromePath }).checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code: await goodCode() });

      await expect(check).rejects.toMatchObject({ code: "CHECKER_UNAVAILABLE", data: { cause: "CHROME_MISSING", detail: chromePath } });
    });
  });

  it(
    "maps a HyperFrames lint finding to the unit whose file it was found in",
    async () => {
      const code = { s01: await unitCode("good", "s01"), s02: await unitCode("lint", "s02") };

      const { findings } = await connect().checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code });

      expect(located(findings).filter(({ source }) => source === "lint")).toEqual([
        { unit: "s02", source: "lint", code: "font_family_without_font_face", selector: expect.any(String) },
      ]);
    },
    BROWSER_TIMEOUT_MS,
  );
});

/** The parts of a finding that say where it is: what an agent needs to find and fix it. */
function located(findings: CheckFinding[]) {
  return findings.map(({ unit, source, code, selector }) => ({ unit, source, code, selector }));
}
