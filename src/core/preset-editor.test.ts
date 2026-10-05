import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StylePresetSchema, type ContrastFinding, type ListedPreset, type Palette, type StylePreset } from "../contract";
import { presetSample } from "../modules/style";
import { BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";
import storyboard from "./fixtures/checker/storyboard.json";
import transcript from "./fixtures/checker/transcript.json";

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-presets-"));
});

afterAll(() => rm(workDir, { recursive: true, force: true }));

/** A core with its own app data folder, as a fresh install would have; pass one to reopen it. */
async function core(appDataDir?: string) {
  const dir = appDataDir ?? (await mkdtemp(join(workDir, "app-data-")));

  return { client: connect({ appDataDir: dir, cacheDir: join(dir, "cache") }), appDataDir: dir };
}

async function bundledPalette(name: string): Promise<Palette> {
  const palettes = await connect().style.palettes();
  const found = palettes.find((palette) => palette.name === name);

  if (!found) {
    throw new Error(`No bundled Palette named ${name}`);
  }

  return found;
}

/** The error a core API call failed with. */
async function rejectionOf(call: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ORPCError) {
      return error;
    }

    throw error;
  }

  throw new Error("The call didn't fail");
}

function editable(preset: ListedPreset): StylePreset {
  // Parsing drops the listing's readOnly flag.
  return StylePresetSchema.parse(preset);
}

describe("the contrast rule", () => {
  it("passes every bundled Palette, with nothing to block", async () => {
    const client = connect();

    for (const palette of await client.style.palettes()) {
      const { findings } = await client.style.contrast({ palette });

      expect(findings.filter(({ level }) => level === "block"), palette.name).toEqual([]);
    }
  });

  it("lets Sketchbook's mustard accent3 sit close to the paper, because it is only a fill with ink on it", async () => {
    const sketch = await bundledPalette("Sketch paper");

    const { findings } = await connect().style.contrast({ palette: sketch });

    expect(sketch.fills).toEqual(["accent3"]);
    expect(findings).toEqual([]);
  });

  it("blocks the same accent3 once it is used for text or lines, below 3:1 on bg and on surface", async () => {
    const sketch = await bundledPalette("Sketch paper");

    const { findings } = await connect().style.contrast({ palette: { ...sketch, fills: [] } });

    expect(findings).toEqual<ContrastFinding[]>([
      { level: "block", use: "accent", role: "accent3", against: "bg", ratio: 1.81, minimum: 3 },
      { level: "block", use: "accent", role: "accent3", against: "surface", ratio: 1.99, minimum: 3 },
    ]);
  });

  it("blocks a fill whose ink on it falls below WCAG AA", async () => {
    const sketch = await bundledPalette("Sketch paper");
    const dark = { ...sketch, colors: { ...sketch.colors, accent3: "#5a4a10" } };

    const { findings } = await connect().style.contrast({ palette: dark });

    expect(findings).toContainEqual(expect.objectContaining({ level: "block", use: "text", role: "ink", against: "accent3", minimum: 4.5 }));
  });

  it("warns when a fill is too close to bg to stand out", async () => {
    const sketch = await bundledPalette("Sketch paper");
    const faint = { ...sketch, colors: { ...sketch.colors, accent3: "#efe2c4" } };

    const { findings } = await connect().style.contrast({ palette: faint });

    expect(findings).toContainEqual(expect.objectContaining({ level: "warn", use: "fill", role: "accent3", against: "bg", minimum: 1.5 }));
    expect(findings.filter(({ level }) => level === "block")).toEqual([]);
  });

  it("blocks text below WCAG AA (4.5:1) on bg or surface", async () => {
    const whiteboard = await bundledPalette("Whiteboard");
    const grey = { ...whiteboard, colors: { ...whiteboard.colors, muted: "#9aa3b2" } };

    const { findings } = await connect().style.contrast({ palette: grey });

    expect(findings.filter(({ use }) => use === "text")).toEqual([
      { level: "block", use: "text", role: "muted", against: "bg", ratio: 2.39, minimum: 4.5 },
      { level: "block", use: "text", role: "muted", against: "surface", ratio: 2.54, minimum: 4.5 },
    ]);
  });

  it("blocks an accent used for text or lines that is too close to bg", async () => {
    const navy = await bundledPalette("Blueprint navy");
    const murky = { ...navy, colors: { ...navy.colors, accent: "#3a2a20" } };

    const { findings } = await connect().style.contrast({ palette: murky });

    expect(findings).toContainEqual(expect.objectContaining({ level: "block", use: "accent", role: "accent", against: "bg", minimum: 3 }));
  });

  it("compares unrounded ratios and rounds only what it shows: 2.998:1 fails 3:1 though it shows as 3", async () => {
    const whiteboard = await bundledPalette("Whiteboard");
    const amber = { ...whiteboard, colors: { ...whiteboard.colors, accent3: "#d97706" } };

    const { findings } = await connect().style.contrast({ palette: amber });

    expect(findings).toContainEqual({ level: "block", use: "accent", role: "accent3", against: "bg", ratio: 3, minimum: 3 });
  });

  it("warns when outlines and connectors fall below WCAG AA (3:1) on bg or surface", async () => {
    const navy = await bundledPalette("Blueprint navy");
    const quiet = { ...navy, colors: { ...navy.colors, line: "#3b4f78" } };
    const clear = { ...navy, colors: { ...navy.colors, line: "#5d7ab0" } };

    const { findings } = await connect().style.contrast({ palette: quiet });
    const { findings: clearFindings } = await connect().style.contrast({ palette: clear });

    expect(findings.filter(({ use }) => use === "line")).toEqual([
      expect.objectContaining({ level: "warn", role: "line", against: "bg", minimum: 3 }),
      expect.objectContaining({ level: "warn", role: "line", against: "surface", minimum: 3 }),
    ]);
    expect(clearFindings.filter(({ use }) => use === "line")).toEqual([]);
  });
});

describe("the bundled fonts", () => {
  it("lists each family with the weights the frame ships", async () => {
    const fonts = await connect().style.fonts();

    expect(fonts).toContainEqual({ family: "Inter", weights: [400, 600, 700, 800] });
    expect(fonts).toContainEqual({ family: "VT323", weights: [400] });
    expect(fonts).toHaveLength(7);
  });
});

describe("a creator's own Style Presets", () => {
  it("start as a duplicate of a bundled Preset, editable and listed after the bundled ones", async () => {
    const { client } = await core();

    const copy = await client.style.duplicate({ id: "sketchbook" });
    const presets = await client.style.presets();

    expect(copy).toMatchObject({ id: "sketchbook-copy", name: "Sketchbook copy", readOnly: false });
    expect(editable(copy)).toEqual({ ...editable(presets.find(({ id }) => id === "sketchbook")!), id: "sketchbook-copy", name: "Sketchbook copy" });
    expect(presets.map(({ id }) => id)).toEqual(["blueprint", "whiteboard", "sketchbook", "terminal", "sketchbook-copy"]);
  });

  it("number a second copy of the same Preset", async () => {
    const { client } = await core();

    await client.style.duplicate({ id: "blueprint" });
    const second = await client.style.duplicate({ id: "blueprint" });

    expect(second).toMatchObject({ id: "blueprint-copy-2", name: "Blueprint copy 2" });
  });

  it("save edits, which a later session still has", async () => {
    const { client, appDataDir } = await core();
    const copy = editable(await client.style.duplicate({ id: "whiteboard" }));
    const edited: StylePreset = {
      ...copy,
      name: "Calm board",
      motion: { energy: "calm", character: "snappy" },
      treatments: { ...copy.treatments, radius: 4, texture: "film-grain" },
      transitions: ["crossfade"],
      canvas: "never",
      captions: "pop",
      direction: "Quiet and precise.",
    };

    const saved = await client.style.save({ preset: edited });
    const { client: later } = await core(appDataDir);

    // Whiteboard's quiet lines save with their warning.
    expect(saved).toEqual({ preset: { ...edited, readOnly: false }, findings: [expect.objectContaining({ use: "line", against: "bg" }), expect.objectContaining({ use: "line", against: "surface" })] });
    expect((await later.style.presets()).find(({ id }) => id === copy.id)).toEqual({ ...edited, readOnly: false });
  });

  it("save with the warnings the contrast rule has", async () => {
    const { client } = await core();
    const copy = editable(await client.style.duplicate({ id: "sketchbook" }));
    const faint = { ...copy, palette: { ...copy.palette, colors: { ...copy.palette.colors, accent3: "#efe2c4" } } };

    const { findings } = await client.style.save({ preset: faint });

    expect(findings).toEqual([expect.objectContaining({ level: "warn", role: "accent3" })]);
  });

  it("refuse to save what the contrast rule blocks, and keep the Preset as it was", async () => {
    const { client } = await core();
    const copy = editable(await client.style.duplicate({ id: "sketchbook" }));
    const unreadable = { ...copy, palette: { ...copy.palette, fills: [] } };

    const error = await rejectionOf(client.style.save({ preset: unreadable }));

    expect(error.code).toBe("LOW_CONTRAST");
    expect(error.data).toEqual({ findings: [expect.objectContaining({ role: "accent3", against: "bg" }), expect.objectContaining({ role: "accent3", against: "surface" })] });
    expect((await client.style.presets()).find(({ id }) => id === copy.id)?.palette.fills).toEqual(["accent3"]);
  });

  it("refuse a font weight the frame doesn't bundle", async () => {
    const { client } = await core();
    const copy = editable(await client.style.duplicate({ id: "terminal" }));
    const bold = { ...copy, typography: { ...copy.typography, display: { ...copy.typography.display, weight: 700 } } };

    const error = await rejectionOf(client.style.save({ preset: bold }));

    expect(error.code).toBe("UNBUNDLED_WEIGHT");
    expect(error.data).toEqual({ family: "VT323", weight: 700, weights: [400] });
  });

  it("keep the bundled Presets read-only", async () => {
    const { client } = await core();
    const [blueprint] = await client.style.presets();

    expect((await rejectionOf(client.style.save({ preset: { ...editable(blueprint!), name: "Mine" } }))).code).toBe("READ_ONLY");
    expect((await rejectionOf(client.style.remove({ id: "blueprint" }))).code).toBe("READ_ONLY");
    expect((await client.style.presets())[0]?.name).toBe("Blueprint");
  });

  it("are saved only once duplicated", async () => {
    const { client } = await core();
    const [blueprint] = await client.style.presets();

    const error = await rejectionOf(client.style.save({ preset: { ...editable(blueprint!), id: "made-up" } }));

    expect(error.code).toBe("UNKNOWN_PRESET");
  });

  it("each get their own id when duplicated at the same time", async () => {
    const { client } = await core();

    const copies = await Promise.all([client.style.duplicate({ id: "blueprint" }), client.style.duplicate({ id: "blueprint" }), client.style.duplicate({ id: "blueprint" })]);
    const own = (await client.style.presets()).filter(({ readOnly }) => !readOnly);

    expect(copies.map(({ id }) => id)).toEqual(["blueprint-copy", "blueprint-copy-2", "blueprint-copy-3"]);
    expect(own.map(({ id }) => id)).toEqual(["blueprint-copy", "blueprint-copy-2", "blueprint-copy-3"]);
  });

  it("refuse an id that would reach outside their folder", async () => {
    const { client, appDataDir } = await core();
    const outside = join(appDataDir, "settings.json");
    await writeFile(outside, "{}");

    const errors = await Promise.all(["../settings", "..\\settings", "Blueprint"].map((id) => rejectionOf(client.style.remove({ id }))));
    const duplicateError = await rejectionOf(client.style.duplicate({ id: "../settings" }));

    expect(errors.map(({ code }) => code)).toEqual(["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST"]);
    expect(duplicateError.code).toBe("BAD_REQUEST");
    expect(await readFile(outside, "utf8")).toBe("{}");
  });

  it("can be deleted", async () => {
    const { client } = await core();
    const copy = await client.style.duplicate({ id: "terminal" });

    await client.style.remove({ id: copy.id });

    expect((await client.style.presets()).map(({ id }) => id)).not.toContain(copy.id);
  });

  it("never change a video made with them, whether edited or deleted", async () => {
    const { client } = await core();
    const copy = editable(await client.style.duplicate({ id: "blueprint" }));
    // A video keeps its own snapshot of the Preset it was made with.
    const snapshot = structuredClone(copy);
    const video = { storyboard, transcript, rules: RULES, preset: snapshot, code: {} };
    const before = await client.preview.open(video);

    await client.style.save({ preset: { ...copy, palette: { ...copy.palette, colors: { ...copy.palette.colors, accent: "#22d3ee" } } } });
    const afterEdit = await client.preview.open(video);
    await client.style.remove({ id: copy.id });
    const afterDelete = await client.preview.open(video);

    expect(snapshot).toEqual(copy);
    expect([afterEdit.id, afterDelete.id]).toEqual([before.id, before.id]);
  });
});

describe("a Preset's sample", () => {
  it(
    "is a still of a diagram drawn in the bundled frame in that Preset, the same each time",
    async () => {
      const { client } = await core();
      const presets = await client.style.presets();
      const blueprint = editable(presets[0]!);
      const sketchbook = editable(presets[2]!);

      const first = await client.style.sample({ preset: blueprint });
      const again = await client.style.sample({ preset: blueprint });
      const other = await client.style.sample({ preset: sketchbook });

      expect(first.image).toMatch(/^data:image\/jpeg;base64,/);
      expect(again.image).toBe(first.image);
      expect(other.image).not.toBe(first.image);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "is drawn from Scene code that passes the Checker, as agent-written code must",
    async () => {
      const [blueprint] = await connect().style.presets();
      const { source } = presetSample(editable(blueprint!));

      const { findings } = await connect().checker.check(source);

      expect(findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );
});
