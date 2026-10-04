import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FormatSchema, type Format, type ProjectSummary } from "../../contract";
import { readAnyDocument } from "./document";
import { fileStep } from "./files";
import { LOCK_FILE } from "./locks";
import { samePath } from "./paths";

/** A video's folder is named after its Format, and holds its Version manifests in `versions/` (ADR 0004). */
export function versionsDir(projectDir: string, format: Format) {
  return join(projectDir, format, "versions");
}

/** A Project as Home lists it, or undefined when the folder no longer holds one. */
export async function summarize(dir: string, projectsDir: string): Promise<ProjectSummary | undefined> {
  const { data: document } = await readAnyDocument(dir);

  if (!document) {
    return undefined;
  }

  const [{ bytes, modifiedAt }, videos] = await Promise.all([sizeOf(dir), videosOf(dir)]);
  const chosen = document.format ? [document.format] : [];

  return {
    path: dir,
    name: basename(dir),
    // Before its first video, the Format it will be generated in.
    formats: videos.length > 0 ? videos.map(({ format }) => format) : chosen,
    duration: document.voiceover?.duration,
    versions: videos.reduce((total, { versions }) => total + versions, 0),
    bytes,
    modifiedAt,
    location: samePath(dirname(dir), projectsDir) ? undefined : dirname(dir),
  };
}

/** Every file's size and the newest change, leaving out the lock, which only says the Project is open. */
async function sizeOf(dir: string) {
  const { data: entries } = await fileStep(dir, () => readdir(dir, { recursive: true, withFileTypes: true }));
  const files = (entries ?? []).filter((entry) => entry.isFile() && !(entry.name === LOCK_FILE && entry.parentPath === dir));
  const stats = await Promise.all(files.map((entry) => stat(join(entry.parentPath, entry.name)).catch(() => undefined)));

  return stats.reduce(
    (total, stats) => ({ bytes: total.bytes + (stats?.size ?? 0), modifiedAt: Math.max(total.modifiedAt, stats?.mtimeMs ?? 0) }),
    { bytes: 0, modifiedAt: 0 },
  );
}

async function videosOf(dir: string) {
  const videos = await Promise.all(
    FormatSchema.options.map(async (format) => {
      const path = versionsDir(dir, format);
      const { data: files } = await fileStep(path, () => readdir(path));

      return { format, versions: files?.filter((file) => file.endsWith(".json")).length };
    }),
  );

  return videos.flatMap(({ format, versions }) => (versions === undefined ? [] : [{ format, versions }]));
}
