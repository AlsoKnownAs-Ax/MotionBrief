// PROTOTYPE: static server for runs/ so the look-check sheet (with videos) opens in a browser.
// usage: node src/serve.ts [port]   ->  http://localhost:4178/lookcheck/
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { ROOT } from "./lib.ts";

const base = join(ROOT, "runs");
const types: Record<string, string> = { ".html": "text/html", ".png": "image/png", ".mp4": "video/mp4", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".wav": "audio/wav" };
const port = Number(process.argv[2] ?? 4178);
createServer((req, res) => {
  let p = normalize(join(base, decodeURIComponent(new URL(req.url!, "http://x").pathname)));
  if (!p.startsWith(base)) return res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) return res.writeHead(404).end("not found");
  const size = statSync(p).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const type = types[extname(p)] ?? "application/octet-stream";
  if (range) {
    const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(p).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/lookcheck/`));
