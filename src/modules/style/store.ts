import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FontFamilySchema, StylePresetSchema, type BundledFont, type ContrastFinding, type FontFamily, type ListedPreset, type StylePreset } from "../../contract";
import { bundledWeights } from "../frame";
import { checkContrast } from "./contrast";
import { listPresets } from "./presets";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type PresetFileError = { code: "FILE_FAILED"; path: string; message: string };

export type PresetStoreError =
  | PresetFileError
  | { code: "READ_ONLY"; id: string }
  | { code: "UNKNOWN_PRESET"; id: string }
  | { code: "LOW_CONTRAST"; findings: ContrastFinding[] }
  | { code: "UNBUNDLED_WEIGHT"; family: FontFamily; weight: number; weights: number[] };

export type PresetStore = ReturnType<typeof createPresetStore>;

/** One file per Preset, so saving one never rewrites another. */
const PresetFileSchema = z.object({ schemaVersion: z.literal(1), createdAt: z.number(), preset: StylePresetSchema });

type PresetFile = z.infer<typeof PresetFileSchema>;

const NAME_MAX = 40;

/**
 * The creator's own Style Presets, kept in app data beside the bundled ones. Each starts as a duplicate and is
 * edited with pickers; a save is refused when the contrast rule blocks its Palette or a face uses a weight the
 * frame doesn't ship. A video keeps its own snapshot, so nothing here ever changes one.
 */
export function createPresetStore({ dir }: { dir: string }) {
  /** Bundled first, then the creator's in the order they were made. */
  async function list(): Promise<ListedPreset[]> {
    const own = (await readAll()).map(({ preset }) => ({ ...preset, readOnly: false }));

    return [...listPresets(), ...own];
  }

  async function get(id: string): Promise<ListedPreset | undefined> {
    return (await list()).find((preset) => preset.id === id);
  }

  async function duplicate(id: string): Promise<Result<ListedPreset, PresetStoreError>> {
    const presets = await list();
    const source = presets.find((preset) => preset.id === id);

    if (!source) {
      return { data: null, error: { code: "UNKNOWN_PRESET", id } };
    }

    const name = copyName(source.name, new Set(presets.map(({ name }) => name)));
    // Parsing drops the listing's readOnly flag.
    const copy: StylePreset = { ...StylePresetSchema.parse(source), id: freeId(slugOf(name), new Set(presets.map(({ id }) => id))), name };
    const { error } = await write({ schemaVersion: 1, createdAt: Date.now(), preset: copy });

    if (error) {
      return { data: null, error };
    }

    return { data: { ...copy, readOnly: false }, error: null };
  }

  async function save(preset: StylePreset): Promise<Result<{ preset: ListedPreset; findings: ContrastFinding[] }, PresetStoreError>> {
    if (listPresets().some(({ id }) => id === preset.id)) {
      return { data: null, error: { code: "READ_ONLY", id: preset.id } };
    }

    const existing = await readOne(preset.id);

    if (!existing) {
      return { data: null, error: { code: "UNKNOWN_PRESET", id: preset.id } };
    }

    const unbundled = unbundledWeight(preset);

    if (unbundled) {
      return { data: null, error: unbundled };
    }

    const findings = checkContrast(preset.palette);
    const blocking = findings.filter(({ level }) => level === "block");

    if (blocking.length > 0) {
      return { data: null, error: { code: "LOW_CONTRAST", findings: blocking } };
    }

    const { error } = await write({ ...existing, preset });

    if (error) {
      return { data: null, error };
    }

    return { data: { preset: { ...preset, readOnly: false }, findings }, error: null };
  }

  async function remove(id: string): Promise<Result<null, PresetStoreError>> {
    if (listPresets().some((preset) => preset.id === id)) {
      return { data: null, error: { code: "READ_ONLY", id } };
    }

    const path = pathOf(id);
    const { error } = await fileStep(path, () => rm(path, { force: true }));

    if (error) {
      return { data: null, error };
    }

    return { data: null, error: null };
  }

  async function readAll(): Promise<PresetFile[]> {
    const { data: names } = await fileStep(dir, () => readdir(dir));
    const files = await Promise.all((names ?? []).filter((name) => name.endsWith(".json")).map((name) => readFileAt(join(dir, name))));

    return files.filter((file) => file !== undefined).sort((a, b) => a.createdAt - b.createdAt);
  }

  function readOne(id: string): Promise<PresetFile | undefined> {
    return readFileAt(pathOf(id));
  }

  /** A file that isn't a valid Preset is left alone and not listed. */
  async function readFileAt(path: string): Promise<PresetFile | undefined> {
    const { data: text } = await fileStep(path, () => readFile(path, "utf8"));

    if (text === null) {
      return undefined;
    }

    const { data: file } = PresetFileSchema.safeParse(parseJson(text));

    return file;
  }

  /** Written in full beside its destination, then renamed into place, so a crash never leaves half a Preset. */
  function write(file: PresetFile) {
    const path = pathOf(file.preset.id);

    return fileStep(path, async () => {
      const staged = `${path}.${randomUUID()}.tmp`;

      try {
        await mkdir(dir, { recursive: true });
        await writeFile(staged, `${JSON.stringify(file, null, 2)}\n`);
        await rename(staged, path);
      } finally {
        await rm(staged, { force: true });
      }
    });
  }

  function pathOf(id: string) {
    return join(dir, `${id}.json`);
  }

  return { list, get, duplicate, save, remove };
}

/** The frame's families with the weights it ships. */
export function bundledFonts(): BundledFont[] {
  return FontFamilySchema.options.map((family) => ({ family, weights: bundledWeights(family) }));
}

function unbundledWeight({ typography }: StylePreset): PresetStoreError | undefined {
  const faces = [typography.display, typography.body, typography.label, typography.mono];
  const face = faces.find(({ family, weight }) => !bundledWeights(family).includes(weight));

  if (!face) {
    return undefined;
  }

  return { code: "UNBUNDLED_WEIGHT", family: face.family, weight: face.weight, weights: bundledWeights(face.family) };
}

/** "Blueprint copy", then "Blueprint copy 2" while that name is taken. */
function copyName(name: string, taken: Set<string>, attempt = 1): string {
  const suffix = attempt === 1 ? " copy" : ` copy ${attempt}`;
  const candidate = `${name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;

  return taken.has(candidate) ? copyName(name, taken, attempt + 1) : candidate;
}

/** A kebab-case id from a name; it never changes after, even when the Preset is renamed. */
function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return /^[a-z]/.test(slug) ? slug : `preset-${slug}`.replace(/-+$/, "");
}

function freeId(base: string, taken: Set<string>, attempt = 1): string {
  const candidate = attempt === 1 ? base : `${base}-${attempt}`;

  return taken.has(candidate) ? freeId(base, taken, attempt + 1) : candidate;
}

async function fileStep<T>(path: string, step: () => Promise<T>): Promise<Result<T, PresetFileError>> {
  try {
    return { data: await step(), error: null };
  } catch (error) {
    return { data: null, error: { code: "FILE_FAILED", path, message: String(error) } };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
