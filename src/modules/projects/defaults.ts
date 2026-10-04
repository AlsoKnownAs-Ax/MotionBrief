import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FormatSchema, StylePresetIdSchema, type Format } from "../../contract";
import { fileStep, writeAtomically } from "./files";

/** The Format and Style Preset used last, which the next new Project starts with. */
const LastUsedSchema = z.object({ format: FormatSchema, stylePreset: StylePresetIdSchema });

export type LastUsed = z.infer<typeof LastUsedSchema>;

/** What the very first Project starts with. */
const FIRST: LastUsed = { format: "horizontal", stylePreset: "blueprint" };

/** Kept in app data: it is the creator's habit, not part of any Project. */
export function createLastUsed(appDataDir: string) {
  const path = join(appDataDir, "new-project.json");

  async function get(): Promise<LastUsed> {
    const { data: text } = await fileStep(path, () => readFile(path, "utf8"));
    const { data: lastUsed } = LastUsedSchema.safeParse(parseJson(text ?? ""));

    return lastUsed ?? FIRST;
  }

  /** Best effort: losing it only means the next Project starts with other choices. */
  async function remember(choices: { format: Format; stylePreset: string }) {
    await fileStep(appDataDir, () => mkdir(appDataDir, { recursive: true }));
    await writeAtomically(path, JSON.stringify({ format: choices.format, stylePreset: choices.stylePreset }));
  }

  return { get, remember };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
