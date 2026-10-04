import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { SCHEMA_VERSION, type AnyDocument } from "./document";
import { fileStep, type FileError, type Result } from "./files";

/** Where a migration leaves the documents it replaced, inside the Project folder so they travel with it. */
export const BACKUPS_DIR = "backups";

type Migration = (document: AnyDocument, context: { appVersion: string }) => AnyDocument;

/** Each step takes a document from its schema version to the next. */
const MIGRATIONS: Record<number, Migration> = {
  1: (document, { appVersion }) => ({ ...document, schemaVersion: 2, appVersion }),
};

/** Brings a document of an older schema up to the current one, as far as there are steps to take it. */
export function migrate(document: AnyDocument, appVersion: string): AnyDocument {
  const step = MIGRATIONS[document.schemaVersion];

  if (document.schemaVersion >= SCHEMA_VERSION || !step) {
    return document;
  }

  return migrate(step(document, { appVersion }), appVersion);
}

/**
 * Copies every JSON document in the Project folder into `backups/schema <n> <time>/`, keeping their paths, before a
 * migration rewrites them. Resolves to the backup's path relative to the Project folder.
 */
export async function backUpDocuments(dir: string, schemaVersion: number, now: number): Promise<Result<string, FileError>> {
  const backup = join(BACKUPS_DIR, `schema ${schemaVersion} ${timestamp(now)}`);
  const target = join(dir, backup);

  const { error } = await fileStep(target, async () => {
    for (const file of await documentsIn(dir)) {
      const to = join(target, relative(dir, file));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(file, to);
    }
  });

  if (error) {
    return { data: null, error };
  }

  return { data: backup, error: null };
}

/** The Project's JSON documents, leaving out earlier backups and half-written files. */
async function documentsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => relative(dir, path).split(sep)[0] !== BACKUPS_DIR);
}

/** 2026-10-04 13-22-05: sorts by time and is a valid file name everywhere. */
function timestamp(now: number) {
  return new Date(now).toISOString().slice(0, 19).replace("T", " ").replaceAll(":", "-");
}
