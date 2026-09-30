// PROTOTYPE: Voiceover -> word-timed Transcript via whisper.cpp (large-v3-turbo q5_0 + DTW).
// usage: node src/transcribe.ts <runDir>   (reads <runDir>/audio/voiceover.wav, writes <runDir>/transcript.json)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS, run } from "./lib.ts";

export type Word = { i: number; w: string; s: number; e: number; end?: "sentence" | "clause" };
export type Transcript = { duration: number; words: Word[] };

const runDir = process.argv[2];
const wav = join(runDir, "audio", "voiceover.wav");
const wav16 = join(runDir, "audio", "voiceover.16k.wav");
run("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-ar", "16000", "-ac", "1", wav16]);

const t0 = performance.now();
run(join(TOOLS, "whisper", "Release", "whisper-cli.exe"), [
  "-m", join(TOOLS, "ggml-large-v3-turbo-q5_0.bin"),
  "-f", wav16, "-l", "en", "-t", "8",
  "-dtw", "large.v3.turbo", "-ojf", "-of", join(runDir, "whisper"),
]);
const secs = (performance.now() - t0) / 1000;

type Tok = { text: string; offsets: { from: number; to: number }; t_dtw: number };
const raw = JSON.parse(readFileSync(join(runDir, "whisper.json"), "utf8")) as { transcription: { tokens: Tok[] }[] };

const words: Word[] = [];
for (const seg of raw.transcription) {
  for (const tok of seg.tokens) {
    if (tok.text.startsWith("[_")) continue;
    const t = tok.t_dtw >= 0 ? tok.t_dtw / 100 : tok.offsets.from / 1000;
    const tokEnd = tok.offsets.to / 1000;
    const startsWord = tok.text.startsWith(" ") || words.length === 0;
    if (startsWord) words.push({ i: words.length, w: tok.text.trim(), s: t, e: tokEnd });
    else {
      const last = words[words.length - 1];
      last.w += tok.text;
      last.e = tokEnd;
    }
  }
}
// DTW sometimes stacks several words on one onset (seen after pauses); spread each stacked run
// over the gap to the next distinct onset, weighted by word length.
let declustered = 0;
for (let a = 0; a < words.length; ) {
  let b = a;
  while (b + 1 < words.length && words[b + 1].s - words[a].s < 0.03) b++;
  if (b > a) {
    const S = words[a].s;
    const N = words[b + 1]?.s ?? words[b].e;
    const lens = words.slice(a, b + 1).map((w) => w.w.length + 2);
    const tot = lens.reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let k = a; k <= b; k++) {
      words[k].s = +(S + ((N - S) * acc) / tot).toFixed(3);
      acc += lens[k - a];
    }
    declustered += b - a;
  }
  a = b + 1;
}
console.log(`declustered ${declustered} stacked word onsets`);
// DTW gives onsets; a word ends where the next begins (capped by its own segment end)
for (let k = 0; k < words.length; k++) {
  const next = words[k + 1];
  if (next) words[k].e = Math.min(Math.max(words[k].e, words[k].s + 0.05), next.s);
  if (/[.?!]["')\]]?$/.test(words[k].w)) words[k].end = "sentence";
  else if (/[,;:—-]$/.test(words[k].w)) words[k].end = "clause";
}
const duration = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).trim());
const transcript: Transcript = { duration, words };
writeFileSync(join(runDir, "transcript.json"), JSON.stringify(transcript, null, 1));
console.log(`transcript: ${words.length} words, ${duration.toFixed(1)}s audio, whisper ${secs.toFixed(1)}s (${(duration / secs).toFixed(1)}x realtime)`);
