import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Preview, SceneThumbnail, UnitCode, VideoSource } from "../contract";
import storyboard from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { chromeHeadlessShellPath } from "./native";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect, RULES } from "./test-support/checker";

/** Hand-written Scene code for two units of the horizontal fixture; the rest play as fallback Scenes. */
async function editorCode(): Promise<Record<string, UnitCode>> {
  const unit = async (id: string) => {
    const [css, html, js] = await Promise.all(["css", "html", "js"].map((part) => readFile(join(import.meta.dirname, "fixtures", "editor", `${id}.${part}`), "utf8")));

    return { css: css ?? "", html: html ?? "", js: js ?? "" };
  };

  return { s01: await unit("s01"), s08: await unit("s08") };
}

/** A tiny synthetic Voiceover: a second of 8 kHz mono silence as a WAV file. */
function silentWav(): Buffer {
  const samples = 8000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);

  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
}

let workDir = "";
let voiceover = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "motionbrief-preview-"));
  voiceover = join(workDir, "Voiceover.WAV");
  await writeFile(voiceover, silentWav());
});

afterAll(() => rm(workDir, { recursive: true, force: true }));

/** A core with its own app data folder, as a fresh install would have. */
async function core() {
  return connect({ appDataDir: await mkdtemp(join(workDir, "app-data-")) });
}

async function source(): Promise<VideoSource> {
  return { storyboard, transcript, rules: RULES, preset: BLUEPRINT, code: await editorCode(), voiceover };
}

describe("preview", () => {
  describe("opens a video", () => {
    let preview: Preview;

    beforeAll(async () => {
      preview = await (await core()).preview.open(await source());
    });

    it("times each Scene from its first word, starting 0.25 s before it, until the next Scene starts", () => {
      const scenes = preview.timeline.scenes.map(({ id, number, start, end }) => ({ id, number, start, end }));

      expect(scenes).toEqual([
        { id: "s01", number: 1, start: 0, end: 4.65 },
        { id: "s02", number: 2, start: 4.65, end: 10.25 },
        { id: "s03", number: 3, start: 10.25, end: 15.45 },
        { id: "s04", number: 4, start: 15.45, end: 21.45 },
        { id: "s05", number: 5, start: 21.45, end: 25.85 },
        { id: "s06", number: 6, start: 25.85, end: 32.25 },
        { id: "s07", number: 7, start: 32.25, end: 36.65 },
        { id: "s08", number: 8, start: 36.65, end: 41.45 },
        { id: "s09", number: 9, start: 41.45, end: 45.5 },
      ]);
    });

    it("plays Scenes without code as fallback Scenes, and groups Scenes on a Canvas into one unit", () => {
      const scenes = preview.timeline.scenes.map(({ id, type, unit, status }) => ({ id, type, unit, status }));

      expect(scenes).toEqual([
        { id: "s01", type: "hook", unit: "s01", status: "ready" },
        { id: "s02", type: "key-term", unit: "s02", status: "fallback" },
        { id: "s03", type: "architecture-diagram", unit: "c1", status: "fallback" },
        { id: "s04", type: "flow", unit: "c1", status: "fallback" },
        { id: "s05", type: "code", unit: "s05", status: "fallback" },
        { id: "s06", type: "comparison", unit: "s06", status: "fallback" },
        { id: "s07", type: "list", unit: "s07", status: "fallback" },
        { id: "s08", type: "stat-chart", unit: "s08", status: "ready" },
        { id: "s09", type: "outro", unit: "s09", status: "fallback" },
      ]);
    });

    it("names the Transition into each Scene", () => {
      expect(preview.timeline.scenes.map(({ transitionIn }) => transitionIn)).toEqual([
        undefined,
        "cut",
        "crossfade",
        "camera",
        "push-left",
        "zoom-through",
        "carry-over",
        "crossfade",
        "cut",
      ]);
    });

    it("lays out the Format and every Transcript word until the next one starts", () => {
      const { format, width, height, duration, words } = preview.timeline;

      expect({ format, width, height, duration }).toEqual({ format: "horizontal", width: 1920, height: 1080, duration: 45.5 });
      expect(words).toHaveLength(112);
      expect(words[0]).toEqual({ text: "Every", start: 0.5, end: 0.9 });
      expect(words.at(-1)).toEqual({ text: "networking.", start: 44.9, end: 45.5 });
    });
  });

  describe("serves the video to a browser", () => {
    let preview: Preview;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    const requests: string[] = [];
    type Played = { duration: number; audio: { src: string; start: string | null; duration: string | null } };
    let played: Played | undefined;

    beforeAll(async () => {
      preview = await (await core()).preview.open(await source());
      browser = await puppeteer.launch({ executablePath: chromeHeadlessShellPath(), headless: true, args: ["--no-sandbox"] });
      const page = await browser.newPage();
      page.on("request", (request) => requests.push(request.url()));
      await page.goto(preview.url, { waitUntil: "load" });
      await page.waitForFunction("window.__playerReady === true", { timeout: 30_000 });
      // The expression's result can't be type-checked; it is the shape built below.
      played = (await page.evaluate(`(() => {
        const audio = document.querySelector("audio");
        return {
          duration: window.__player.getDuration(),
          audio: { src: audio.src, start: audio.getAttribute("data-start"), duration: audio.getAttribute("data-duration") },
        };
      })()`)) as Played;
    }, BROWSER_TIMEOUT_MS);

    afterAll(() => browser?.close());

    it("on this computer only, with the HyperFrames runtime the player drives, so no request leaves it", () => {
      const origin = new URL(preview.url).origin;

      expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
      expect(played?.duration).toBe(45.5);
    });

    it("with the Voiceover as its audio track from the start, byte for byte", async () => {
      const response = await fetch(played!.audio.src);

      expect(played?.audio).toMatchObject({ start: "0", duration: "45.5" });
      expect(Buffer.from(await response.arrayBuffer()).equals(silentWav())).toBe(true);
    });

    it("answers a range request for the Voiceover, so the player can seek in it", async () => {
      const response = await fetch(played!.audio.src, { headers: { range: "bytes=44-47" } });

      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes 44-47/${silentWav().length}`);
      expect((await response.arrayBuffer()).byteLength).toBe(4);
    });

    it("and nothing outside the video's folder", async () => {
      const origin = new URL(preview.url).origin;
      const response = await fetch(`${origin}/${preview.id}/..%2F..%2F..%2Fsecret.txt`);

      expect(response.status).toBe(404);
    });
  });

  it("builds the same page from the same source, under the same id", async () => {
    const [first, second] = await Promise.all([(await core()).preview.open(await source()), (await core()).preview.open(await source())]);
    const [firstPage, secondPage] = await Promise.all([fetch(first.url).then((response) => response.text()), fetch(second.url).then((response) => response.text())]);

    expect(second.id).toBe(first.id);
    expect(secondPage).toBe(firstPage);
  });

  it(
    "keeps the anchor contract on the assembled page, with Scene code, fallback Scenes, cuts and crossfades",
    async () => {
      const { code } = await source();

      const report = await (await core()).checker.check({ storyboard, transcript, rules: RULES, preset: BLUEPRINT, code });

      expect(report.findings).toEqual([]);
    },
    BROWSER_TIMEOUT_MS,
  );

  it(
    "renders a thumbnail of each Scene, scaled down from the frame",
    async () => {
      const client = await core();
      const { id } = await client.preview.open(await source());
      const thumbnails: SceneThumbnail[] = [];

      for await (const thumbnail of await client.preview.thumbnails({ id })) {
        thumbnails.push(thumbnail);
      }

      expect(thumbnails.map(({ sceneId }) => sceneId)).toEqual(["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09"]);
      expect(thumbnails.map(({ image }) => jpegSize(image))).toEqual(Array.from({ length: 9 }, () => ({ width: 320, height: 180 })));
    },
    BROWSER_TIMEOUT_MS,
  );

  describe("refuses to open", () => {
    it("an invalid Storyboard, with its issues", async () => {
      const invalid = { ...storyboard, scenes: [storyboard.scenes[0], { ...storyboard.scenes[1], id: "s01" }, ...storyboard.scenes.slice(2)] };

      const open = (await core()).preview.open({ ...(await source()), storyboard: invalid });

      await expect(open).rejects.toMatchObject({ code: "INVALID_STORYBOARD", data: { issues: [expect.objectContaining({ code: "DUPLICATE_ID", sceneId: "s01" })] } });
    });

    it("code for a unit the Storyboard doesn't have", async () => {
      const { code } = await source();

      const open = (await core()).preview.open({ ...(await source()), code: { ...code, s03: code.s01! } });

      await expect(open).rejects.toMatchObject({ code: "UNKNOWN_UNIT", data: { unit: "s03" } });
    });

    it("a Voiceover that isn't there", async () => {
      const missing = join(workDir, "gone.wav");

      const open = (await core()).preview.open({ ...(await source()), voiceover: missing });

      await expect(open).rejects.toMatchObject({ code: "VOICEOVER_MISSING", data: { path: missing } });
    });
  });

  it("refuses thumbnails for a video it hasn't opened", async () => {
    const thumbnails = async () => {
      for await (const thumbnail of await (await core()).preview.thumbnails({ id: "0123456789abcdef" })) {
        void thumbnail;
      }
    };

    await expect(thumbnails()).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND", data: { id: "0123456789abcdef" } });
  });

  describe("the fixture Project", () => {
    it("opens its video in development builds", async () => {
      const client = connect({ appDataDir: await mkdtemp(join(workDir, "app-data-")), sampleDir: join(import.meta.dirname, "fixtures") });

      const { name, preview } = await client.preview.openSample();

      expect(name).toBe("Fixture Project");
      expect(preview.timeline.scenes.filter(({ status }) => status === "ready").map(({ id }) => id)).toEqual(["s01", "s08"]);
    });

    it("isn't there in other builds", async () => {
      await expect((await core()).preview.openSample()).rejects.toMatchObject({ code: "SAMPLE_UNAVAILABLE" });
    });
  });
});

/** A JPEG data URL's pixel size, read from its start-of-frame marker. */
function jpegSize(dataUrl: string): { width: number; height: number } | undefined {
  const [prefix, base64] = dataUrl.split(",");

  if (prefix !== "data:image/jpeg;base64" || !base64) {
    return undefined;
  }

  const bytes = Buffer.from(base64, "base64");

  for (let offset = 2; offset < bytes.length; offset += 2 + bytes.readUInt16BE(offset + 2)) {
    const marker = bytes.readUInt16BE(offset);

    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
  }

  return undefined;
}
