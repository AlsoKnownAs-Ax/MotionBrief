import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "../deps/test-support.ts";
import { packageDirOf } from "./bundled-packages.ts";
import { formatNotices, packageNotice, vendorNotice } from "./licenses.ts";

let rootDir: string;

beforeEach(async () => {
  rootDir = await tempDir();
});

async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}

describe("packageNotice", () => {
  it("reads a package's name, version, license and the license files at its top level", async () => {
    const dir = join(rootDir, "node_modules", "zod");
    await writeFiles(dir, {
      "package.json": JSON.stringify({ name: "zod", version: "4.6.5", license: "MIT" }),
      LICENSE: "MIT License\n\nCopyright (c) Colin McDonnell\n",
      "README.md": "not a license",
      "lib/LICENSE": "a nested copy",
    });

    expect(await packageNotice(dir)).toEqual({ name: "zod", version: "4.6.5", license: "MIT", files: [{ path: "LICENSE", text: "MIT License\n\nCopyright (c) Colin McDonnell" }] });
  });
});

describe("vendorNotice", () => {
  it("collects a native dependency's license files from the folders its archive unpacks into", async () => {
    await writeFiles(join(rootDir, "vendor"), {
      "ffmpeg/COPYING.GPLv2.txt": "GNU GENERAL PUBLIC LICENSE",
      "ffmpeg/LICENSE-zlib.txt": "zlib license",
      "ffmpeg/ffmpeg.exe": "binary",
      "chrome-headless-shell/chrome-headless-shell-win64/LICENSE.headless_shell": "Chromium license",
    });

    expect(await vendorNotice(join(rootDir, "vendor"), "ffmpeg")).toEqual({
      name: "ffmpeg",
      files: [
        { path: "COPYING.GPLv2.txt", text: "GNU GENERAL PUBLIC LICENSE" },
        { path: "LICENSE-zlib.txt", text: "zlib license" },
      ],
    });
    expect((await vendorNotice(join(rootDir, "vendor"), "chrome-headless-shell")).files).toEqual([
      { path: "chrome-headless-shell-win64/LICENSE.headless_shell", text: "Chromium license" },
    ]);
  });
});

describe("formatNotices", () => {
  it("lists each package once, by name, and says when one ships no license file", () => {
    const zod = { name: "zod", version: "4.6.5", license: "MIT", files: [{ path: "LICENSE", text: "MIT text" }] };
    const text = formatNotices([zod, { name: "@orpc/client", version: "1.15.4", license: "MIT", files: [] }, zod]);

    expect(text.match(/^zod 4\.6\.5$/gm)).toHaveLength(1);
    expect(text.indexOf("@orpc/client 1.15.4")).toBeLessThan(text.indexOf("zod 4.6.5"));
    expect(text).toContain("--- LICENSE\n\nMIT text");
    expect(text).toContain("(The package ships no license file.)");
  });
});

describe("packageDirOf", () => {
  it("finds the package a bundled module belongs to, scoped or not, through pnpm's store", () => {
    expect(packageDirOf("/repo/node_modules/.pnpm/react@19.3.0/node_modules/react/cjs/react.production.js")).toBe("/repo/node_modules/.pnpm/react@19.3.0/node_modules/react");
    expect(packageDirOf("C:\\repo\\node_modules\\.pnpm\\x\\node_modules\\@tanstack\\query-core\\build\\index.js")).toBe("C:\\repo\\node_modules\\.pnpm\\x\\node_modules\\@tanstack\\query-core");
    expect(packageDirOf("\0/repo/node_modules/zustand/index.js?commonjs-proxy")).toBe("/repo/node_modules/zustand");
    expect(packageDirOf("/repo/src/renderer/src/app.tsx")).toBeUndefined();
  });
});
