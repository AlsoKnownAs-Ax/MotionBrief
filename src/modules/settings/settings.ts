import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SettingsSchema, type RoleModels, type Settings, type SettingsChanges } from "../../contract";

/** The model each agent role runs on until the creator chooses another: Opus, with Sonnet for visual review. */
export const DEFAULT_MODELS: RoleModels = {
  storyboard: "claude-opus-5-5",
  sceneCode: "claude-opus-5-5",
  visualReview: "claude-sonnet-5-5",
  revision: "claude-opus-5-5",
};

export const DEFAULT_SETTINGS: Settings = { models: DEFAULT_MODELS, approveCost: true };

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type SettingsError = { code: "FILE_FAILED"; path: string; message: string };

export type SettingsStore = ReturnType<typeof createSettings>;

/**
 * The creator's app settings, kept in app data: they are the creator's, not any Project's. Read once, then served
 * from memory; every change is written before it is answered, one at a time.
 */
export function createSettings({ appDataDir }: { appDataDir: string }) {
  const path = join(appDataDir, "settings.json");
  let current: Promise<Settings> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** The saved settings, with defaults for anything missing or unreadable. */
  function get(): Promise<Settings> {
    current ??= load();

    return current;
  }

  async function load(): Promise<Settings> {
    const text = await readFile(path, "utf8").catch(() => "");
    const saved = SettingsSchema.partial().safeParse(parseJson(text));

    if (!saved.success) {
      return DEFAULT_SETTINGS;
    }

    return { ...DEFAULT_SETTINGS, ...saved.data, models: { ...DEFAULT_MODELS, ...saved.data.models } };
  }

  function update(changes: SettingsChanges): Promise<Result<Settings, SettingsError>> {
    const step = queue.then(async (): Promise<Result<Settings, SettingsError>> => {
      const { costCapUsd, models, approveCost } = changes;
      const before = await get();
      const next: Settings = {
        models: { ...before.models, ...models },
        approveCost: approveCost ?? before.approveCost,
        ...(costCapUsd === null ? {} : { costCapUsd: costCapUsd ?? before.costCapUsd }),
      };

      try {
        await mkdir(appDataDir, { recursive: true });
        await writeAtomically(path, `${JSON.stringify(next, null, 2)}\n`);
      } catch (error) {
        return { data: null, error: { code: "FILE_FAILED", path, message: String(error) } };
      }

      current = Promise.resolve(next);

      return { data: next, error: null };
    });
    queue = step;

    return step;
  }

  return { get, update };
}

async function writeAtomically(path: string, content: string) {
  const staged = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(staged, content);
    await rename(staged, path);
  } finally {
    await rm(staged, { force: true });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
