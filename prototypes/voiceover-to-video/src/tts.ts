// PROTOTYPE: synthesizes a stand-in Voiceover from a Script with Piper.
// The app never does this; the spike only needs realistic audio to derive a Transcript from.
// usage: node src/tts.ts <script.md> <outDir> [lengthScale]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOOLS, run } from "./lib.ts";

const [scriptPath, outDir, lengthScaleArg] = process.argv.slice(2);
const lengthScale = lengthScaleArg ?? "0.85";
const voice = join(TOOLS, "voices", "en_US-ryan-high.onnx");
const piper = join(TOOLS, "piper", "piper.exe");

const md = readFileSync(scriptPath, "utf8");
const sections = md
  .split(/^## .*$/m)
  .slice(1)
  .map((s) => s.trim().replace(/\n+/g, " "))
  .filter(Boolean);

mkdirSync(outDir, { recursive: true });
const parts: string[] = [];
sections.forEach((text, i) => {
  const wav = resolve(outDir, `part-${i}.wav`);
  const r = spawnSync(
    piper,
    ["--model", voice, "--output_file", wav, "--length_scale", lengthScale, "--sentence_silence", "0.2"],
    { input: text, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  parts.push(wav);
});

// section gaps: 0.6 s of silence between sections, like a speaker pausing between chapters
const silence = resolve(outDir, "gap.wav");
run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "0.6", silence]);
const list = parts.flatMap((p, i) => (i ? [silence, p] : [p])).map((p) => `file '${p.replace(/\\/g, "/")}'`);
writeFileSync(join(outDir, "concat.txt"), list.join("\n"));
run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(outDir, "concat.txt"), "-c:a", "pcm_s16le", join(outDir, "voiceover.wav")]);

const words = sections.join(" ").split(/\s+/).length;
const dur = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(outDir, "voiceover.wav")]).trim());
console.log(`voiceover: ${dur.toFixed(1)}s, ${words} words, ${((words / dur) * 60).toFixed(0)} wpm (length_scale ${lengthScale})`);
