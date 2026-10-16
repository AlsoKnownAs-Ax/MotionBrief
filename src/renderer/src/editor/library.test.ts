import { describe, expect, it } from "vitest";
import { assetFacts, filterAssets, kindCounts, listKey, type LibraryAsset } from "./library";

const WHOOSH: LibraryAsset = { scope: "bundled", id: "bundled:whoosh", kind: "sfx", role: "transition", name: "Whoosh", notes: "For a push.", format: "opus", duration: 0.6, loudness: -29.9 };
const IMPACT: LibraryAsset = { scope: "bundled", id: "bundled:impact", kind: "sfx", role: "impact", name: "Impact", notes: "A stat landing.", format: "opus", duration: 1.2, loudness: -14 };
const BED: LibraryAsset = { scope: "library", id: "a".repeat(64), kind: "music", name: "Brand theme", notes: "Company videos only.", format: "mp3", duration: 65, loudness: -14.2 };
const LOGO: LibraryAsset = { scope: "project", id: "b".repeat(64), kind: "logo", name: "Acme", notes: "Our mark, for the outro.", format: "svg", width: 120, height: 40, transparent: true };
const ASSETS = [WHOOSH, IMPACT, BED, LOGO];

describe("filtering the Library", () => {
  it("keeps every Asset with no filters", () => {
    expect(filterAssets(ASSETS, { kind: "all", scope: "all", query: "" })).toEqual(ASSETS);
  });

  it("filters by kind and by source", () => {
    expect(filterAssets(ASSETS, { kind: "sfx", scope: "all", query: "" })).toEqual([WHOOSH, IMPACT]);
    expect(filterAssets(ASSETS, { kind: "all", scope: "project", query: "" })).toEqual([LOGO]);
    expect(filterAssets(ASSETS, { kind: "music", scope: "bundled", query: "" })).toEqual([]);
  });

  it("searches names and notes, ignoring case and extra spaces, every word anywhere", () => {
    expect(filterAssets(ASSETS, { kind: "all", scope: "all", query: "  IMPACT " })).toEqual([IMPACT]);
    expect(filterAssets(ASSETS, { kind: "all", scope: "all", query: "outro" })).toEqual([LOGO]);
    expect(filterAssets(ASSETS, { kind: "all", scope: "all", query: "company theme" })).toEqual([BED]);
    expect(filterAssets(ASSETS, { kind: "all", scope: "all", query: "push stat" })).toEqual([]);
  });

  it("counts each kind among the Assets the source and search leave", () => {
    expect(kindCounts(ASSETS)).toEqual({ all: 4, sfx: 2, music: 1, image: 0, logo: 1 });
  });
});

describe("the list's keys", () => {
  it("moves the selection with ↑/↓ and plays each sound it lands on, stopping at the ends", () => {
    expect(listKey("ArrowDown", ASSETS, WHOOSH.id)).toEqual({ select: IMPACT.id, play: IMPACT });
    expect(listKey("ArrowUp", ASSETS, IMPACT.id)).toEqual({ select: WHOOSH.id, play: WHOOSH });
    expect(listKey("ArrowUp", ASSETS, WHOOSH.id)).toEqual({ select: WHOOSH.id, play: WHOOSH });
    expect(listKey("ArrowDown", ASSETS, LOGO.id)).toEqual({ select: LOGO.id });
  });

  it("starts from the first Asset when nothing is selected", () => {
    expect(listKey("ArrowDown", ASSETS, undefined)).toEqual({ select: WHOOSH.id, play: WHOOSH });
  });

  it("replays the selected sound with Space, and leaves an image alone", () => {
    expect(listKey(" ", ASSETS, BED.id)).toEqual({ play: BED });
    expect(listKey(" ", ASSETS, LOGO.id)).toEqual({});
  });

  it("ignores other keys and an empty list", () => {
    expect(listKey("Enter", ASSETS, BED.id)).toBeUndefined();
    expect(listKey("ArrowDown", [], undefined)).toBeUndefined();
  });
});

describe("an Asset's facts", () => {
  it("shows a sound's length and loudness, and an image's size, format and transparency", () => {
    expect(assetFacts(WHOOSH)).toBe("0.6 s · −30 LUFS");
    expect(assetFacts(BED)).toBe("1:05 · −14 LUFS");
    expect(assetFacts(LOGO)).toBe("120×40 · SVG · transparent");
  });
});
