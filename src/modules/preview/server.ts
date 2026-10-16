import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, relative, resolve, sep } from "node:path";
import { hyperframesRuntime } from "./runtime";

/** Where the page loads the HyperFrames runtime from. */
const RUNTIME_PATH = "/hyperframes-runtime.js";

/** Where files shared one by one are served, each under a random name. */
const FILES_PATH = "/files/";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export type PreviewServer = {
  /** `http://127.0.0.1:<port>`, reachable from this computer only. */
  origin: string;
  /** Serves one file outside the pages, such as an Asset, and answers its URL; a file keeps its URL. */
  share: (file: string) => string;
  close: () => Promise<void>;
};

/**
 * Serves assembled pages from `<rootDir>/<id>/` on the loopback interface, the way the player loads
 * them: each root page gets the HyperFrames runtime, and media answers range requests so the
 * Voiceover can seek. Nothing outside a page's folder is served.
 */
export async function startPreviewServer(rootDir: string): Promise<PreviewServer> {
  const root = resolve(rootDir);
  /** Shared files by their served name, and their names by file. */
  const shared = new Map<string, string>();
  const names = new Map<string, string>();
  const server = createServer((request, response) => {
    serve(root, shared, request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }

      response.end();
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    share: (file) => {
      const name = names.get(file) ?? `${randomUUID()}${extname(file).toLowerCase()}`;
      names.set(file, name);
      shared.set(name, file);

      return `${origin}${FILES_PATH}${name}`;
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

async function serve(root: string, shared: Map<string, string>, request: IncomingMessage, response: ServerResponse) {
  const path = decodedPath(request.url ?? "/");

  if (path === RUNTIME_PATH) {
    response.writeHead(200, { "content-type": CONTENT_TYPES[".js"]!, "cache-control": "no-cache" });
    response.end(await hyperframesRuntime());
    return;
  }

  if (path === undefined) {
    notFound(response);
    return;
  }

  if (path.startsWith(FILES_PATH)) {
    await serveShared(shared.get(path.slice(FILES_PATH.length)), request, response);
    return;
  }

  const file = resolve(root, `.${path}`);

  if (!isInside(file, root) || relative(root, file).split(sep).length < 2) {
    notFound(response);
    return;
  }

  const info = await stat(file).catch(() => undefined);

  if (!info?.isFile()) {
    notFound(response);
    return;
  }

  const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

  if (file.endsWith(`${sep}index.html`)) {
    response.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    response.end(withRuntime(await readFile(file, "utf8")));
    return;
  }

  sendFile(file, info.size, type, request.headers.range, response);
}

/** A shared file never runs script, even an SVG opened on its own. */
async function serveShared(file: string | undefined, request: IncomingMessage, response: ServerResponse) {
  const info = file === undefined ? undefined : await stat(file).catch(() => undefined);

  if (!file || !info?.isFile()) {
    notFound(response);
    return;
  }

  response.setHeader("content-security-policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  sendFile(file, info.size, CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", request.headers.range, response);
}

/** The page's own scripts register their timelines first; the runtime then picks them up, as in a render. */
function withRuntime(html: string): string {
  const tag = `<script src="${RUNTIME_PATH}"></script>\n`;
  const end = html.lastIndexOf("</head>");

  if (end < 0) {
    return `${tag}${html}`;
  }

  return `${html.slice(0, end)}${tag}${html.slice(end)}`;
}

function sendFile(file: string, size: number, type: string, rangeHeader: string | undefined, response: ServerResponse) {
  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  const range = parseRange(rangeHeader, size);

  if (range === "unsatisfiable") {
    response.writeHead(416, { ...headers, "content-range": `bytes */${size}` }).end();
    return;
  }

  if (!range) {
    response.writeHead(200, { ...headers, "content-length": size });
    createReadStream(file).pipe(response);
    return;
  }

  response.writeHead(206, { ...headers, "content-length": range.end - range.start + 1, "content-range": `bytes ${range.start}-${range.end}/${size}` });
  createReadStream(file, range).pipe(response);
}

/** One `bytes=` range: `start-end`, `start-` or `-suffix`. Anything else serves the whole file. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");

  if (!match || (match[1] === "" && match[2] === "")) {
    return undefined;
  }

  const [, from = "", to = ""] = match;

  // `-suffix`: the file's last bytes.
  if (from === "") {
    return satisfiable(Math.max(0, size - Number(to)), size - 1, size);
  }

  return satisfiable(Number(from), lastByte(to, size), size);
}

/** An open-ended range runs to the end of the file, and none runs past it. */
function lastByte(to: string, size: number) {
  if (to === "") {
    return size - 1;
  }

  return Math.min(Number(to), size - 1);
}

function satisfiable(start: number, end: number, size: number): { start: number; end: number } | "unsatisfiable" {
  if (start > end || start >= size) {
    return "unsatisfiable";
  }

  return { start, end };
}

function decodedPath(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
  } catch {
    return undefined;
  }
}

function isInside(file: string, root: string): boolean {
  return file.startsWith(`${root}${sep}`);
}

function notFound(response: ServerResponse) {
  response.writeHead(404).end();
}
