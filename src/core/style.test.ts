import { describe, expect, it } from "vitest";
import { ListedPresetSchema, StylePresetSchema, type ListedPreset, type StylePreset } from "../contract";
import { pacingFor, presetBrief, storyboardRules } from "../modules/style";
import storyboard from "./fixtures/checker/storyboard.json";
import transcript from "./fixtures/checker/transcript.json";
import { connect } from "./test-support/checker";

async function bundled(name: string): Promise<StylePreset> {
  const presets = await connect().style.presets();
  const found = presets.find((preset) => preset.name === name);

  if (!found) {
    throw new Error(`No bundled Preset named ${name}`);
  }

  // Parsing drops the listing's readOnly flag.
  return StylePresetSchema.parse(found);
}

/** The fixture Storyboard with both Scenes on one Canvas, moving between them by camera. */
const onCanvas = {
  ...storyboard,
  scenes: [
    { ...storyboard.scenes[0], canvas: "c1", transition: { type: "camera" } },
    { ...storyboard.scenes[1], canvas: "c1" },
  ],
};

describe("Style Presets", () => {
  it("bundles Blueprint, the default, then Whiteboard, Sketchbook and Terminal, all read-only", async () => {
    const presets = await connect().style.presets();

    expect(presets.map(({ name, readOnly }) => ({ name, readOnly }))).toEqual([
      { name: "Blueprint", readOnly: true },
      { name: "Whiteboard", readOnly: true },
      { name: "Sketchbook", readOnly: true },
      { name: "Terminal", readOnly: true },
    ]);
  });

  it("lists every bundled Preset in the Format-independent Style Preset shape", async () => {
    const presets = await connect().style.presets();

    for (const preset of presets) {
      expect(ListedPresetSchema.strict().safeParse(preset).error).toBeUndefined();
    }
  });

  it("keeps the bundled Presets read-only: changing a listed copy changes nothing", async () => {
    const client = connect();
    const [blueprint] = (await client.style.presets()) as [ListedPreset];

    blueprint.palette.colors.accent = "#000000";
    blueprint.transitions.push("carry-over");
    blueprint.direction = "Something else";

    const [again] = (await client.style.presets()) as [ListedPreset];
    expect(again.palette.colors.accent).toBe("#ff7a3d");
    expect(again.direction).not.toBe("Something else");
  });

  it("bundles 6 to 8 Palettes, light and dark", async () => {
    const palettes = await connect().style.palettes();

    expect(palettes.length).toBeGreaterThanOrEqual(6);
    expect(palettes.length).toBeLessThanOrEqual(8);
    expect(new Set(palettes.map(({ mode }) => mode))).toEqual(new Set(["light", "dark"]));
  });

  it("gives each Preset its own copy of a bundled Palette's colors and of a bundled font pairing", async () => {
    const client = connect();
    const [presets, palettes, pairings] = await Promise.all([client.style.presets(), client.style.palettes(), client.style.typography()]);

    for (const preset of presets) {
      expect(palettes).toContainEqual(preset.palette);
      expect(pairings).toContainEqual(preset.typography);
    }
  });

  it("pairs only bundled OFL fonts", async () => {
    const pairings = await connect().style.typography();
    const families = new Set(pairings.flatMap(({ display, body, label, mono }) => [display, body, label, mono].map(({ family }) => family)));

    expect(families).toEqual(new Set(["Inter", "JetBrains Mono", "Manrope", "IBM Plex Mono", "Fredoka", "Nunito", "VT323"]));
  });
});

describe("a Style Preset's direction, allowed Transitions and Canvas preference", () => {
  it("reach the Storyboard validator, which rejects a Transition the Preset doesn't allow", async () => {
    const whiteboard = await bundled("Whiteboard");
    const rules = storyboardRules(whiteboard, { format: "horizontal", captions: false });

    const { issues } = await connect().storyboard.validate({ storyboard, transcript, rules });

    expect(issues).toEqual([{ code: "TRANSITION", sceneId: "s01", field: "transition", message: expect.stringContaining('doesn\'t allow "cut"') }]);
  });

  it("reach the Storyboard validator, which rejects a Canvas when the Preset never uses one", async () => {
    const terminal = await bundled("Terminal");
    const rules = storyboardRules(terminal, { format: "horizontal", captions: false });

    const { issues } = await connect().storyboard.validate({ storyboard: onCanvas, transcript, rules });

    expect(issues.filter(({ code }) => code === "CANVAS").map(({ sceneId }) => sceneId)).toEqual(["s01", "s02"]);
  });

  it("let a Preset that uses a Canvas whenever possible move the camera across one", async () => {
    const whiteboard = await bundled("Whiteboard");
    const rules = storyboardRules(whiteboard, { format: "horizontal", captions: false });

    expect(await connect().storyboard.validate({ storyboard: onCanvas, transcript, rules })).toEqual({ issues: [] });
  });

  it("carry the video's Format and Captions into the rules", async () => {
    const blueprint = await bundled("Blueprint");

    expect(storyboardRules(blueprint, { format: "vertical", captions: true })).toEqual({
      format: "vertical",
      captions: true,
      transitions: blueprint.transitions,
      canvas: blueprint.canvas,
    });
  });

  describe.each(["storyboard", "sceneCode", "review"] as const)("reach the %s prompt", (role) => {
    it("with the direction, word for word", async () => {
      for (const name of ["Blueprint", "Whiteboard", "Sketchbook", "Terminal"]) {
        const preset = await bundled(name);

        expect(presetBrief(preset, "horizontal")[role]).toContain(preset.direction);
      }
    });

    it("with only the allowed Transitions", async () => {
      const terminal = await bundled("Terminal");

      const brief = presetBrief(terminal, "horizontal")[role];

      expect(brief).toContain('"cut"');
      expect(brief).toContain('"crossfade"');
      expect(brief).not.toMatch(/"push-left"|"zoom-through"|"carry-over"|"camera"/);
    });

    it("with the Canvas preference", async () => {
      const [terminal, whiteboard] = await Promise.all([bundled("Terminal"), bundled("Whiteboard")]);

      expect(presetBrief(terminal, "horizontal")[role]).toMatch(/Canvas: never/);
      expect(presetBrief(whiteboard, "horizontal")[role]).toMatch(/Canvas: whenever possible/);
    });
  });
});

describe("Motion energy", () => {
  it("sets the Scene lengths the Storyboard aims for, inside each Format's pacing", () => {
    expect(pacingFor("horizontal", "calm")).toEqual({ min: 3, max: 10, target: [5, 10] });
    expect(pacingFor("horizontal", "punchy")).toEqual({ min: 3, max: 10, target: [3, 6] });
    expect(pacingFor("vertical", "balanced")).toEqual({ min: 2.5, max: 7, target: [2.5, 6] });
  });

  it("reaches the Storyboard prompt as the Scene lengths to aim for", async () => {
    const whiteboard = await bundled("Whiteboard");

    expect(presetBrief(whiteboard, "horizontal").storyboard).toContain("5–10 s");
    expect(presetBrief(whiteboard, "vertical").storyboard).toContain("3.5–7 s");
  });
});
