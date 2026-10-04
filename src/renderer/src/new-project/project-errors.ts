import { ORPCError } from "@orpc/client";

type ProjectErrorData = { path?: string; name?: string; message?: string };

/** One sentence the creator can act on, per error code the Project calls answer with. */
const MESSAGES = {
  VOICEOVER_UNREADABLE: ({ path }) => `MotionBrief can't read ${fileName(path)} as audio. Try a WAV, MP3, M4A or video file.`,
  NO_AUDIO: ({ path }) => `${fileName(path)} has no sound to transcribe.`,
  INVALID_NAME: () => "A Project name can't be empty, end with a dot, or contain < > : \" / \\ | ? *.",
  NAME_TAKEN: ({ name }) => `There's already a Project called “${name ?? ""}” in this folder.`,
  UNKNOWN_PROJECT: () => "This Project was closed. Go back to Home and start again.",
  FILE_FAILED: fileFailedMessage,
  INVALID_DOCUMENT: ({ path }) => `${path ?? "This folder"} isn't a MotionBrief Project, or it is damaged.`,
  TRANSCRIPT_NOT_READY: () => "Words can be fixed once the Transcript is done.",
  UNKNOWN_WORD: () => "That word isn't in the Transcript any more. Try again.",
  INVALID_WORD: () => "A word can't be empty. To keep the word as it was, press Escape.",
} satisfies Record<string, (data: ProjectErrorData) => string>;

/** Windows says EPERM, EBUSY or EACCES when another app has the folder open or security software blocks the change. */
const BLOCKED = /EPERM|EBUSY|EACCES/;

function fileFailedMessage({ path, message }: ProjectErrorData) {
  if (BLOCKED.test(message ?? "")) {
    return `Couldn't change ${path ?? "the Project folder"}: another app is using it, or security software is blocking MotionBrief. Close it or allow MotionBrief, then try again.`;
  }

  return `Couldn't save to ${path ?? "the Project folder"}: ${message ?? "the file system refused"}.`;
}

export function projectErrorMessage(error: unknown) {
  if (error instanceof ORPCError && error.defined && error.code in MESSAGES) {
    return MESSAGES[error.code as keyof typeof MESSAGES]((error.data ?? {}) as ProjectErrorData);
  }

  return "Something went wrong talking to the MotionBrief core. Try again.";
}

function fileName(path: string | undefined) {
  return path?.split(/[\\/]/).at(-1) ?? "This file";
}
