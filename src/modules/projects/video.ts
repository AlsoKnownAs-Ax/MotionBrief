import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Format } from "../../contract";
import { fileStep, writeAtomically, type FileError, type Result } from "./files";

export const VIDEO_FILE = "video.json";

/** `<format>/video.json`: what a video keeps beside its Versions. */
export const VideoDocumentSchema = z.object({
  /** Where the creator last saved this video's MP4: a location they chose, outside the Project. */
  lastExportPath: z.string().optional(),
  /**
   * The Version whose units last passed the re-check after a frame major update, and the frame contract they passed:
   * that Version isn't re-checked again until the next major update.
   */
  frameChecked: z.object({ version: z.number().int().positive(), frameContractVersion: z.string() }).optional(),
});

export type VideoDocument = z.infer<typeof VideoDocumentSchema>;

export type VideoDocumentError = FileError | { code: "INVALID_DOCUMENT"; path: string; message: string };

/** One folder per video, named after its Format. */
export function videoDir(projectDir: string, format: Format) {
  return join(projectDir, format);
}

/** The video's document; empty before anything about the video was saved. */
export async function readVideo(projectDir: string, format: Format): Promise<Result<VideoDocument, VideoDocumentError>> {
  const path = join(videoDir(projectDir, format), VIDEO_FILE);
  const { data: text, error } = await fileStep(path, () => readFile(path, "utf8"));

  if (error) {
    return error.message.includes("ENOENT") ? { data: {}, error: null } : { data: null, error };
  }

  const { success, data: document, error: parseError } = VideoDocumentSchema.safeParse(parseJson(text));

  if (!success) {
    return { data: null, error: { code: "INVALID_DOCUMENT", path, message: parseError.message } };
  }

  return { data: document, error: null };
}

export async function saveVideo(projectDir: string, format: Format, document: VideoDocument): Promise<Result<void, FileError>> {
  const dir = videoDir(projectDir, format);
  const { error } = await fileStep(dir, () => mkdir(dir, { recursive: true }));

  if (error) {
    return { data: null, error };
  }

  return writeAtomically(join(dir, VIDEO_FILE), `${JSON.stringify(document, null, 2)}\n`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
