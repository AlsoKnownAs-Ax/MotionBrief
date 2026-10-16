// `pnpm assets:bundled`: builds the bundled sound set in resources/assets/ (spec #76): picks sounds from Kenney's CC0
// packs, makes whooshes, clicks and risers with the bundled FFmpeg, transcodes everything to Opus and writes the
// manifest the core lists them from and the provenance file. The set only ever grows: never change or drop a shipped
// slug; add new ones and bump SET_VERSION, so Projects made with an older set keep rendering.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runnerImport } from "vite";
import { download, extract } from "../deps/files.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "resources", "assets");

const SET_VERSION = 1;

/** The Kenney packs sounds are taken from, pinned by the hash of their download. */
const PACKS = {
  interface: {
    title: "Interface Sounds",
    page: "https://kenney.nl/assets/interface-sounds",
    zip: "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
    sha256: "f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232",
  },
  impact: {
    title: "Impact Sounds",
    page: "https://kenney.nl/assets/impact-sounds",
    zip: "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
    sha256: "029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8",
  },
  scifi: {
    title: "Sci-fi Sounds",
    page: "https://kenney.nl/assets/sci-fi-sounds",
    zip: "https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip",
    sha256: "119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04",
  },
  digital: {
    title: "Digital Audio",
    page: "https://kenney.nl/assets/digital-audio",
    zip: "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip",
    sha256: "24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06",
  },
};

type Pack = keyof typeof PACKS;

type Source = { pack: Pack; file: string } | { graph: string; recipe: string };

type Sound = { slug: string; role: "transition" | "impact"; name: string; notes: string; source: Source };

const RATE = 48_000;

/** Ogg picks a random stream serial number otherwise, so a rebuild would change every shipped file. */
const BIT_EXACT = ["-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1"];

/**
 * Noise in two bands, each swelling to its own peak (a fraction of the length) and falling away, so the sound sweeps
 * up when the high band peaks later; `pan` moves it across the stereo field.
 */
function whoosh({ seconds, color = "pink", peak = 0.55, sweep = 0.1, low = 700, high = 3500, pan = "center", seed = 1 }: {
  seconds: number;
  color?: "pink" | "white" | "brown";
  peak?: number;
  sweep?: number;
  low?: number;
  high?: number;
  pan?: "center" | "left" | "right";
  seed?: number;
}): Source {
  const envelope = (p: number) => `pow(sin(PI/2*min(t/(${p * seconds}),1)),2)*pow(cos(PI/2*max(t-${p * seconds},0)/(${(1 - p) * seconds})),2)`;
  const highPeak = Math.min(Math.max(peak + sweep, 0.05), 0.95);
  const panning = { center: "val(0)|val(0)", left: `val(0)*(0.2+0.8*t/${seconds})|val(0)*(1-0.8*t/${seconds})`, right: `val(0)*(1-0.8*t/${seconds})|val(0)*(0.2+0.8*t/${seconds})` }[pan];
  const graph = [
    `anoisesrc=d=${seconds}:c=${color}:r=${RATE}:a=0.5:seed=${seed},asplit[a][b]`,
    `[a]lowpass=f=${low},aeval=exprs='val(0)*${envelope(peak)}':c=same[lo]`,
    `[b]bandpass=f=${high}:w=${high * 0.7},aeval=exprs='val(0)*${envelope(highPeak)}':c=same[hi]`,
    `[lo][hi]amix=inputs=2:normalize=0,aeval=exprs='${panning}':c=stereo,alimiter=limit=0.9`,
  ].join(";");

  return { graph, recipe: `${color} noise in two bands (${low} Hz low-pass, ${high} Hz band-pass) swelling over ${seconds} s, panned ${pan}` };
}

/** A sine blip with an exponential decay: a soft click when short, a ding when long. */
function blip({ seconds, hz, decay, overtone = 2 }: { seconds: number; hz: number; decay: number; overtone?: number }): Source {
  const graph = `aevalsrc=exprs='0.6*sin(2*PI*${hz}*t)*exp(-t*${decay})+0.25*sin(2*PI*${hz * overtone}*t)*exp(-t*${decay * 1.5})':d=${seconds}:s=${RATE},alimiter=limit=0.9`;

  return { graph, recipe: `a ${hz} Hz sine with a ×${overtone} overtone, decaying over ${seconds} s` };
}

/** Noise and a rising tone that grow until the very end: a riser lands on its last sample. */
function riser({ seconds, from, to, seed = 1 }: { seconds: number; from: number; to: number; seed?: number }): Source {
  const graph = [
    `anoisesrc=d=${seconds}:c=pink:r=${RATE}:a=0.4:seed=${seed},highpass=f=400,aeval=exprs='val(0)*pow(t/${seconds},3)':c=same[n]`,
    `aevalsrc=exprs='0.3*sin(2*PI*(${from}*t+${(to - from) / (2 * seconds)}*t*t))*pow(t/${seconds},2)':d=${seconds}:s=${RATE}[s]`,
    `[n][s]amix=inputs=2:normalize=0,afade=t=out:st=${seconds - 0.03}:d=0.03,alimiter=limit=0.9`,
  ].join(";");

  return { graph, recipe: `pink noise and a ${from}→${to} Hz sine growing over ${seconds} s` };
}

/** A sine falling in pitch as it decays: a sub drop. */
function drop({ seconds, from, to }: { seconds: number; from: number; to: number }): Source {
  const graph = `aevalsrc=exprs='0.9*sin(2*PI*(${from}*t-${(from - to) / (2 * seconds)}*t*t))*exp(-t*${4 / seconds})*min(t/0.005,1)':d=${seconds}:s=${RATE},alimiter=limit=0.9`;

  return { graph, recipe: `a ${from}→${to} Hz sine falling and decaying over ${seconds} s` };
}

const kenney = (pack: Pack, file: string): Source => ({ pack, file });

const SOUNDS: Sound[] = [
  // Transitions: whooshes for push and zoom-through, soft clicks for crossfade.
  { slug: "whoosh-left", role: "transition", name: "Whoosh left", notes: "Air moving right to left. For a push to the left.", source: whoosh({ seconds: 0.6, pan: "left", seed: 11 }) },
  { slug: "whoosh-right", role: "transition", name: "Whoosh right", notes: "Air moving left to right. For a push to the right.", source: whoosh({ seconds: 0.6, pan: "right", seed: 12 }) },
  { slug: "whoosh-up", role: "transition", name: "Whoosh up", notes: "A bright, rising whoosh. For a push up.", source: whoosh({ seconds: 0.6, sweep: 0.2, high: 4500, seed: 13 }) },
  { slug: "whoosh-down", role: "transition", name: "Whoosh down", notes: "A darker, falling whoosh. For a push down.", source: whoosh({ seconds: 0.6, sweep: -0.2, low: 500, high: 2500, seed: 14 }) },
  { slug: "whoosh-soft", role: "transition", name: "Soft whoosh", notes: "A gentle, low whoosh that stays under the voice. A safe default for any push.", source: whoosh({ seconds: 0.55, low: 500, high: 1800, seed: 15 }) },
  { slug: "whoosh-fast", role: "transition", name: "Fast whoosh", notes: "A quick swipe for short, snappy pushes.", source: whoosh({ seconds: 0.35, peak: 0.5, seed: 16 }) },
  { slug: "whoosh-long", role: "transition", name: "Long whoosh", notes: "A slow pass of air for long or calm Transitions.", source: whoosh({ seconds: 1, peak: 0.6, seed: 17 }) },
  { slug: "whoosh-airy", role: "transition", name: "Airy whoosh", notes: "Thin, bright air with little body. For light, minimal styles.", source: whoosh({ seconds: 0.6, color: "white", low: 1200, high: 6000, seed: 18 }) },
  { slug: "whoosh-deep", role: "transition", name: "Deep whoosh", notes: "A heavy, low rush. For dramatic Scene changes.", source: whoosh({ seconds: 0.75, color: "brown", low: 400, high: 1500, seed: 19 }) },
  { slug: "swish", role: "transition", name: "Swish", notes: "A very short swish for quick cuts between related Scenes.", source: whoosh({ seconds: 0.25, peak: 0.45, high: 4000, seed: 20 }) },
  { slug: "zoom-in", role: "transition", name: "Zoom in", notes: "A whoosh that builds to the end, as if flying into the next Scene. For a zoom-through.", source: whoosh({ seconds: 0.7, peak: 0.85, sweep: 0.08, seed: 21 }) },
  { slug: "zoom-out", role: "transition", name: "Zoom out", notes: "A whoosh that starts strong and trails off, as if pulling back. For a zoom-through out of detail.", source: whoosh({ seconds: 0.7, peak: 0.2, sweep: -0.1, seed: 22 }) },
  { slug: "zoom-through", role: "transition", name: "Zoom through", notes: "A full rise and fall that peaks in the middle. The default for a zoom-through.", source: whoosh({ seconds: 0.8, peak: 0.5, sweep: 0.15, low: 600, high: 3000, seed: 23 }) },
  { slug: "click-soft", role: "transition", name: "Soft click", notes: "A rounded, quiet click. The default for a crossfade.", source: blip({ seconds: 0.12, hz: 1800, decay: 90, overtone: 0.5 }) },
  { slug: "click-low", role: "transition", name: "Low click", notes: "A muted, woody click for crossfades in calm videos.", source: blip({ seconds: 0.15, hz: 900, decay: 70, overtone: 1.5 }) },
  { slug: "tick-soft", role: "transition", name: "Soft tick", notes: "A tiny, high tick for crossfades that should barely be heard.", source: blip({ seconds: 0.06, hz: 3200, decay: 160 }) },
  { slug: "click-crisp", role: "transition", name: "Crisp click", notes: "A sharp interface click for crossfades in techy styles.", source: kenney("interface", "click_001.ogg") },
  { slug: "click-plastic", role: "transition", name: "Plastic click", notes: "A light plastic click, like a button press.", source: kenney("interface", "click_003.ogg") },
  { slug: "tick", role: "transition", name: "Tick", notes: "A small mechanical tick for crossfades.", source: kenney("interface", "tick_001.ogg") },
  { slug: "select", role: "transition", name: "Select", notes: "A short interface blip, like selecting an item.", source: kenney("interface", "select_001.ogg") },
  { slug: "switch", role: "transition", name: "Switch", notes: "A switch flipping. For a crossfade between two views of the same thing.", source: kenney("interface", "switch_002.ogg") },
  { slug: "toggle", role: "transition", name: "Toggle", notes: "A toggle click with a little body.", source: kenney("interface", "toggle_001.ogg") },
  { slug: "pop-open", role: "transition", name: "Pop open", notes: "A quick upward pop, like a window opening. For a Scene that springs in.", source: kenney("interface", "maximize_001.ogg") },
  { slug: "pop-close", role: "transition", name: "Pop close", notes: "A quick downward pop, like a window closing.", source: kenney("interface", "minimize_001.ogg") },
  { slug: "slide-open", role: "transition", name: "Slide open", notes: "A mechanical sci-fi door sliding open. For a push in technical videos.", source: kenney("scifi", "doorOpen_000.ogg") },
  { slug: "slide-close", role: "transition", name: "Slide close", notes: "A mechanical sci-fi door sliding shut.", source: kenney("scifi", "doorClose_000.ogg") },

  // Impacts and stings the agent may place on a meaningful word.
  { slug: "punch-heavy", role: "impact", name: "Heavy punch", notes: "A big, solid hit. For the single most important number or claim.", source: kenney("impact", "impactPunch_heavy_000.ogg") },
  { slug: "punch", role: "impact", name: "Punch", notes: "A medium hit. For a number landing or a strong word.", source: kenney("impact", "impactPunch_medium_000.ogg") },
  { slug: "thud-soft", role: "impact", name: "Soft thud", notes: "A padded, heavy thud. For a reveal that should feel weighty but not loud.", source: kenney("impact", "impactSoft_heavy_000.ogg") },
  { slug: "thud-light", role: "impact", name: "Light thud", notes: "A small soft thud. For list items or minor emphasis.", source: kenney("impact", "impactSoft_medium_000.ogg") },
  { slug: "metal-hit", role: "impact", name: "Metal hit", notes: "A hard metallic clank. For something breaking, failing or locking.", source: kenney("impact", "impactMetal_heavy_000.ogg") },
  { slug: "plate-hit", role: "impact", name: "Plate hit", notes: "A ringing metal plate. For a warning or a hard limit.", source: kenney("impact", "impactPlate_heavy_000.ogg") },
  { slug: "knock", role: "impact", name: "Knock", notes: "A dry wooden knock. For a plain, physical emphasis.", source: kenney("impact", "impactWood_heavy_000.ogg") },
  { slug: "bell-strike", role: "impact", name: "Bell strike", notes: "A struck bell with a ring. A sting for a conclusion or the key takeaway.", source: kenney("impact", "impactBell_heavy_000.ogg") },
  { slug: "bell-strike-long", role: "impact", name: "Long bell strike", notes: "A bell with a longer ring. A sting for the closing line.", source: kenney("impact", "impactBell_heavy_001.ogg") },
  { slug: "glass-tap", role: "impact", name: "Glass tap", notes: "A light tap on glass. For something delicate or fragile.", source: kenney("impact", "impactGlass_light_000.ogg") },
  { slug: "stone-hit", role: "impact", name: "Stone hit", notes: "A pick striking rock. For digging into a detail.", source: kenney("impact", "impactMining_000.ogg") },
  { slug: "boom-low", role: "impact", name: "Low boom", notes: "A deep, distant boom. For a dramatic reveal or a big number.", source: kenney("scifi", "lowFrequency_explosion_000.ogg") },
  { slug: "boom-short", role: "impact", name: "Short boom", notes: "A short low thump. For a stat landing.", source: kenney("scifi", "lowFrequency_explosion_001.ogg") },
  { slug: "tech-hit", role: "impact", name: "Tech hit", notes: "A sci-fi metallic impact. For systems, servers and hardware.", source: kenney("scifi", "impactMetal_000.ogg") },
  { slug: "force-field", role: "impact", name: "Force field", notes: "A humming energy shimmer. For something switching on or a shield.", source: kenney("scifi", "forceField_000.ogg") },
  { slug: "crunch", role: "impact", name: "Crunch", notes: "A crunchy explosion. For something crashing or being destroyed.", source: kenney("scifi", "explosionCrunch_000.ogg") },
  { slug: "confirm", role: "impact", name: "Confirm", notes: "A positive interface chime. For a success, a fix or a yes.", source: kenney("interface", "confirmation_001.ogg") },
  { slug: "confirm-bright", role: "impact", name: "Bright confirm", notes: "A brighter success chime. For a win or a result that works.", source: kenney("interface", "confirmation_002.ogg") },
  { slug: "confirm-short", role: "impact", name: "Short confirm", notes: "A short positive blip. For ticking off a step.", source: kenney("interface", "confirmation_004.ogg") },
  { slug: "ding", role: "impact", name: "Ding", notes: "A glassy ding. For an idea, a notification or a highlighted term.", source: kenney("interface", "glass_001.ogg") },
  { slug: "bong", role: "impact", name: "Bong", notes: "A low, round bong. For a key term appearing.", source: kenney("interface", "bong_001.ogg") },
  { slug: "pluck", role: "impact", name: "Pluck", notes: "A short plucked note. For a light, friendly emphasis.", source: kenney("interface", "pluck_001.ogg") },
  { slug: "drop", role: "impact", name: "Drop", notes: "A small drop sound. For an item falling into place.", source: kenney("interface", "drop_001.ogg") },
  { slug: "question", role: "impact", name: "Question", notes: "A rising, questioning blip. For a question the video asks.", source: kenney("interface", "question_001.ogg") },
  { slug: "error", role: "impact", name: "Error", notes: "A short error buzz. For a mistake, a bug or a wrong answer.", source: kenney("interface", "error_004.ogg") },
  { slug: "glitch", role: "impact", name: "Glitch", notes: "A 20 ms digital glitch. For corruption, bugs or something going wrong.", source: kenney("interface", "glitch_001.ogg") },
  { slug: "power-up", role: "impact", name: "Power up", notes: "A rising retro power-up. For an upgrade or something getting faster.", source: kenney("digital", "powerUp1.ogg") },
  { slug: "phaser-up", role: "impact", name: "Phaser up", notes: "A rising retro phaser sweep. Game-like: use sparingly.", source: kenney("digital", "phaserUp1.ogg") },
  { slug: "three-tone", role: "impact", name: "Three tones", notes: "Three rising tones. For a three-part list landing or a sequence completing.", source: kenney("digital", "threeTone1.ogg") },
  { slug: "two-tone", role: "impact", name: "Two tones", notes: "Two tones, like a notification. For a message or an alert.", source: kenney("digital", "twoTone1.ogg") },
  { slug: "zap-up", role: "impact", name: "Zap up", notes: "An electric zap rising in three steps. For energy or a sudden change.", source: kenney("digital", "zapThreeToneUp.ogg") },
  { slug: "blip-up", role: "impact", name: "Blip up", notes: "A small rising blip. For something increasing.", source: kenney("digital", "highUp.ogg") },
  { slug: "blip-down", role: "impact", name: "Blip down", notes: "A small falling blip. For something decreasing.", source: kenney("digital", "lowDown.ogg") },
  { slug: "sub-drop", role: "impact", name: "Sub drop", notes: "A deep falling tone. Felt more than heard, for a big reveal.", source: drop({ seconds: 0.9, from: 120, to: 40 }) },
  { slug: "riser", role: "impact", name: "Riser", notes: "Noise and a tone building for 1.5 s and stopping dead. Place it to end on the word it leads into.", source: riser({ seconds: 1.5, from: 200, to: 900, seed: 31 }) },
  { slug: "riser-short", role: "impact", name: "Short riser", notes: "A 0.8 s build that stops dead, to lead into a word.", source: riser({ seconds: 0.8, from: 300, to: 1200, seed: 32 }) },
  { slug: "ding-soft", role: "impact", name: "Soft ding", notes: "A pure, soft bell tone. A calm sting for a takeaway.", source: blip({ seconds: 1.2, hz: 1320, decay: 4, overtone: 2.76 }) },
];

// The core's own FFmpeg and measurements, so the manifest's facts match what an import would measure. Loaded through
// Vite's module runner, since the core's imports carry no file extensions.
type Measured<T> = Promise<{ data: T; error: null } | { data: null; error: { code: string } }>;
type MediaModule = {
  createMedia: (paths: { ffmpegPath: string; ffprobePath: string }) => { probe: (path: string) => Measured<{ duration: number }>; momentaryMax: (path: string) => Measured<number> };
};
type NativeModule = { ffmpegPath: () => string; ffprobePath: () => string };

const { module: mediaModule } = await runnerImport<MediaModule>(join(ROOT, "src", "modules", "media", "index.ts"), { root: ROOT, configFile: false, logLevel: "error" });
const { module: native } = await runnerImport<NativeModule>(join(ROOT, "src", "core", "native.ts"), { root: ROOT, configFile: false, logLevel: "error" });
const media = mediaModule.createMedia({ ffmpegPath: native.ffmpegPath(), ffprobePath: native.ffprobePath() });
const work = await mkdtemp(join(tmpdir(), "motionbrief-bundled-"));
const usedPacks = new Set(
  SOUNDS.map(({ source }) => source)
    .filter((source) => "pack" in source)
    .map(({ pack }) => pack),
);

for (const pack of usedPacks) {
  const { zip, sha256 } = PACKS[pack];
  const archive = join(work, `${pack}.zip`);
  const { data: hash, error } = await download(zip, archive);

  if (error || hash !== sha256) {
    throw new Error(`${zip}: ${error?.message ?? `sha256 ${hash}, expected ${sha256}`}`);
  }

  await mkdir(join(work, pack));
  const { error: extractError } = await extract(archive, join(work, pack));

  if (extractError) {
    throw new Error(extractError.message);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const manifest = [];

for (const { slug, role, name, notes, source } of SOUNDS) {
  const file = join(OUT, `${slug}.opus`);
  const run = spawnSync(native.ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...inputOf(source), "-ar", String(RATE), "-c:a", "opus", "-strict", "-2", "-b:a", "96k", ...BIT_EXACT, file]);

  if (run.status !== 0) {
    throw new Error(`${slug}: ${String(run.stderr)}`);
  }

  const { data: info, error } = await media.probe(file);
  const { data: loudness, error: loudnessError } = await media.momentaryMax(file);

  if (error || loudnessError) {
    throw new Error(`${slug}: ${(error ?? loudnessError)?.code}`);
  }

  manifest.push({ slug, kind: "sfx", role, name, notes, format: "opus", duration: round(info.duration, 3), loudness: round(loudness, 1) });
}

await writeFile(join(OUT, "manifest.json"), `${JSON.stringify({ version: SET_VERSION, sounds: manifest }, null, 2)}\n`);
await writeFile(join(OUT, "PROVENANCE.md"), provenance());
await rm(work, { recursive: true, force: true });

const bytes = (await Promise.all((await readdir(OUT)).map(async (name) => (await stat(join(OUT, name))).size))).reduce((sum, size) => sum + size, 0);
console.log(`${SOUNDS.length} sounds, ${(bytes / 1024 / 1024).toFixed(2)} MB in ${OUT}`);

/** FFmpeg's input for a sound: the pack's file, or the graph that makes it. */
function inputOf(source: Source): string[] {
  if ("pack" in source) {
    return ["-i", join(work, source.pack, "Audio", source.file)];
  }

  return ["-filter_complex", source.graph];
}

function provenanceRow({ slug, source }: Sound): string {
  if ("pack" in source) {
    return `| \`${slug}\` | Kenney, ${PACKS[source.pack].title}: \`Audio/${source.file}\` | ${PACKS[source.pack].page} |`;
  }

  return `| \`${slug}\` | Made with the bundled FFmpeg: ${source.recipe} | scripts/assets/bundled-set.ts |`;
}

function provenance() {
  const rows = SOUNDS.map(provenanceRow);
  const packs = [...usedPacks].map((pack) => `- ${PACKS[pack].title}: ${PACKS[pack].page} (download ${PACKS[pack].zip}, sha256 \`${PACKS[pack].sha256}\`)`);

  return [
    "# Bundled sounds: provenance",
    "",
    `Set version ${SET_VERSION}. Built by \`pnpm assets:bundled\` (scripts/assets/bundled-set.ts), transcoded to Opus at 48 kHz.`,
    "",
    "Every sound is CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required; it is listed",
    "here so the source of every file is clear.",
    "",
    "- Kenney (www.kenney.nl) packs, CC0 per each pack's License.txt and https://kenney.nl/support:",
    ...packs.map((line) => `  ${line}`),
    "- Sounds made in-house with the bundled FFmpeg from noise and sine generators, dedicated to the public domain under CC0.",
    "",
    "| Slug | Source | URL |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}
