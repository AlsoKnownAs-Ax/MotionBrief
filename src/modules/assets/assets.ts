import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  AssetSchema,
  NO_ASSET,
  SoundAssetSchema,
  SoundRoleSchema,
  type Asset,
  type AssetKind,
  type AudioFormat,
  type BundledCheck,
  type ImageAsset,
  type ImageFormat,
  type IndexedAsset,
  type SoundAsset,
  type StoryboardTranscript,
  type StylePreset,
} from "../../contract";
import { carveBed, planSound, type PlannedBed, type SoundFile, type SoundPlan } from "../assembler";
import type { Media, MediaInfo } from "../media";
import type { Storyboard } from "../storyboard";
import { copyHashed, fileStep, renameRetrying, savedVersions, writeAtomically, type FileError, type Projects, type VideoContent } from "../projects";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type AssetsError =
  | FileError
  | { code: "UNKNOWN_PROJECT"; projectId: string }
  | { code: "UNSUPPORTED_FORMAT"; path: string; kind: AssetKind; detail: string }
  | { code: "ASSET_TOO_LARGE"; path: string; bytes: number; maxBytes: number }
  | { code: "ASSET_TOO_LONG"; path: string; duration: number; maxSeconds: number }
  | { code: "NOTES_REQUIRED"; kind: AssetKind }
  | { code: "UNKNOWN_ASSET"; id: string };

/** Where a user Asset lives: in an open Project, or in the Library every Project shares. */
export type UserScope = { scope: "project"; projectId: string } | { scope: "library" };

export type Scope = UserScope | { scope: "bundled" };

/** What the creator writes in the import dialog. */
export type NewAsset = { path: string; name: string; kind: AssetKind; notes: string };

export type AssetChanges = { name?: string; notes?: string };

export type AssetsOptions = {
  media: Media;
  projects: Pick<Projects, "inFolder">;
  /** `<userData>/Library`. */
  libraryDir: string;
  /** The bundled set's sounds and `manifest.json`, shipped with the app. */
  bundledDir: string;
};

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

/** The bundled set's `manifest.json`: its version and each sound by slug, as `pnpm assets:bundled` wrote them. */
const BundledSetSchema = z.object({
  version: z.number().int().positive(),
  sounds: z.array(SoundAssetSchema.omit({ id: true }).extend({ slug: z.string(), role: SoundRoleSchema })),
});

/** Versions saved before Versions recorded their bundled set were made with the first one. */
const INITIAL_BUNDLED_SET = 1;

const BUNDLED_PREFIX = "bundled:";

/** An Asset reference wherever a Version holds one: a sha256 or `bundled:<slug>`, bare or as an `asset:` icon. */
const ASSET_REFERENCE = /^(?:asset:)?(bundled:[a-z0-9-]+|[0-9a-f]{64})$/;

/** FFprobe container names, as split from its comma list, and the format each is accepted as. */
const AUDIO_CONTAINERS: Record<string, AudioFormat> = { wav: "wav", mp3: "mp3", m4a: "m4a", ogg: "ogg", flac: "flac" };

/** FFprobe codec names of the raster formats images and logos accept. */
const IMAGE_CODECS: Record<string, ImageFormat> = { png: "png", mjpeg: "jpeg", webp: "webp" };

/** An SVG root element, after any XML declaration, comments and doctype. */
const SVG_ROOT = /^\uFEFF?\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg\b([^>]*)>/i;

/**
 * Assets: sound effects, music, images and logos. A user Asset's id is the sha256 of its bytes, so importing the same
 * file twice gives one Asset; a bundled one's is `bundled:<slug>`.
 *
 * User Assets live in a folder as `<sha256>.<format>` plus a `<sha256>.json` sidecar: the listed Asset (name, kind
 * and notes from the creator; format with duration and loudness for sounds, or width, height and transparency for
 * images) with a `schemaVersion` and, while a Version still uses a removed Project Asset, `removed: true`. Project
 * Assets are in `<Project>/assets/`, and their file steps run in the Project's folder queue, so they never race a
 * rename of the Project; Library Assets are in the Library folder, one change at a time. The bundled set is read-only.
 */
export function createAssets({ media, projects, libraryDir, bundledDir }: AssetsOptions) {
  let libraryQueue: Promise<unknown> = Promise.resolve();
  let bundled: Promise<z.infer<typeof BundledSetSchema>> | undefined;
  const voices = new Map<string, Promise<number>>();
  const carves = new Map<string, Promise<PlannedBed>>();

  /** The bundled set's manifest, read once; a broken install fails loudly. */
  function bundledSet() {
    bundled ??= readFile(join(bundledDir, "manifest.json"), "utf8").then((text) => BundledSetSchema.parse(JSON.parse(text)));

    return bundled;
  }

  /** Runs a step on the Library folder after its earlier changes. */
  function inLibrary<T>(step: () => Promise<T>): Promise<T> {
    const done = libraryQueue.then(step);
    libraryQueue = done.catch(() => undefined);

    return done;
  }

  /** Runs a step on the Asset folder of a scope, with the Project folder for Project Assets. */
  function inFolder<T>(where: UserScope, step: (dir: string, projectDir?: string) => Promise<Result<T, AssetsError>>): Promise<Result<T, AssetsError>> {
    if (where.scope === "library") {
      return inLibrary(() => step(libraryDir));
    }

    return projects.inFolder<T, AssetsError>(where.projectId, (projectDir) => step(join(projectDir, ASSETS_DIR), projectDir));
  }

  /** A scope's Assets that aren't removed, optionally of one kind, by name. */
  async function list(where: Scope, { kind }: { kind?: AssetKind } = {}): Promise<Result<Asset[], AssetsError>> {
    const ofKind = (assets: Asset[]) => assets.filter((asset) => kind === undefined || asset.kind === kind).sort((a, b) => a.name.localeCompare(b.name));

    if (where.scope === "bundled") {
      const { sounds } = await bundledSet();

      return { data: ofKind(sounds.map(({ slug, ...sound }) => ({ id: `${BUNDLED_PREFIX}${slug}`, ...sound }))), error: null };
    }

    return inFolder(where, async (dir) => {
      const sidecars = await sidecarsIn(dir);

      return { data: ofKind(sidecars.flatMap((sidecar) => (sidecar.removed ? [] : [sidecar.asset]))), error: null };
    });
  }

  /**
   * The Asset index a video of the Project draws on: its Project Assets, removed ones marked so they still play but
   * stay hidden from the agent, then the Library's and the bundled set's, each with its file. A Library Asset already
   * copied into the Project is listed once, from the Project.
   */
  async function index(projectId: string): Promise<Result<IndexedAsset[], AssetsError>> {
    const { data: inProject, error } = await projects.inFolder<IndexedAsset[], AssetsError>(projectId, async (projectDir) => ({
      data: indexed(join(projectDir, ASSETS_DIR), await sidecarsIn(join(projectDir, ASSETS_DIR))),
      error: null,
    }));

    if (error) {
      return { data: null, error };
    }

    const library = indexed(libraryDir, (await inLibrary(() => sidecarsIn(libraryDir))).filter(({ removed }) => !removed));
    const { sounds } = await bundledSet();
    const shipped = sounds.map(({ slug, ...sound }) => ({ id: `${BUNDLED_PREFIX}${slug}`, ...sound, file: join(bundledDir, `${slug}.${sound.format}`) }));
    const all = [...inProject, ...library, ...shipped];

    return { data: all.filter((asset, position) => all.findIndex(({ id }) => id === asset.id) === position), error: null };
  }

  /** Validates and measures the file, then copies it into the scope's folder; the original is never read again. */
  async function importAsset(where: UserScope, { path, name, kind, notes }: NewAsset): Promise<Result<Asset, AssetsError>> {
    if (needsNotes(kind) && notes.trim() === "") {
      return { data: null, error: { code: "NOTES_REQUIRED", kind } };
    }

    const { data: facts, error } = isSound(kind) ? await soundFacts(path, kind) : await imageFacts(path, kind);

    if (error) {
      return { data: null, error };
    }

    return inFolder(where, async (dir) => {
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

  /** Renames a user Asset or rewrites its notes. */
  function update(where: UserScope, id: string, { name, notes }: AssetChanges): Promise<Result<Asset, AssetsError>> {
    return inFolder(where, async (dir) => {
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

  /**
   * Hides a Project Asset from listings, and deletes its bytes unless a Version still uses them. A Library Asset is
   * deleted outright: every Project that used it has its own copy.
   */
  function remove(where: UserScope, id: string): Promise<Result<null, AssetsError>> {
    return inFolder(where, async (dir, projectDir) => {
      const sidecar = await readListed(dir, id);

      if (!sidecar) {
        return { data: null, error: { code: "UNKNOWN_ASSET", id } };
      }

      if (projectDir && (await usedByVersions(projectDir, id))) {
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

  /** Add to Library: copies a Project Asset and what the creator wrote about it into the Library. */
  function addToLibrary(projectId: string, id: string): Promise<Result<Asset, AssetsError>> {
    return projects.inFolder<Asset, AssetsError>(projectId, async (projectDir) => {
      const dir = join(projectDir, ASSETS_DIR);
      const sidecar = await readListed(dir, id);

      if (!sidecar) {
        return { data: null, error: { code: "UNKNOWN_ASSET", id } };
      }

      return inLibrary(() => copyAsset(sidecar.asset, dir, libraryDir));
    });
  }

  /** The file of a listed Asset, for the Library to audition or show. */
  async function file(where: Scope, id: string): Promise<Result<string, AssetsError>> {
    if (where.scope === "bundled") {
      const sound = (await bundledSet()).sounds.find(({ slug }) => `${BUNDLED_PREFIX}${slug}` === id);

      return sound ? { data: join(bundledDir, `${sound.slug}.${sound.format}`), error: null } : { data: null, error: { code: "UNKNOWN_ASSET", id } };
    }

    return inFolder(where, async (dir): Promise<Result<string, AssetsError>> => {
      const sidecar = await readListed(dir, id);

      return sidecar ? { data: join(dir, `${id}.${sidecar.asset.format}`), error: null } : { data: null, error: { code: "UNKNOWN_ASSET", id } };
    });
  }

  /** The Library folder, made if it doesn't exist yet, so it can be shown. */
  async function libraryFolder(): Promise<Result<string, FileError>> {
    const { error } = await fileStep(libraryDir, () => mkdir(libraryDir, { recursive: true }));

    return error ? { data: null, error } : { data: libraryDir, error: null };
  }

  /**
   * Runs in the Project folder before every Version is saved: copies the Library Assets it uses into the Project with
   * their sidecars, so the Project renders without this Library, and records the bundled set this app ships.
   */
  async function beforeVersionSave<T extends VideoContent>(projectDir: string, version: T): Promise<Result<T, FileError>> {
    const dir = join(projectDir, ASSETS_DIR);

    for (const id of assetUses(version)) {
      if (id.startsWith(BUNDLED_PREFIX) || (await readSidecar(join(dir, `${id}.json`)))) {
        continue;
      }

      // An Asset neither here nor in the Library can't be copied; the Storyboard's validation reports unknown Assets.
      const { error } = await inLibrary(async (): Promise<Result<unknown, FileError>> => {
        const sidecar = await readListed(libraryDir, id);

        return sidecar ? copyAsset(sidecar.asset, libraryDir, dir) : { data: null, error: null };
      });

      if (error) {
        return { data: null, error };
      }
    }

    return { data: { ...version, bundledSet: (await bundledSet()).version }, error: null };
  }

  /** The bundled set the Project's Versions were saved with, at its newest, and the bundled sounds they use that this app lacks. */
  async function bundledCheck(projectId: string): Promise<Result<BundledCheck, AssetsError>> {
    const { version: appSet, sounds } = await bundledSet();
    const shipped = new Set(sounds.map(({ slug }) => slug));

    return projects.inFolder<BundledCheck, AssetsError>(projectId, async (projectDir) => {
      const { data: versions, error } = await savedVersions(projectDir);

      if (error) {
        return { data: null, error: error.code === "FILE_FAILED" ? error : { code: "FILE_FAILED", path: error.path, message: error.message } };
      }

      const projectSet = Math.max(INITIAL_BUNDLED_SET, ...versions.map(({ bundledSet: set }) => set ?? INITIAL_BUNDLED_SET));
      const slugs = versions.flatMap(assetUses).flatMap((id) => (id.startsWith(BUNDLED_PREFIX) ? [id.slice(BUNDLED_PREFIX.length)] : []));
      const missing = [...new Set(slugs)].filter((slug) => !shipped.has(slug)).sort();

      return { data: { projectSet, appSet, missing }, error: null };
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

  /**
   * The sound a video plays besides its Voiceover, from its Style Preset and the agent's sounds in its Storyboard:
   * none for a Preset without a sound block.
   * Asset files are found in the bundled set, then the video's Project, then the Library.
   */
  async function soundPlan({ storyboard, transcript, preset, voiceover }: SoundSource): Promise<SoundPlan | undefined> {
    if (!preset.sound) {
      return undefined;
    }

    const placed = storyboard.scenes.flatMap(({ sounds = [] }) => sounds.map(({ asset }) => asset));
    const ids = [...Object.values(preset.sound.transitionSfx), preset.sound.music, ...placed].filter((id) => id !== NO_ASSET);
    // shortcut: the Project is the Voiceover's folder, as a source names no Project; pass the Project when sources carry one.
    const projectAssets = voiceover && join(dirname(voiceover), ASSETS_DIR);
    const found = await Promise.all([...new Set(ids)].map(async (id) => [id, await soundFile(id, projectAssets)] as const));
    const files = Object.fromEntries(found.flatMap(([id, file]) => (file ? [[id, file]] : [])));
    const plan = planSound({ storyboard, transcript, sound: preset.sound, files, voice: await voiceLoudness(voiceover) });

    return plan.bed && voiceover ? { ...plan, bed: await carved(plan.bed, voiceover) } : plan;
  }

  /** The bed carved under the Voiceover, worked out once per bed and Voiceover as planned: it decodes both whole. */
  function carved(bed: PlannedBed, voiceover: string): Promise<PlannedBed> {
    // shortcut: kept in memory for the app run, like the Voiceover's loudness; persist it in the cache if reopening shows.
    const key = JSON.stringify([voiceover, bed]);
    const done =
      carves.get(key) ??
      Promise.all([media.pcm(voiceover, CARVE_SAMPLE_RATE), media.pcm(bed.file, CARVE_SAMPLE_RATE)]).then(([voice, music]) =>
        // A file that can't be decoded plays uncarved rather than not at all.
        voice.data && music.data ? carveBed(bed, voice.data, music.data, CARVE_SAMPLE_RATE) : bed,
      );
    carves.set(key, done);

    return done;
  }

  async function soundFile(id: string, projectAssets: string | undefined): Promise<SoundFile | undefined> {
    if (id.startsWith(BUNDLED_PREFIX)) {
      const sound = (await bundledSet()).sounds.find(({ slug }) => `${BUNDLED_PREFIX}${slug}` === id);

      return sound && { file: join(bundledDir, `${sound.slug}.${sound.format}`), name: sound.name, duration: sound.duration, loudness: sound.loudness };
    }

    for (const dir of [projectAssets, libraryDir]) {
      const sidecar = dir && /^[0-9a-f]{64}$/.test(id) ? await readSidecar(join(dir, `${id}.json`)) : undefined;
      const asset = sidecar?.asset;

      if (asset && "loudness" in asset) {
        return { file: join(dir!, `${id}.${asset.format}`), name: asset.name, duration: asset.duration, loudness: asset.loudness };
      }
    }

    return undefined;
  }

  /** The Voiceover's integrated loudness, measured once per file as it is; a video without one is leveled against speech's usual loudness. */
  async function voiceLoudness(voiceover: string | undefined): Promise<number> {
    const stats = voiceover && (await stat(voiceover).catch(() => undefined));

    if (!voiceover || !stats) {
      return SPEECH_LUFS;
    }

    // shortcut: kept in memory per file version, so each app run measures a Voiceover once; cache it by sha256 if that shows.
    const key = `${voiceover} ${stats.size} ${stats.mtimeMs}`;
    const measured = voices.get(key) ?? media.loudness(voiceover).then(({ data }) => data ?? SPEECH_LUFS);
    voices.set(key, measured);

    return measured;
  }

  return { list, index, import: importAsset, update, remove, addToLibrary, file, libraryFolder, beforeVersionSave, bundledCheck, soundPlan };
}

/** What a video's sound is planned from. */
export type SoundSource = { storyboard: Storyboard; transcript: StoryboardTranscript; preset: StylePreset; voiceover?: string };

/** Speech's usual integrated loudness, for a video without a Voiceover. */
const SPEECH_LUFS = -16;

/** Enough to find the bands speech occupies, at half the memory of 48 kHz for a long Voiceover. */
const CARVE_SAMPLE_RATE = 24_000;

/**
 * The Assets a Version uses: every Asset reference in its Storyboard (sounds, media, `asset:` icons) and its Style
 * Preset (the sound block), wherever they sit, so new places that name an Asset count without changes here.
 */
export function assetUses({ storyboard, preset }: Pick<VideoContent, "storyboard" | "preset">): string[] {
  const uses = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const id = ASSET_REFERENCE.exec(value)?.[1];

      if (id) {
        uses.add(id);
      }
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit([storyboard, preset]);

  return [...uses];
}

/** Whether any saved Version uses the Asset; a Version that can't be read might, so its bytes are kept. */
async function usedByVersions(projectDir: string, id: string) {
  const { data: versions } = await savedVersions(projectDir);

  return !versions || versions.some((version) => assetUses(version).includes(id));
}

/** Copies an Asset's file and sidecar from one Asset folder to another. */
async function copyAsset(asset: Asset, from: string, to: string): Promise<Result<Asset, FileError>> {
  const { error: dirError } = await fileStep(to, () => mkdir(to, { recursive: true }));

  if (dirError) {
    return { data: null, error: dirError };
  }

  const file = `${asset.id}.${asset.format}`;
  const { error } = await copyHashed(join(from, file), join(to, file));

  return error ? { data: null, error } : saveSidecar(to, asset);
}

/** The sidecar of a listed Asset, or undefined for an id that isn't a sha256, an unknown one or a removed one. */
async function readListed(dir: string, id: string): Promise<Sidecar | undefined> {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    return undefined;
  }

  const sidecar = await readSidecar(join(dir, `${id}.json`));

  return sidecar?.removed ? undefined : sidecar;
}

/** The sidecars of an Asset folder; none when it doesn't exist yet. */
async function sidecarsIn(dir: string): Promise<Sidecar[]> {
  const { data: names } = await fileStep(dir, () => readdir(dir));
  const sidecars = await Promise.all((names ?? []).filter((name) => name.endsWith(".json")).map((name) => readSidecar(join(dir, name))));

  return sidecars.filter((sidecar) => sidecar !== undefined);
}

/** A folder's Assets as an index holds them: with their files, and marked when removed. */
function indexed(dir: string, sidecars: Sidecar[]): IndexedAsset[] {
  return sidecars.map(({ asset, removed }) => ({ ...asset, file: join(dir, `${asset.id}.${asset.format}`), ...(removed && { removed }) }));
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

async function saveSidecar(dir: string, asset: Asset, { removed = false } = {}): Promise<Result<Asset, FileError>> {
  const path = join(dir, `${asset.id}.json`);
  const { error } = await writeAtomically(path, `${JSON.stringify({ schemaVersion: 1, ...asset, ...(removed && { removed }) }, null, 2)}\n`);

  return error ? { data: null, error } : { data: asset, error: null };
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
