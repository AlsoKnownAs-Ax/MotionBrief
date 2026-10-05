// `pnpm package` runs this after the build: it writes out/licenses/, which electron-builder ships as the app's
// resources/licenses and the release workflow attaches to the GitHub Release. It holds MotionBrief's own license,
// the GPL that covers the bundled FFmpeg and THIRD_PARTY_NOTICES.txt: every npm package shipped or bundled, and
// every native dependency in vendor/, with its license files. after-extract.ts adds Electron's Chromium licenses.
import { execSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { BUNDLED_PACKAGES_DIR } from "./bundled-packages.ts";

export type Notice = {
  name: string;
  version?: string;
  license?: string;
  /** Each license file found, by its path relative to the dependency's folder. */
  files: { path: string; text: string }[];
};

/** File names that hold a license or a notice the license requires to be passed on. */
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)/i;

/** The MIT License, after its copyright line. */
const MIT_PERMISSION = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/**
 * The weights in vendor/ and the app data folder carry no license file of their own: these are the licenses
 * of the projects they come from (github.com/openai/whisper, github.com/snakers4/silero-vad).
 */
const MODEL_NOTICES: Notice[] = [
  {
    name: "whisper-model (OpenAI Whisper large-v3-turbo, ggml conversion from ggerganov/whisper.cpp)",
    license: "MIT",
    files: [{ path: "LICENSE (openai/whisper)", text: `MIT License\n\nCopyright (c) 2022 OpenAI\n\n${MIT_PERMISSION}` }],
  },
  {
    name: "whisper-vad-model (Silero VAD, ggml conversion from ggml-org/whisper-vad)",
    license: "MIT",
    files: [{ path: "LICENSE (snakers4/silero-vad)", text: `MIT License\n\nCopyright (c) 2020-present Silero Team\n\n${MIT_PERMISSION}` }],
  },
];

/** An npm package's notice, from its package.json and the license files at its top level. */
export async function packageNotice(dir: string): Promise<Notice> {
  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { name: string; version?: string; license?: string };

  return { name: manifest.name, version: manifest.version, license: manifest.license, files: await licenseFiles(dir, 0) };
}

/** A native dependency's notice: the license files its archive carries, up to two folders deep. */
export async function vendorNotice(vendorDir: string, name: string): Promise<Notice> {
  return { name, files: await licenseFiles(join(vendorDir, name), 2) };
}

async function licenseFiles(dir: string, depth: number, root = dir): Promise<Notice["files"]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Notice["files"] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);

    if (entry.isFile() && LICENSE_FILE.test(entry.name)) {
      files.push({ path: relative(root, path).replaceAll("\\", "/"), text: (await readFile(path, "utf8")).trim() });
    } else if (entry.isDirectory() && depth > 0 && entry.name !== "node_modules") {
      files.push(...(await licenseFiles(path, depth - 1, root)));
    }
  }

  return files;
}

/** One plain-text file of every notice, sorted by name, one copy per name and version. */
export function formatNotices(notices: Notice[]) {
  const unique = new Map(notices.map((notice) => [`${notice.name}@${notice.version ?? ""}`, notice]));
  const sorted = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? "").localeCompare(b.version ?? ""));
  const rule = "=".repeat(80);
  const sections = sorted.map(({ name, version, license, files }) => {
    const heading = [nameAndVersion(name, version), license && `License: ${license}`].filter(Boolean).join("\n");

    return `${rule}\n${heading}\n${rule}\n\n${licenseTexts(files).join("\n\n")}\n`;
  });

  return `MotionBrief bundles the software below. Each part keeps its own license.\n\n${sections.join("\n")}`;
}

/** A package's license files, each headed by its path when it has one. */
function licenseTexts(files: Notice["files"]) {
  if (files.length === 0) {
    return ["(The package ships no license file.)"];
  }

  return files.map(headedText);
}

function headedText({ path, text }: Notice["files"][number]) {
  if (!path) {
    return text;
  }

  return `--- ${path}\n\n${text}`;
}

function nameAndVersion(name: string, version: string | undefined) {
  if (!version) {
    return name;
  }

  return `${name} ${version}`;
}

type PnpmLicenses = Record<string, { paths: string[] }[]>;

/** Production dependencies, as installed: what electron-builder packs from node_modules. */
function productionPackageDirs(rootDir: string) {
  // Through a shell, where pnpm is a script on Windows.
  const output = execSync("pnpm licenses list --prod --json", { cwd: rootDir, encoding: "utf8", maxBuffer: 1e8 });

  return Object.values(JSON.parse(output) as PnpmLicenses).flatMap((packages) => packages.flatMap(({ paths }) => paths));
}

/** What the builds bundled into out/ (bundled-packages.ts), devDependencies such as React included. */
async function bundledPackageDirs(rootDir: string) {
  const dir = join(rootDir, BUNDLED_PACKAGES_DIR);
  const lists = await readdir(dir).catch(() => {
    throw new Error(`${dir} is missing: run pnpm build first.`);
  });

  return (await Promise.all(lists.map(async (list) => JSON.parse(await readFile(join(dir, list), "utf8")) as string[]))).flat();
}

/** The Agent SDK's per-platform package holds the `claude` binary; pnpm lists it under no license. */
async function claudePackageDirs(rootDir: string) {
  // pnpm links a package's dependencies next to it, in its own node_modules/@anthropic-ai.
  const scope = dirname(await realpath(join(rootDir, "node_modules", "@anthropic-ai", "claude-agent-sdk")));
  const names = await readdir(scope);

  return names.filter((name) => name.startsWith("claude-agent-sdk-")).map((name) => join(scope, name));
}

export async function writeLicenses(rootDir: string) {
  const outDir = join(rootDir, "out", "licenses");
  const vendorDir = join(rootDir, "vendor");
  const packageDirs = new Set([...productionPackageDirs(rootDir), ...(await bundledPackageDirs(rootDir)), ...(await claudePackageDirs(rootDir))]);
  const vendored = (await readdir(vendorDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

  const notices = [
    await packageNotice(join(rootDir, "node_modules", "electron")),
    ...(await Promise.all([...packageDirs].map(packageNotice))),
    ...(await Promise.all(vendored.map(({ name }) => vendorNotice(vendorDir, name)))),
    ...MODEL_NOTICES,
  ];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "THIRD_PARTY_NOTICES.txt"), formatNotices(notices));
  await copyFile(join(rootDir, "LICENSE"), join(outDir, "LICENSE.txt"));
  // FFmpeg and FFprobe are built with x264 and x265, so they are GPL version 2 or later.
  await copyFile(join(vendorDir, "ffmpeg", "COPYING.GPLv2.txt"), join(outDir, "COPYING.GPLv2.txt"));

  return { outDir, count: notices.length };
}

if (import.meta.main) {
  const { outDir, count } = await writeLicenses(join(import.meta.dirname, "../.."));
  console.log(`Wrote ${count} notices to ${outDir}`);
}
