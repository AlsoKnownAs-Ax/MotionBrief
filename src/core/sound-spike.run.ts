// PROTOTYPE (Prototype: Sound spike, #70): throwaway, lives only on the prototype/sound-spike branch.
// Hand-placed "agent" sounds + Preset-rule sounds + a fitted, carved bed, assembled and rendered per variant.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { analyseCarveBands, analyseCarveDuck, carveBandsToChain, carveProfile } from "../../node_modules/.pnpm/@hyperframes+core@0.8.113_@types+node@24.19.0/node_modules/@hyperframes/core/dist/audioCarve.js";
import { serializeAutomation } from "../../node_modules/.pnpm/@hyperframes+core@0.8.113_@types+node@24.19.0/node_modules/@hyperframes/core/dist/audioAutomation.js";
import { it } from "vitest";
import type { StoryboardTranscript } from "../contract";
import { assemble } from "../modules/assembler";
import { renderMp4 } from "../modules/exporter/render";
import { elementsOf, sceneTimings, validateStoryboard, type Storyboard } from "../modules/storyboard";
import { bundledPreset } from "../modules/style";
import { chromeHeadlessShellPath, ffmpegPath, ffprobePath } from "./native";

const OUT = join(import.meta.dirname, "..", "..", "out", "sound-spike");
const SOUNDS = join(OUT, "sounds");
const FF = ffmpegPath();

const SFX: Record<string, { file: string; align?: "end" }> = {
  whoosh: { file: "whoosh.wav" },
  riser: { file: "riser.wav", align: "end" },
  tick: { file: "interface/Audio/tick_002.ogg" },
  soft: { file: "interface/Audio/select_002.ogg" },
  pop: { file: "interface/Audio/pluck_001.ogg" },
  impact: { file: "impact/Audio/impactPunch_medium_000.ogg" },
  bong: { file: "interface/Audio/bong_001.ogg" },
};

type AgentSound = { asset: keyof typeof SFX; at: number };

/** Storyboard by hand, with the `sounds` field the Storyboard agent would write. */
const SCENES = [
  { id: "s01", type: "hook", from: 0, to: 16, transition: { type: "push-left" }, content: { headline: { id: "headline", text: "Small functions are making your code worse", at: 0 }, kicker: { id: "kicker", text: "Keep every function tiny?", at: 10 } }, sounds: [{ asset: "pop", at: 6 }] },
  { id: "s02", type: "list", from: 17, to: 35, transition: { type: "cut" }, content: { title: { id: "title", text: "PaymentService: 15 methods", at: 19 }, items: [{ id: "validate", text: "validateCard()", at: 27 }, { id: "format", text: "formatAmount()", at: 29 }, { id: "build", text: "buildRequest()", at: 31 }, { id: "retry", text: "retryOnTimeout()", at: 33 }] }, sounds: [{ asset: "impact", at: 24 }] },
  { id: "s02b", type: "hook", from: 36, to: 50, transition: { type: "crossfade" }, content: { headline: { id: "headline", text: "Every caller knows all 15, in order", at: 37 } }, sounds: [] },
  { id: "s03", type: "key-term", from: 51, to: 60, transition: { type: "zoom-through" }, content: { term: { id: "term", text: "Shallow module", at: 53 }, definition: { id: "definition", text: "A huge interface hiding almost nothing", at: 55 } }, sounds: [{ asset: "riser", at: 53 }] },
  { id: "s04", type: "code", from: 61, to: 73, transition: { type: "cut" }, content: { language: "ts", mode: "editor", blocks: [{ id: "charge", lines: ["payments.charge(card, amount);"], at: 64 }], highlights: [] }, sounds: [{ asset: "impact", at: 73 }] },
  { id: "s05", type: "list", from: 74, to: 81, transition: { type: "crossfade" }, content: { title: { id: "title", text: "Hidden inside", at: 74 }, items: [{ id: "validation", text: "Validation", at: 74 }, { id: "retries", text: "Retries", at: 75 }, { id: "currency", text: "Currency", at: 76 }, { id: "fraud", text: "Fraud checks", at: 77 }] }, sounds: [] },
  { id: "s06", type: "key-term", from: 82, to: 95, transition: { type: "push-left" }, content: { term: { id: "term", text: "Deep module", at: 84 }, definition: { id: "definition", text: "A tiny interface with a lot of power behind it", at: 86 } }, sounds: [{ asset: "riser", at: 84 }, { asset: "bong", at: 93 }] },
  { id: "s07", type: "outro", from: 96, to: 110, content: { headline: { id: "headline", text: "Judge code by what it hides", at: 97 }, cta: { id: "cta", text: "not by how small it is", at: 103 } }, sounds: [] },
] as const;

type Variant = {
  name: string;
  /** What an agent sound does to a rule sound within COLLIDE seconds of it. */
  collision: "agent-replaces" | "both";
  musicDb: number; // bed loudness relative to the Voiceover, before ducking
  agentSfxDb: number;
  ruleSfxDb: number; // transitions; entrances sit 6 dB under
  carve: number; // carve strength 0..1
  fadeIn: number;
  parts?: "vo" | "vo+sfx" | "vo+bed";
};

const VARIANTS: Variant[] = [
  { name: "A-replace", collision: "agent-replaces", musicDb: -18, agentSfxDb: -6, ruleSfxDb: -10, carve: 0.25, fadeIn: 1 },
  { name: "B-both", collision: "both", musicDb: -18, agentSfxDb: -6, ruleSfxDb: -10, carve: 0.25, fadeIn: 1 },
  { name: "C-hot", collision: "agent-replaces", musicDb: -12, agentSfxDb: -3, ruleSfxDb: -6, carve: 0.5, fadeIn: 1 },
];
const COLLIDE = 0.15;
if (process.env.SPIKE_DIAG) VARIANTS.splice(0, 3, ...(((process.env.SPIKE_DIAG === "sfx" ? ["vo+sfx"] : ["vo", "vo+sfx", "vo+bed"]) as ("vo" | "vo+sfx" | "vo+bed")[])).map((parts) => ({ ...VARIANTS[0]!, name: `diag-${parts}`, parts })));

it("renders the sound spike variants", async () => {
  const voiceover = process.env.SPIKE_VOICEOVER!;
  const bed = join(SOUNDS, process.env.SPIKE_BED ?? "bed-washed-up.mp3");
  const transcript = JSON.parse(await readFile(join(OUT, "transcript.json"), "utf8")) as StoryboardTranscript;
  const storyboard = { format: "horizontal", scenes: SCENES.map(({ sounds: _, ...scene }) => scene) } as unknown as Storyboard;
  const rules = { format: "horizontal", captions: false, transitions: ["cut", "crossfade", "push", "zoom-through"], canvas: "never" } as never;
  const { error } = validateStoryboard(storyboard, transcript, rules);
  if (error) throw new Error(JSON.stringify(error.issues, null, 2));

  const voLufs = loudness(voiceover);
  const bedLufs = loudness(bed);
  const sfxLufs = Object.fromEntries(Object.entries(SFX).map(([id, { file }]) => [id, momentaryMax(join(SOUNDS, file))]));
  const wordAt = (index: number) => transcript.words[index]!.start;
  const timings = sceneTimings(storyboard, transcript);

  // Preset rules: a sound on every Transition (cut is silent) and every element entrance.
  const ruleSounds = timings.flatMap(({ scene, start }, index) => [
    ...(process.env.SPIKE_ENTRANCES ? elementsOf(scene).map((element) => ({ asset: "tick", t: wordAt(element.at), kind: "entrance" as const })) : []),
    ...(index > 0 && storyboard.scenes[index - 1]!.transition?.type !== "cut" ? [{ asset: storyboard.scenes[index - 1]!.transition?.type === "crossfade" ? "soft" : "whoosh", t: start, kind: "transition" as const }] : []),
  ]);
  const agentSounds = SCENES.flatMap(({ sounds }) => (sounds as readonly AgentSound[]).map(({ asset, at }) => ({ asset, t: wordAt(at), kind: "agent" as const })));

  const voice = pcm(voiceover);
  const bedPcm = pcm(bed);
  const report: string[] = [`VO ${voLufs.toFixed(1)} LUFS, bed ${bedLufs.toFixed(1)} LUFS`];

  for (const variant of VARIANTS) {
    const dir = join(OUT, variant.name);
    await rm(dir, { recursive: true, force: true });
    await assemble({ dir, storyboard, transcript, preset: bundledPreset("blueprint"), code: {}, voiceover });

    const rules = variant.collision === "both" ? ruleSounds : ruleSounds.filter((rule) => !agentSounds.some((agent) => Math.abs(agent.t - rule.t) < COLLIDE));
    const sounds = [...rules, ...agentSounds].toSorted((a, b) => a.t - b.t);
    await mkdir(join(dir, "assets", "sfx"), { recursive: true });
    await Promise.all(Object.values(SFX).map(({ file }) => copyFile(join(SOUNDS, file), join(dir, "assets", "sfx", basename(file)))));
    await copyFile(bed, join(dir, "assets", "bed.mp3"));

    const tags = (variant.parts === "vo" || variant.parts === "vo+bed" ? [] : sounds).map((sound, index) => {
      const { file, align } = SFX[sound.asset]!;
      const length = duration(join(SOUNDS, file));
      const start = Math.max(0, align === "end" ? sound.t - length : sound.t);
      const levelDb = sound.kind === "agent" ? variant.agentSfxDb : sound.kind === "transition" ? variant.ruleSfxDb : variant.ruleSfxDb - 6;
      return `<audio id="sfx-${index}" data-audio-group="sfx" src="assets/sfx/${basename(file)}" data-start="${start.toFixed(3)}" data-duration="${length.toFixed(3)}" data-track-index="${20 + (index % 4)}" data-volume="${gain(voLufs + levelDb - sfxLufs[sound.asset]!)}"></audio>`;
    });

    // The bed: static gain from measured loudness, carve chain + duck lane from the Voiceover, fades.
    const base = gain(voLufs + variant.musicDb - bedLufs);
    const profile = carveProfile(variant.carve);
    const chain = carveBandsToChain(analyseCarveBands(voice, 48000, profile));
    const duck = analyseCarveDuck(voice, scaled(bedPcm, base), 48000, profile, 0);
    const lane = { version: 1, lanes: [{ target: "volume", points: duck.map(({ t, v }) => ({ t, v: Number((base * 10 ** (v / 20)).toFixed(4)) })) }] };
    const lastScene = timings.at(-1)!;
    if (variant.parts === undefined || variant.parts === "vo+bed") tags.push(
      `<audio id="music-bed" src="assets/bed.mp3" data-start="0" data-duration="${transcript.duration}" data-track-index="11" data-volume="${base}" data-fade-in="${variant.fadeIn}" data-fade-out="${(transcript.duration - lastScene.start).toFixed(2)}" data-fx-chain='${JSON.stringify(chain)}' data-automation='${serializeAutomation(lane)}'></audio>`,
    );

    const index = join(dir, "index.html");
    const html = await readFile(index, "utf8");
    await writeFile(index, html.replace(/(<audio id="el-voiceover"[^>]*><\/audio>)/, `$1\n<hf-audio-group id="sfx" data-volume="1"></hf-audio-group>\n${tags.join("\n")}`));

    const output = join(OUT, `${variant.name}.mp4`);
    const render = renderMp4({ pageDir: dir, output, chromePath: chromeHeadlessShellPath(), ffmpegPath: FF, ffprobePath: ffprobePath(), signal: new AbortController().signal });
    let step = await render.next();
    while (!step.done) step = await render.next();
    if (step.value.code !== "DONE") throw new Error(JSON.stringify(step.value));

    report.push(`${variant.name}: ${sounds.length} sounds (${agentSounds.length} agent, ${rules.length} rule), bed gain ${base}, mix ${loudness(output).toFixed(1)} LUFS, true peak ${truePeak(output).toFixed(1)} dBTP`);
  }
  await writeFile(join(OUT, "report.txt"), report.join("\n"));
  console.log(report.join("\n"));
});

const gain = (db: number) => Number(Math.min(3.98, 10 ** (db / 20)).toFixed(4)); // +12 dB cap

function stderrOf(file: string, filter: string) {
  return spawnSync(FF, ["-hide_banner", "-nostats", "-v", "verbose", "-i", file, "-af", filter, "-f", "null", "-"], { encoding: "utf8" }).stderr;
}

function loudness(file: string) {
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderrOf(file, "ebur128").split("Summary:")[1] ?? "")![1]);
}

/** Short SFX have no meaningful integrated loudness: use their loudest 400 ms. */
function momentaryMax(file: string) {
  const values = [...stderrOf(file, "apad=pad_dur=1,ebur128=framelog=verbose").matchAll(/M:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  return Math.max(...values.filter(Number.isFinite));
}

function truePeak(file: string) {
  return Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(stderrOf(file, "ebur128=peak=true").split("Summary:")[1] ?? "")![1]);
}

function duration(file: string) {
  return Number(execFileSync(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
}

function pcm(file: string) {
  const buffer = execFileSync(FF, ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1e9 });
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

function scaled(samples: Float32Array, by: number) {
  return samples.map((sample) => sample * by);
}
