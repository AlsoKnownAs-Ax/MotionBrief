import type { Transcript, TranscriptWord } from "../../contract";

export type Result<T, E> = { data: T; error: null } | { data: null; error: E };

export type TranscriberError = {
  code: "VOICEOVER_UNREADABLE" | "TRANSCRIBER_FAILED" | "FILE_FAILED";
  message: string;
};

/** How far a transcription has got, reported as it goes so the Transcript can fill in live. */
export type TranscriptionUpdate = {
  state: "waiting-for-model" | "transcribing";
  /** Seconds of the Voiceover transcribed so far. */
  transcribedSeconds: number;
  /** Once detected or chosen. */
  language?: string;
  words: TranscriptWord[];
};

export type TranscriptionRequest = {
  /** Where the Voiceover is now: a Project folder can be renamed while it is transcribed. */
  voiceoverPath: () => string;
  /** The Voiceover's content hash: transcriptions are cached by content, not by Project. */
  voiceoverSha256: string;
  /** Seconds. */
  duration: number;
  /** A Whisper language code, or `auto`. */
  language: string;
  signal: AbortSignal;
  onUpdate: (update: TranscriptionUpdate) => void;
};

/**
 * Voiceover in, word-timed Transcript out. The composition root picks the implementation: local whisper-cli in v1,
 * leaving room for an API backend later.
 */
export type Transcriber = {
  transcribe: (request: TranscriptionRequest) => Promise<Result<Transcript, TranscriberError>>;
};
