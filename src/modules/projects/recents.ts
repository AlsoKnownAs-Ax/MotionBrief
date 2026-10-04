import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { fileStep, writeAtomically } from "./files";
import { samePath } from "./paths";

const RecentSchema = z.object({
  path: z.string(),
  /** The id the Project at this path owns. A copy made by Duplicate has none until it is opened. */
  id: z.string().optional(),
});

const RecentsSchema = z.array(RecentSchema);

export type Recent = z.infer<typeof RecentSchema>;

/**
 * The Projects this app made or opened, tracked by path, kept in app data. Also records which folder owns each id, so
 * a copied folder can be told from its original.
 */
export function createRecents(appDataDir: string) {
  const path = join(appDataDir, "recent-projects.json");
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Recent[]> {
    const { data: text } = await fileStep(path, () => readFile(path, "utf8"));
    const { data: recents } = RecentsSchema.safeParse(parseJson(text ?? ""));

    return recents ?? [];
  }

  /** Edits run one after another, so none is lost. Best effort: a lost entry only drops a row from Home. */
  function change(edit: (recents: Recent[]) => Recent[]) {
    const done = queue.then(async () => {
      await fileStep(appDataDir, () => mkdir(appDataDir, { recursive: true }));
      await writeAtomically(path, JSON.stringify(edit(await read()), null, 2));
    });
    queue = done.catch(() => undefined);

    return done;
  }

  return {
    all: () => queue.then(read),
    /** Adds the Project at `projectPath`; with an id, records that this folder owns it. */
    remember: (projectPath: string, id?: string) =>
      change((recents) => [
        { path: projectPath, id },
        ...recents
          .filter((recent) => !samePath(recent.path, projectPath))
          .map((recent) => (id !== undefined && recent.id === id ? { path: recent.path } : recent)),
      ]),
    moved: (from: string, to: string) => change((recents) => recents.map((recent) => (samePath(recent.path, from) ? { ...recent, path: to } : recent))),
    forget: (projectPaths: string[]) => change((recents) => recents.filter((recent) => !projectPaths.some((gone) => samePath(recent.path, gone)))),
  };
}

export type Recents = ReturnType<typeof createRecents>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
