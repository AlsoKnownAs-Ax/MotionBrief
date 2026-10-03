import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bsdtarPath } from "./files.ts";

export type FileServer = {
  url: string;
  /** Request paths in the order they arrived. */
  requests: string[];
  serve: (path: string, body: Buffer | string) => void;
  close: () => Promise<void>;
};

/** A local HTTP server that answers only the paths it was told to serve; anything else is a 404. */
export async function startFileServer(): Promise<FileServer> {
  const files = new Map<string, Buffer>();
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push(path);
    const body = files.get(path);

    if (!body) {
      response.writeHead(404).end();

      return;
    }

    response.writeHead(200, { "content-length": body.length }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    serve: (path, body) => files.set(path, Buffer.from(body)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function tempDir() {
  return mkdtemp(join(tmpdir(), "motionbrief-deps-"));
}

/** Packs files (relative path → content) into a zip, the way the real archives come. */
export async function packZip(files: Record<string, string>) {
  return pack(files, "archive.zip");
}

/** Packs files into a gzipped tarball, the way npm serves packages. */
export async function packTarball(files: Record<string, string>) {
  return pack(files, "archive.tgz");
}

export function sha256(body: Buffer | string) {
  return createHash("sha256").update(body).digest("hex");
}

async function pack(files: Record<string, string>, name: string) {
  const dir = await tempDir();
  const content = join(dir, "content");

  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(content, path)), { recursive: true });
    await writeFile(join(content, path), body);
  }

  const archive = join(dir, name);
  // -a picks the format from the extension.
  const tar = spawnSync(bsdtarPath(), ["-a", "-cf", archive, "-C", content, ...Object.keys(files)]);

  if (tar.status !== 0) {
    throw new Error(`bsdtar failed: ${tar.stderr}`);
  }

  return readFile(archive);
}
