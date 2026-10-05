import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);

const ManifestSchema = z.looseObject({ sha256: z.string(), artifacts: z.looseObject({ iife: z.string() }) });

let runtime: Promise<string> | undefined;

/**
 * The HyperFrames runtime the player drives a composition through, from the pinned producer and
 * checked against its manifest the way the producer checks it. Served with the page, so the
 * player never fetches one from a CDN.
 */
export function hyperframesRuntime(): Promise<string> {
  runtime ??= loadRuntime();

  return runtime;
}

async function loadRuntime(): Promise<string> {
  const dist = await producerDist();
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(dist, "hyperframe.manifest.json"), "utf8")));
  const source = await readFile(join(dist, manifest.artifacts.iife), "utf8");
  const sha256 = createHash("sha256").update(source, "utf8").digest("hex");

  if (sha256 !== manifest.sha256) {
    throw new Error(`The HyperFrames runtime doesn't match its manifest: expected ${manifest.sha256}, got ${sha256}`);
  }

  return source;
}

/** The producer exports only an `import` condition, so its folder is found along Node's module paths. */
async function producerDist(): Promise<string> {
  const candidates = (require.resolve.paths("@hyperframes/producer") ?? []).map((dir) => join(dir, "@hyperframes", "producer", "dist"));

  for (const dist of candidates) {
    if (await exists(join(dist, "hyperframe.manifest.json"))) {
      return dist;
    }
  }

  throw new Error("@hyperframes/producer isn't installed");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
