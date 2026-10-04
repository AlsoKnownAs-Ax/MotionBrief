import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, relative, resolve, sep } from "node:path";
import { hyperframesRuntime } from "./runtime";

/** Where the page loads the HyperFrames runtime from. */
const RUNTIME_PATH = "/hyperframes-runtime.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
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
  close: () => Promise<void>;
};

/**
 * Serves assembled pages from `<rootDir>/<id>/` on the loopback interface, the way the player loads
 * them: each root page gets the HyperFrames runtime, and media answers range requests so the
 * Voiceover can seek. Nothing outside a page's folder is served.
 */
export async function startPreviewServer(rootDir: string): Promise<PreviewServer> {
  const root = resolve(rootDir);
  const server = createServer((request, response) => {
    serve(root, request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }

      response.end();
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

async function serve(root: string, request: IncomingMessage, response: ServerResponse) {
  const path = decodedPath(request.url ?? "/");

  if (path === RUNTIME_PATH) {
    response.writeHead(200, { "content-type": CONTENT_TYPES[".js"]!, "cache-control": "no-cache" });
    response.end(await hyperframesRuntime());
    return;
  }

  const file = path === undefined ? undefined : resolve(root, `.${path}`);

  if (!file || !isInside(file, root) || relative(root, file).split(sep).length < 2) {
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
  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);

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
