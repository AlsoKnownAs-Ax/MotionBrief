// SCRATCH, not committed.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouterClient } from "@orpc/server";
import { it } from "vitest";
import { bundledPreset } from "../modules/style";
import { createCore } from "./composition-root";
import { voiceover } from "./test-support/media";
import { fakeWhisper, whisperFixture } from "./test-support/whisper";

const dir = join(import.meta.dirname, "fixtures", "generation");
const unit = async (variant: string, id: string) => {
  const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(dir, variant, `${id}.${part}`), "utf8")));
  return { css: css!, html: html!, js: js! };
};

it("prints", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mb-scratch-"));
  const MODEL = randomBytes(1024);
  const modelPin = { version: "test", url: "http://127.0.0.1:9/model.bin", sha256: createHash("sha256").update(MODEL).digest("hex"), size: MODEL.length };
  const { router } = createCore({ appVersion: "0", appDataDir: join(root, "app"), projectsDir: join(root, "p"), cacheDir: join(root, "c"), modelPin, adapters: { whisper: fakeWhisper(await whisperFixture("stacked", 1)) } });
  const core = createRouterClient(router);
  await mkdir(join(root, "u"));
  await writeFile(join(root, "u", "m.bin"), MODEL);
  await core.transcriptionModel.import({ path: join(root, "u", "m.bin") });
  for await (const s of await core.transcriptionModel.watch()) if (s.state === "ready") break;
  const project = await core.project.create({ voiceoverPath: await voiceover(join(root, "u"), "talk.wav", [{ tone: 33.6 }]) });
  let transcript = { duration: 0, words: [] as { text: string; start: number }[] };
  for await (const s of await core.project.transcription({ projectId: project.id })) {
    if (s.state === "done") {
      transcript = { duration: s.duration, words: s.words };
      break;
    }
  }
  const rules = { format: "horizontal" as const, captions: false, transitions: bundledPreset("blueprint").transitions, canvas: bundledPreset("blueprint").canvas };
  const good = JSON.parse(await readFile(join(dir, "storyboard.json"), "utf8"));
  const bad = JSON.parse(await readFile(join(dir, "storyboard-too-long.json"), "utf8"));
  const out: unknown[] = [];
  out.push(await core.storyboard.validate({ storyboard: good, transcript, rules }));
  out.push(await core.storyboard.validate({ storyboard: bad, transcript, rules }));
  const code = { s01: await unit("good", "s01"), s02: await unit("good", "s02"), s03: await unit("good", "s03"), s04: await unit("good", "s04") };
  out.push(await core.checker.check({ storyboard: good, transcript, rules, preset: bundledPreset("blueprint"), code }));
  out.push(await core.checker.check({ storyboard: good, transcript, rules, preset: bundledPreset("blueprint"), code: { s03: await unit("raw-color", "s03"), s05: await unit("missing-element", "s05") } }));
  out.push(await core.checker.check({ storyboard: good, transcript, rules, preset: bundledPreset("blueprint"), code: {} }));
  await writeFile("C:/Users/andre/AppData/Local/Temp/mb-out.json", JSON.stringify(out, null, 1));
});
