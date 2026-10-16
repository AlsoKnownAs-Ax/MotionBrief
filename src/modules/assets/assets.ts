import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AssetSchema, type Asset, type AssetKind, type AudioFormat, type ImageAsset, type ImageFormat, type SoundAsset } from "../../contract";
import type { Media, MediaInfo } from "../media";
import { copyHashed, fileStep, renameRetrying, writeAtomically, type FileError, type Projects } from "../projects";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type AssetsError =
  | FileError
  | { code: "UNKNOWN_PROJECT"; projectId: string }
  | { code: "UNSUPPORTED_FORMAT"; path: string; kind: AssetKind; detail: string }
  | { code: "ASSET_TOO_LARGE"; path: string; bytes: number; maxBytes: number }
  | { code: "ASSET_TOO_LONG"; path: string; duration: number; maxSeconds: number }
  | { code: "NOTES_REQUIRED"; kind: AssetKind }
  | { code: "UNKNOWN_ASSET"; id: string };

/** What the creator writes in the import dialog. */
export type NewAsset = { path: string; name: string; kind: AssetKind; notes: string };

export type AssetChanges = { name?: string; notes?: string };

export type AssetsOptions = { media: Media; projects: Pick<Projects, "inFolder"> };

export type Assets = ReturnType<typeof createAssets>;

/** The Project subfolder Project Assets live in, beside the Voiceover. */
export const ASSETS_DIR = "assets";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const MAX_SOUND_SECONDS = 15 * 60;

/** The written fields every Asset has; the rest of a sidecar is measured. */
type Written = "id" | "name" | "notes";

type Facts = Omit<SoundAsset, Written> | Omit<ImageAsset, Written>;

/** A sidecar is the Asset as listed plus its file version and whether it was removed while a Version still uses it. */
const SidecarMetaSchema = z.object({ schemaVersion: z.literal(1), removed: z.boolean().optional() });

type Sidecar = { asset: Asset; removed: boolean };

/** FFprobe container names, as split from its comma list, and the format each is accepted as. */
const AUDIO_CONTAINERS: Record<string, AudioFormat> = { wav: "wav", mp3: "mp3", m4a: "m4a", ogg: "ogg", flac: "flac" };

/** FFprobe codec names of the raster formats images and logos accept. */
const IMAGE_CODECS: Record<string, ImageFormat> = { png: "png", mjpeg: "jpeg", webp: "webp" };

/** An SVG root element, after any XML declaration, comments and doctype. */
const SVG_ROOT = /^\uFEFF?\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg\b([^>]*)>/i;

/**
 * Assets: sound effects, music, images and logos the creator imports. A user Asset's id is the sha256 of its bytes,
 * so importing the same file twice gives one Asset.
 *
 * Project Assets live in `<Project>/assets/` as `<sha256>.<format>` plus a `<sha256>.json` sidecar: the listed Asset
 * (name, kind and notes from the creator; format with duration and loudness for sounds, or width, height and
 * transparency for images) with a `schemaVersion` and, while a Version still uses a removed Asset, `removed: true`.
 * Every file step runs in the Project's folder queue, so it never races a rename of the Project.
 */
export function createAssets({ media, projects }: AssetsOptions) {
  /** The Project's Assets that aren't removed, optionally of one kind, by name. */
  function list(projectId: string, { kind }: { kind?: AssetKind } = {}): Promise<Result<Asset[], AssetsError>> {
    return projects.inFolder<Asset[], AssetsError>(projectId, async (projectDir) => {
      const dir = join(projectDir, ASSETS_DIR);
      const { data: names } = await fileStep(dir, () => readdir(dir));
      const sidecars = await Promise.all((names ?? []).filter((name) => name.endsWith(".json")).map((name) => readSidecar(join(dir, name))));
      const assets = sidecars
        .flatMap((sidecar) => (sidecar && !sidecar.removed && (kind === undefined || sidecar.asset.kind === kind) ? [sidecar.asset] : []))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { data: assets, error: null };
    });
  }

  /** Validates and measures the file, then copies it into the Project; the original is never read again. */
  async function importAsset(projectId: string, { path, name, kind, notes }: NewAsset): Promise<Result<Asset, AssetsError>> {
    if (needsNotes(kind) && notes.trim() === "") {
      return { data: null, error: { code: "NOTES_REQUIRED", kind } };
    }

    const { data: facts, error } = isSound(kind) ? await soundFacts(path, kind) : await imageFacts(path, kind);

    if (error) {
      return { data: null, error };
    }

    return projects.inFolder<Asset, AssetsError>(projectId, async (projectDir) => {
      const dir = join(projectDir, ASSETS_DIR);
      const { error: dirError } = await fileStep(dir, () => mkdir(dir, { recursive: true }));

      if (dirError) {
        return { data: null, error: dirError };
      }

      // The name is the hash of what was copied, known only once the copy is done.
      const incoming = join(dir, `${randomUUID()}.importing`);
      const { data: sha256, error: copyError } = await copyHashed(path, incoming);

      if (copyError) {
        return { data: null, error: copyError };
      }

      const file = join(dir, `${sha256}.${facts.format}`);
      const { error: renameError } = await fileStep(file, () => renameRetrying(incoming, file));

      if (renameError) {
        await rm(incoming, { force: true });

        return { data: null, error: renameError };
      }

      const asset: Asset = { id: sha256, name: name.trim(), notes: notes.trim(), ...facts };

      return saveSidecar(dir, asset);
    });
  }

  /** Renames an Asset or rewrites its notes. */
  function update(projectId: string, id: string, { name, notes }: AssetChanges): Promise<Result<Asset, AssetsError>> {
    return projects.inFolder<Asset, AssetsError>(projectId, async (projectDir) => {
      const dir = join(projectDir, ASSETS_DIR);
      const sidecar = await readListed(dir, id);

      if (!sidecar) {
        return { data: null, error: { code: "UNKNOWN_ASSET", id } };
      }

      const asset: Asset = { ...sidecar.asset, name: name?.trim() ?? sidecar.asset.name, notes: notes?.trim() ?? sidecar.asset.notes };

      if (needsNotes(asset.kind) && asset.notes === "") {
        return { data: null, error: { code: "NOTES_REQUIRED", kind: asset.kind } };
      }

      return saveSidecar(dir, asset);
    });
  }

  /** Hides an Asset from listings, and deletes its bytes unless a Version still uses them. */
  function remove(projectId: string, id: string): Promise<Result<null, AssetsError>> {
    return projects.inFolder<null, AssetsError>(projectId, async (projectDir) => {
      const dir = join(projectDir, ASSETS_DIR);
      const sidecar = await readListed(dir, id);

      if (!sidecar) {
        return { data: null, error: { code: "UNKNOWN_ASSET", id } };
      }

      if (usedByVersions()) {
        const { error } = await saveSidecar(dir, sidecar.asset, { removed: true });

        return error ? { data: null, error } : { data: null, error: null };
      }

      // The sidecar goes first: bytes left behind by a crash are never listed, and a new import overwrites them.
      const sidecarPath = join(dir, `${id}.json`);
      const { error } = await fileStep(sidecarPath, () => rm(sidecarPath, { force: true }));

      if (error) {
        return { data: null, error };
      }

      const file = join(dir, `${id}.${sidecar.asset.format}`);
      const { error: rmError } = await fileStep(file, () => rm(file, { force: true }));

      return rmError ? { data: null, error: rmError } : { data: null, error: null };
    });
  }

  async function soundFacts(path: string, kind: SoundAsset["kind"]): Promise<Result<Facts, AssetsError>> {
    const { data: info, error } = await media.probe(path);

    if (error) {
      return unsupported(path, kind, error.code === "NO_AUDIO" ? "It has no sound." : "It can't be read as audio.");
    }

    const format = audioFormat(info);

    if (!format) {
      return unsupported(path, kind, "It isn't WAV, MP3, M4A, OGG, Opus or FLAC audio.");
    }

    if (info.duration > MAX_SOUND_SECONDS) {
      return { data: null, error: { code: "ASSET_TOO_LONG", path, duration: info.duration, maxSeconds: MAX_SOUND_SECONDS } };
    }

    // A sound effect can be shorter than the 400 ms integrated loudness gates on, so it is measured at its loudest.
    const { data: loudness, error: loudnessError } = kind === "music" ? await media.loudness(path) : await media.momentaryMax(path);

    if (loudnessError) {
      return unsupported(path, kind, "It can't be decoded.");
    }

    return { data: { kind, format, duration: info.duration, loudness }, error: null };
  }

  async function imageFacts(path: string, kind: ImageAsset["kind"]): Promise<Result<Facts, AssetsError>> {
    const { data: stats, error } = await fileStep(path, () => stat(path));

    if (error) {
      return { data: null, error };
    }

    if (stats.size > MAX_IMAGE_BYTES) {
      return { data: null, error: { code: "ASSET_TOO_LARGE", path, bytes: stats.size, maxBytes: MAX_IMAGE_BYTES } };
    }

    const { data: text, error: readError } = await fileStep(path, () => readFile(path, "utf8"));

    if (readError) {
      return { data: null, error: readError };
    }

    const svg = SVG_ROOT.exec(text);

    if (svg) {
      const size = svgSize(svg[1] ?? "");

      if (!size) {
        return unsupported(path, kind, "The SVG has no width and height or viewBox.");
      }

      // shortcut: an SVG counts as transparent (it has no background unless it draws one); rasterize it to check if opaque logos sit bare.
      return { data: { kind, format: "svg", ...size, transparent: true }, error: null };
    }

    const { data: image, error: probeError } = await media.probeImage(path);
    const format = image && IMAGE_CODECS[image.codec];

    if (probeError || !format) {
      return unsupported(path, kind, "It isn't a PNG, JPEG, WebP or SVG image.");
    }

    return { data: { kind, format, width: image.width, height: image.height, transparent: image.transparent }, error: null };
  }

  return { list, import: importAsset, update, remove };
}

/** The sidecar of a listed Asset, or undefined for an id that isn't a sha256, an unknown one or a removed one. */
async function readListed(dir: string, id: string): Promise<Sidecar | undefined> {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    return undefined;
  }

  const sidecar = await readSidecar(join(dir, `${id}.json`));

  return sidecar?.removed ? undefined : sidecar;
}

/** A sidecar that isn't a valid Asset is left alone and not listed. */
async function readSidecar(path: string): Promise<Sidecar | undefined> {
  const { data: text } = await fileStep(path, () => readFile(path, "utf8"));
  const json = parseJson(text ?? "");
  const { data: asset } = AssetSchema.safeParse(json);
  const { data: meta } = SidecarMetaSchema.safeParse(json);

  if (!asset || !meta) {
    return undefined;
  }

  return { asset, removed: meta.removed ?? false };
}

async function saveSidecar(dir: string, asset: Asset, { removed = false } = {}): Promise<Result<Asset, AssetsError>> {
  const path = join(dir, `${asset.id}.json`);
  const { error } = await writeAtomically(path, `${JSON.stringify({ schemaVersion: 1, ...asset, ...(removed && { removed }) }, null, 2)}\n`);

  return error ? { data: null, error } : { data: asset, error: null };
}

// shortcut: no Version references Assets yet, so none keeps a removed Asset's bytes; check the Versions here once they record Asset uses.
function usedByVersions() {
  return false;
}

function isSound(kind: AssetKind): kind is SoundAsset["kind"] {
  return kind === "sfx" || kind === "music";
}

/** The agent never guesses what a picture shows. */
function needsNotes(kind: AssetKind) {
  return !isSound(kind);
}

/** Video files are refused even when their container is one sounds use. */
function audioFormat({ container, codec, isVideo }: MediaInfo): AudioFormat | undefined {
  const format = container
    .split(",")
    .map((name) => AUDIO_CONTAINERS[name])
    .find((found) => found !== undefined);

  if (isVideo || !format) {
    return undefined;
  }

  return format === "ogg" && codec === "opus" ? "opus" : format;
}

/** Plain or px `width` and `height`, else the viewBox's. */
function svgSize(attributes: string): { width: number; height: number } | undefined {
  const attribute = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(attributes)?.[1];
  const length = (value: string | undefined) => (value && /^\s*\d*\.?\d+\s*(px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined);
  const width = length(attribute("width"));
  const height = length(attribute("height"));

  if (width && height) {
    return { width, height };
  }

  const [, , boxWidth = 0, boxHeight = 0] = (attribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);

  return boxWidth > 0 && boxHeight > 0 ? { width: boxWidth, height: boxHeight } : undefined;
}

function unsupported(path: string, kind: AssetKind, detail: string): Result<never, AssetsError> {
  return { data: null, error: { code: "UNSUPPORTED_FORMAT", path, kind, detail } };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
