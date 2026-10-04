import { beforeAll, describe, expect, it } from "vitest";
import { FRAME_CONTRACT_VERSION } from "../modules/frame";
import { bundledPreset } from "../modules/style";
import { BROWSER_TIMEOUT_MS, connect } from "./test-support/checker";
import { corpusEntries, frameMajor, PRESETS, replay, type Replayed } from "./test-support/corpus";

const entries = await corpusEntries();
const current = entries.filter(({ entry }) => frameMajor(entry.frameContractVersion) === frameMajor(FRAME_CONTRACT_VERSION));

/** Runs a replayed video through the core API's Checker: the current frame, `hyperframes lint`/`check` and the anchor contract. */
async function findingsOf({ storyboard, transcript, rules, code }: Replayed, preset: (typeof PRESETS)[number]) {
  const report = await connect().checker.check({ storyboard, transcript, rules, preset: bundledPreset(preset), code });

  return report.findings;
}

/**
 * The tier-2 replay: committed agent outputs and hand-written fixtures re-run at zero cost. Frame minor and patch
 * releases must keep old units passing lint, check and the contract (ADR 0004): every run written against this frame
 * major still passes, as first generated and after each of its Revisions. Runs from older majors are re-checked when
 * their Project opens instead.
 */
describe("the replay corpus", () => {
  it("has entries written against this frame major", () => {
    expect(current).not.toEqual([]);
  });

  describe.each(current)("$name", ({ entry }) => {
    let steps: Replayed[] = [];

    beforeAll(async () => {
      const { data, error } = await replay(entry);

      expect(error).toBeNull();
      steps = data ?? [];
    });

    it.each(["generation", ...entry.revisions.map((_, index) => `revision ${index + 1}`)])(
      "still passes every check after its %s",
      async (step) => {
        const replayed = steps.find((candidate) => candidate.step === step);

        expect(replayed).toBeDefined();
        expect(await findingsOf(replayed!, entry.preset)).toEqual([]);
      },
      BROWSER_TIMEOUT_MS,
    );

    // Scene code uses the frame's tokens only, so swapping the Palette and typography is a re-render that still passes.
    it.each(PRESETS.filter((preset) => preset !== entry.preset))(
      "still passes every check swapped into %s",
      async (preset) => {
        const last = steps[steps.length - 1];

        expect(last).toBeDefined();
        expect(await findingsOf(last!, preset)).toEqual([]);
      },
      BROWSER_TIMEOUT_MS,
    );
  });
});
