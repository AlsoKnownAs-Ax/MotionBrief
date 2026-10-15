// PROTOTYPE (Prototype: Sound spike, #70): throwaway, lives only on the prototype/sound-spike branch.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "vitest";
import { createCache } from "../modules/cache";
import { createMedia } from "../modules/media";
import { createWhisperCli, createWhisperTranscriber } from "../modules/transcriber";
import { ffmpegPath, ffprobePath, whisperCliPath, whisperVadModelPath } from "./native";

const OUT = join(import.meta.dirname, "..", "..", "out", "sound-spike");
const SHA = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";

it("transcribes the spike Voiceover", async () => {
  const voiceover = process.env.SPIKE_VOICEOVER!;
  await mkdir(OUT, { recursive: true });
  const media = createMedia({ ffmpegPath: ffmpegPath(), ffprobePath: ffprobePath() });
  const transcriber = createWhisperTranscriber({
    engine: createWhisperCli({ cliPath: whisperCliPath(), vadModelPath: whisperVadModelPath(), version: "spike" }),
    media,
    cache: createCache({ dir: join(OUT, "cache"), capBytes: 2e9 }),
    model: { whenReady: async () => ({ path: join(process.env.APPDATA!, "MotionBrief", "models", `whisper-${SHA}.bin`), sha256: SHA }) },
  });
  const result = await transcriber.transcribe({
    voiceoverPath: () => voiceover,
    voiceoverSha256: createHash("sha256").update(await readFile(voiceover)).digest("hex"),
    duration: 45.244063,
    language: "en",
    signal: new AbortController().signal,
    onUpdate: () => {},
  });
  if (result.error) throw new Error(result.error.message);
  await writeFile(join(OUT, "transcript.json"), JSON.stringify(result.data, null, 2));
});
