import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** How the server answers one request for a path. */
export type Reply = {
  body: Buffer;
  /** Sends the file up to this byte offset, then holds the connection open until the server closes. */
  stallAfter?: number;
  /** Sends the file up to this byte offset, then drops the connection, as a network failure would. */
  dropAfter?: number;
};

export type ServedRequest = { path: string; range?: string };

export type FileServer = {
  url: string;
  requests: ServedRequest[];
  /** Answers the nth request for path with the nth reply; the last reply answers every later request. */
  serve: (path: string, ...replies: Reply[]) => void;
  close: () => Promise<void>;
};

/**
 * A local stand-in for Hugging Face: answers `Range: bytes=<start>-` with 206 and the rest of the file,
 * and can stall or drop a response part way through. Any path it wasn't told to serve is a 404.
 */
export async function startFileServer(): Promise<FileServer> {
  const routes = new Map<string, Reply[]>();
  const requests: ServedRequest[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const range = request.headers.range;
    const answered = requests.filter((served) => served.path === path).length;
    requests.push({ path, range });
    const replies = routes.get(path) ?? [];
    const reply = replies[Math.min(answered, replies.length - 1)];

    if (!reply) {
      response.writeHead(404).end();

      return;
    }

    answer(response, reply, rangeStart(range));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    serve: (path, ...replies) => routes.set(path, replies),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function answer(response: ServerResponse, { body, stallAfter, dropAfter }: Reply, start: number) {
  const rest = body.subarray(start);
  const headers = { "content-length": rest.length, "accept-ranges": "bytes" };

  if (start > 0) {
    response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${body.length - 1}/${body.length}` });
  } else {
    response.writeHead(200, headers);
  }

  if (stallAfter !== undefined) {
    response.write(rest.subarray(0, stallAfter - start));

    return;
  }

  if (dropAfter !== undefined) {
    response.write(rest.subarray(0, dropAfter - start), () => response.destroy());

    return;
  }

  response.end(rest);
}

function rangeStart(range: string | undefined) {
  const start = /^bytes=(\d+)-$/.exec(range ?? "")?.[1];

  return Number(start ?? 0);
}
