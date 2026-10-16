import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CoreClient, IndexedAsset, Project, StoryboardRules } from "../contract";
import type { Storyboard } from "../modules/storyboard";
import horizontal from "./fixtures/storyboard/horizontal.json";
import transcript from "./fixtures/storyboard/transcript.json";
import { BLUEPRINT, BROWSER_TIMEOUT_MS, connect as connectChecker, RULES } from "./test-support/checker";
import { CLOSE_TIMEOUT_MS, closeFrame, FRAME_TIMEOUT_MS, openFrame, type OpenFrame } from "./test-support/frame";
import { connect, generate, newProject, sha256, storyboard as stacked, submitsStoryboard } from "./test-support/generation";
import { picture } from "./test-support/media";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "motionbrief-media-"));
});

afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

/** An indexed Asset as the Storyboard rules carry it; validation never reads its file. */
function indexed(id: string, kind: IndexedAsset["kind"], extra: Partial<IndexedAsset> = {}): IndexedAsset {
  const facts = kind === "image" || kind === "logo" ? { format: "png", width: 16, height: 10, transparent: kind === "logo" } : { format: "wav", duration: 0.3, loudness: -20 };

  return { id, kind, name: id, notes: `Notes on ${id}`, file: `${id}.${facts.format}`, ...facts, ...extra } as IndexedAsset;
}

const SHOT = "a".repeat(64);
const LOGO = "b".repeat(64);
const POP = "c".repeat(64);
const INDEX = [indexed(SHOT, "image"), indexed(LOGO, "logo"), indexed(POP, "sfx")];

/** A Scene as plain JSON, with the fields these tests give Assets. */
type EditableScene = { content: { media?: object; items: { icon?: string }[]; left: { media?: object }; right: { media?: object } } };

/** The horizontal fixture with one change, as an agent might have written it. */
function changed(change: (scenes: EditableScene[]) => void): unknown {
  const storyboard = structuredClone(horizontal) as unknown as { scenes: EditableScene[] };
  change(storyboard.scenes);

  return storyboard;
}

describe("Storyboard validation of images and logos", () => {
  const core = connectChecker();
  const validate = async (storyboard: unknown, rules: StoryboardRules = { ...RULES, assets: INDEX }) =>
    (await core.storyboard.validate({ storyboard, transcript, rules })).issues.map(({ code, sceneId, field }) => ({ code, sceneId, field }));

  it("accepts media on hook, key-term, comparison sides and outro, and a logo in an icon slot", async () => {
    const storyboard = changed(([hook, keyTerm, , , , comparison, list, , outro]) => {
      hook!.content.media = { id: "shot", asset: SHOT, at: 3 };
      keyTerm!.content.media = { id: "mark", asset: LOGO, at: 12 };
      comparison!.content.left.media = { id: "left-shot", asset: SHOT, at: 65 };
      comparison!.content.right.media = { id: "right-mark", asset: LOGO, at: 74 };
      outro!.content.media = { id: "mark", asset: LOGO, at: 104 };
      list!.content.items[0]!.icon = `asset:${LOGO}`;
    });

    expect(await validate(storyboard)).toEqual([]);
  });

  it("rejects unknown Assets and kinds out of place: an image in an icon slot, a sound as media", async () => {
    const storyboard = changed(([hook, keyTerm, , , , , list]) => {
      hook!.content.media = { id: "shot", asset: "f".repeat(64), at: 3 };
      keyTerm!.content.media = { id: "pop", asset: POP, at: 12 };
      list!.content.items[0]!.icon = `asset:${SHOT}`;
      list!.content.items[1]!.icon = "asset:bundled:no-such-logo";
    });

    expect(await validate(storyboard)).toEqual([
      { code: "ASSET", sceneId: "s01", field: "content.media.asset" },
      { code: "ASSET", sceneId: "s02", field: "content.media.asset" },
      { code: "ASSET", sceneId: "s07", field: "content.items[0].icon" },
      { code: "ASSET", sceneId: "s07", field: "content.items[1].icon" },
    ]);
  });

  it("knows no Asset without an index", async () => {
    const storyboard = changed(([hook]) => {
      hook!.content.media = { id: "shot", asset: SHOT, at: 3 };
    });

    expect(await validate(storyboard, RULES)).toEqual([{ code: "ASSET", sceneId: "s01", field: "content.media.asset" }]);
  });

  it("anchors media like any element, and gives code Scenes none", async () => {
    const storyboard = changed(([hook, , , , code]) => {
      hook!.content.media = { id: "shot", asset: SHOT, at: 40 };
      code!.content.media = { id: "shot", asset: SHOT, at: 58 };
    });

    expect(await validate(storyboard)).toEqual([
      { code: "SCHEMA", sceneId: "s05", field: "content.media" },
    ]);

    const anchored = changed(([hook]) => {
      hook!.content.media = { id: "shot", asset: SHOT, at: 40 };
    });

    expect(await validate(anchored)).toEqual([{ code: "ANCHOR", sceneId: "s01", field: "content.media.at" }]);
  });
});

describe("a generation with the creator's images and logos", () => {
  let core: CoreClient;
  let project: Project;
  let replay: Awaited<ReturnType<typeof connect>>["replay"];
  let image: string;
  let logo: string;
  let previewUrl: string;

  beforeAll(async () => {
    const dir = await mkdtemp(join(root, "generation-"));
    const shotPath = await picture(dir, "Dashboard.png", { width: 16, height: 10 });
    const logoPath = await picture(dir, "Acme.png", { color: "red@0.0", width: 8, height: 8 });
    image = sha256(await readFile(shotPath));
    logo = sha256(await readFile(logoPath));
    const [first, second, ...rest] = stacked.scenes as unknown as EditableScene[];
    const storyboard = {
      ...stacked,
      scenes: [
        { ...first, content: { ...first!.content, media: { id: "shot", asset: image, at: 7 } } },
        { ...second, content: { ...second!.content, items: second!.content.items.map((item: object, index: number) => (index === 0 ? { ...item, icon: `asset:${logo}` } : item)) } },
        ...rest,
      ],
    };
    ({ core, replay } = await connect({ root: dir, script: { storyboard: [submitsStoryboard(storyboard)] } }));
    project = await newProject(core, dir);
    await core.assets.import({ scope: "library", path: shotPath, name: "Dashboard", kind: "image", notes: "The billing dashboard" });
    await core.assets.import({ scope: "project", projectId: project.id, path: logoPath, name: "Acme", kind: "logo", notes: "Acme's logo" });

    const done = await generate(core, { projectId: project.id, format: "horizontal" });
    previewUrl = done.preview?.url ?? "";
  }, BROWSER_TIMEOUT_MS * 2);

  afterAll(() => core.project.close({ projectId: project.id }));

  it("gives the Storyboard agent the image and logo index: id, kind, name, notes and facts", () => {
    const system = replay.askedOf("storyboard")[0]?.options.systemPrompt ?? "";

    expect(system).toContain(`${image} image "Dashboard" (16x10): The billing dashboard`);
    expect(system).toContain(`${logo} logo "Acme" (8x8, transparent): Acme's logo`);
    expect(system).not.toContain("bundled:whoosh-left");
  });

  it("tells a Scene agent only its own unit's Assets, without notes or paths", () => {
    const [s01] = replay.askedOf("scene-code s01");
    const [s03] = replay.askedOf("scene-code s03");

    expect(s01?.message).toContain(JSON.stringify({ id: image, kind: "image", width: 16, height: 10, transparent: false }));
    expect(s01?.message).not.toContain("The billing dashboard");
    expect(s01?.message).not.toContain(join("app-data", "Library"));
    expect(s03?.message).not.toContain(`"kind":"image"`);
    expect(s01?.options.systemPrompt).toContain('<img src="asset(');
  });

  it("copies the Library image it uses into the Project when the Version is saved", async () => {
    expect(await readdir(join(project.path, "assets"))).toEqual(expect.arrayContaining([`${image}.png`, `${image}.json`, `${logo}.png`]));
  });

  it("plays media in fallback Scenes from the page's own copy of the Asset", async () => {
    const composition = await (await fetch(previewUrl.replace("index.html", "compositions/s01.html"))).text();
    const src = /<img id="s01-shot"[^>]*\ssrc="([^"]+)"/.exec(composition)?.[1] ?? "";

    expect(src).toMatch(/^assets\//);
    expect((await fetch(previewUrl.replace("index.html", src))).status).toBe(200);
  });
});

describe("the Checker on Scene code that shows Assets", () => {
  const LOGO_PATH = "M3 12h18M12 3l9 9-9 9-9-9z0 0l1 1 1 1 1 1 1 1";

  it(
    "reports unknown Assets, images and CSS url() not from asset(), and inlined Asset markup",
    async () => {
      const svg = join(root, "Mark.svg");
      await writeFile(svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${LOGO_PATH}"/></svg>`);
      const mark = indexed("d".repeat(64), "logo", { format: "svg", file: svg });
      const code = {
        s01: {
          css: "#s01-kicker { background-image: url(pictures/logo.png); }",
          html: `<div id="s01-headline" class="mb-title">Your request travels far</div>
<div id="s01-kicker" class="mb-body">further than you think</div>
<img id="s01-ghost" src="asset(${"e".repeat(64)})">
<img id="s01-mark" src="asset(${mark.id})">
<img id="s01-remote" src="pictures/logo.png">
<svg id="s01-inlined" viewBox="0 0 24 24"><path d="${LOGO_PATH}"/></svg>`,
          js: ["headline", "kicker", "mark"].map((id) => `MB.reveal(tl, "#s01-${id}", at("s01-${id}"));`).join("\n"),
        },
      };

      const storyboard = changed(([hook]) => {
        hook!.content.media = { id: "mark", asset: mark.id, at: 3 };
      });

      const { findings } = await connectChecker().checker.check({ storyboard, transcript, rules: { ...RULES, assets: [mark] }, preset: BLUEPRINT, code });

      expect(findings.filter(({ source }) => source === "assets").map(({ unit, code: finding }) => `${unit} ${finding}`).sort()).toEqual([
        "s01 FOREIGN_IMAGE",
        "s01 FOREIGN_IMAGE",
        "s01 INLINED_ASSET",
        "s01 UNKNOWN_ASSET",
      ]);
    },
    BROWSER_TIMEOUT_MS,
  );
});

describe("images and logos in the frame", () => {
  let frame: OpenFrame | undefined;
  const page = () => frame!.page;

  beforeAll(async () => {
    const dir = await mkdtemp(join(root, "frame-"));
    const assets = [
      indexed(SHOT, "image", { file: await picture(dir, "Shot.png", { width: 16, height: 10 }) }),
      indexed("1".repeat(64), "image", { file: await picture(dir, "Wide.png", { width: 4, height: 2 }), width: 4, height: 2 }),
      indexed(LOGO, "logo", { file: await picture(dir, "Mark.png", { color: "red@0.0", width: 8, height: 8 }), width: 8, height: 8 }),
      indexed("2".repeat(64), "logo", { file: await picture(dir, "Badge.png", { width: 8, height: 8 }), width: 8, height: 8, transparent: false }),
    ];
    const [shot, wide, mark, badge] = assets.map(({ id }) => id);
    // Scene code shows only the Assets its Storyboard names.
    const storyboard = changed(([, keyTerm, , , , comparison, list, , outro]) => {
      keyTerm!.content.media = { id: "chart", asset: SHOT, at: 16 };
      comparison!.content.left.media = { id: "wide", asset: wide, at: 65 };
      list!.content.items[0]!.icon = `asset:${mark}`;
      outro!.content.media = { id: "badge", asset: badge, at: 104 };
    }) as Storyboard;
    const slot = (id: string, asset?: string) => `<img id="s01-${id}" class="slot" src="asset(${asset})">`;
    const code = {
      s01: {
        css: ".slot { position: absolute; top: 100px; width: 800px; height: 500px; }",
        html: [slot("shot", shot), slot("wide", wide), slot("mark", mark), slot("badge", badge)].join("\n"),
        js: "",
      },
    };
    frame = await openFrame(storyboard, transcript, code, BLUEPRINT, { assets });
  }, FRAME_TIMEOUT_MS);

  afterAll(() => closeFrame(frame), CLOSE_TIMEOUT_MS);

  const looks = (ids: string[]) =>
    page().evaluate<{ fit: string; radius: string; framed: boolean; loaded: boolean }[]>(
      `${JSON.stringify(ids)}.map((id) => { const img = document.getElementById(id); const style = getComputedStyle(img); return { fit: style.objectFit, radius: style.borderRadius, framed: style.backgroundColor !== "rgba(0, 0, 0, 0)", loaded: img.naturalWidth > 0 }; })`,
    );

  it("covers an image within about 15% of its slot's aspect, contains every other image and every logo", async () => {
    await page().seek(2);

    expect((await looks(["s01-shot", "s01-wide", "s01-mark", "s01-badge"])).map(({ fit, loaded }) => ({ fit, loaded }))).toEqual([
      { fit: "cover", loaded: true },
      { fit: "contain", loaded: true },
      { fit: "contain", loaded: true },
      { fit: "contain", loaded: true },
    ]);
  });

  it("frames images in the Preset's surface and radius, sits a transparent logo bare and an opaque one on a chip", async () => {
    await page().seek(2);
    const [shot, mark, badge] = await looks(["s01-shot", "s01-mark", "s01-badge"]);

    expect(shot).toMatchObject({ radius: `${BLUEPRINT.treatments.radius}px`, framed: true });
    expect(mark).toMatchObject({ framed: false });
    expect(badge).toMatchObject({ framed: true });
  });

  it("draws media in a fallback Scene", async () => {
    await page().seek(6);

    expect(await looks(["s02-chart"])).toMatchObject([{ loaded: true }]);
  });
});
