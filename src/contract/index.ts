import { eventIterator, oc, type ContractRouterClient } from "@orpc/contract";
import { z } from "zod";

/**
 * The core API contract: every call the UI makes into the core. The renderer
 * imports only this (types and schemas), never the modules behind it.
 */

export const CoreInfoSchema = z.object({
  appVersion: z.string(),
  pid: z.number().int(),
  startedAt: z.number(),
});

export const HeartbeatSchema = z.object({
  seq: z.number().int().nonnegative(),
  at: z.number(),
});

export const FormatSchema = z.enum(["horizontal", "vertical"]);

/** The Transitions a Style Preset can allow. A camera move also needs both Scenes on one Canvas. */
export const PresetTransitionSchema = z.enum(["cut", "crossfade", "push", "zoom-through", "carry-over", "camera"]);

export const CanvasPreferenceSchema = z.enum(["never", "where-it-helps", "whenever-possible"]);

/** What a Storyboard is checked against: its video's Format and Captions, and the Style Preset's choices. */
export const StoryboardRulesSchema = z.object({
  format: FormatSchema,
  captions: z.boolean(),
  transitions: z.array(PresetTransitionSchema),
  canvas: CanvasPreferenceSchema,
});

/** The part of a Transcript a Storyboard is checked against. Word references are indexes into `words`. */
export const StoryboardTranscriptSchema = z.object({
  duration: z.number().nonnegative(),
  words: z.array(z.object({ text: z.string(), start: z.number().nonnegative() })),
});

export const StoryboardIssueSchema = z.object({
  code: z.enum([
    "SCHEMA",
    "FORMAT",
    "SPAN",
    "BOUNDARY",
    "PACING",
    "ANCHOR",
    "DUPLICATE_ID",
    "REFERENCE",
    "CONTENT",
    "TRANSITION",
    "CANVAS",
    "CAPTIONS",
  ]),
  /** The Scene at fault; absent when the issue is with the Storyboard as a whole. */
  sceneId: z.string().optional(),
  /** Path of the field at fault, relative to the Scene when there is one (`content.nodes[1].at`). */
  field: z.string(),
  message: z.string(),
});

/** Scene code as the agent writes it for one unit (a lone Scene, or the Scenes sharing a Canvas). */
export const UnitCodeSchema = z.object({ css: z.string(), html: z.string(), js: z.string() });

export const CheckFindingSchema = z.object({
  /** The unit at fault, named after its Scene or Canvas; absent when the finding is about the page as a whole. */
  unit: z.string().optional(),
  /** `hyperframes lint`, `hyperframes check`, the anchor contract, the token lint, or icon inlining. */
  source: z.enum(["lint", "check", "contract", "tokens", "icons"]),
  code: z.string(),
  message: z.string(),
  selector: z.string().optional(),
  /** Seconds into the video where the problem shows. */
  time: z.number().optional(),
});

/** Why the Checker couldn't run: the pinned browser is missing, or the page, browser or HyperFrames failed. */
export const CheckerUnavailableSchema = z.object({
  cause: z.enum(["CHROME_MISSING", "PAGE_FAILED", "BROWSER_FAILED", "HYPERFRAMES_FAILED"]),
  detail: z.string(),
});

export const AuthMethodSchema = z.enum(["subscription", "api-key"]);

/** The normalized error taxonomy of a connector; UI copy maps the codes to messages. */
export const ConnectorErrorSchema = z.object({
  code: z.enum([
    "AUTHENTICATION_FAILED",
    "PLAN_LIMIT",
    "BILLING",
    "RATE_LIMITED",
    "MODEL_UNAVAILABLE",
    "SERVICE_ERROR",
    "AGENT_UNAVAILABLE",
  ]),
  message: z.string(),
  resetsAt: z.number().optional(),
});

/** Where the connection to Claude stands. Holds no secret: an API key only ever appears masked. */
export const ConnectionStatusSchema = z.object({
  isConnected: z.boolean(),
  method: AuthMethodSchema.optional(),
  /** The subscription login found on this computer, labelled from Claude's account info. */
  login: z.object({ email: z.string().optional(), plan: z.string().optional() }).optional(),
  maskedKey: z.string().optional(),
  /** Days until the subscription login expires, once Claude has warned about it. */
  expiresInDays: z.number().optional(),
  error: ConnectorErrorSchema.optional(),
});

export const SetupErrorSchema = z.object({
  code: z.enum(["NO_LOGIN", "SIGN_IN_FAILED", "SIGN_IN_CANCELLED", "KEY_REJECTED", "KEY_CHECK_FAILED", "KEY_STORE_FAILED"]),
  message: z.string(),
});

/** A setup step's outcome: the status after it, and why it failed if it did. */
export const SetupResultSchema = z.object({
  status: ConnectionStatusSchema,
  error: SetupErrorSchema.optional(),
});

/** Why the transcription model isn't in place. Each variant carries what the UI needs to say so. */
export const TranscriptionModelErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("NOT_ENOUGH_SPACE"), requiredBytes: z.number(), freeBytes: z.number() }),
  /** Hugging Face couldn't be reached, or the connection broke; the part already downloaded is kept. */
  z.object({ code: z.literal("DOWNLOAD_FAILED"), url: z.string(), message: z.string() }),
  /** The download didn't match the pinned SHA-256, even after one fresh retry. */
  z.object({ code: z.literal("HASH_MISMATCH"), expected: z.string(), actual: z.string() }),
  /** The file the user chose isn't the pinned model. */
  z.object({ code: z.literal("IMPORT_MISMATCH"), path: z.string() }),
  z.object({ code: z.literal("FILE_FAILED"), path: z.string(), message: z.string() }),
]);

export const TranscriptionModelStatusSchema = z.object({
  /** `idle` until a download starts in this session, even if part of the model is already on disk. */
  state: z.enum(["idle", "downloading", "paused", "verifying", "ready", "failed"]),
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
  error: TranscriptionModelErrorSchema.optional(),
});

/** A Whisper language code, or `auto` to detect it from the Voiceover. */
export const LanguageSchema = z.string().regex(/^(auto|[a-z]{2,3})$/, "auto, or a language code such as en");

/** A Style Preset's id: one of the bundled Presets for now (blueprint, whiteboard, sketchbook, terminal). */
export const StylePresetIdSchema = z.string().regex(/^[a-z0-9-]+$/);

export const TranscriptWordSchema = z.object({
  text: z.string(),
  /** Seconds into the Voiceover. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

/** A Voiceover's words with the time each is spoken; Project-level, shared by every Format. */
export const TranscriptSchema = z.object({
  /** The language it was transcribed in: the detected one unless the creator chose another. */
  language: z.string(),
  duration: z.number().nonnegative(),
  words: z.array(TranscriptWordSchema),
});

export const VoiceoverSchema = z.object({
  /** The name of the file the creator added; the Project keeps its own copy. */
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Seconds. */
  duration: z.number().nonnegative(),
  /** It came from a video file, so only its audio is used. */
  isVideo: z.boolean(),
  /** Over 20 minutes: allowed, but generating it will be long and costly. */
  isLong: z.boolean(),
});

export const ProjectSchema = z.object({
  id: z.string(),
  /** Also the name of the Project folder. */
  name: z.string(),
  path: z.string(),
  /** The Format and Style Preset its first video is generated in. */
  format: FormatSchema,
  stylePreset: StylePresetIdSchema,
  /** The language the creator chose for the Transcript, or `auto`. */
  language: LanguageSchema,
  voiceover: VoiceoverSchema,
});

/** What a new Project starts with: the Format and Style Preset used last, and where Projects go. */
export const NewProjectDefaultsSchema = z.object({
  format: FormatSchema,
  stylePreset: StylePresetIdSchema,
  folder: z.string(),
});

export const TranscriptionErrorSchema = z.object({
  code: z.enum(["VOICEOVER_UNREADABLE", "TRANSCRIBER_FAILED", "FILE_FAILED"]),
  message: z.string(),
});

export const TranscriptionStatusSchema = z.object({
  /** `waiting-for-model` until the transcription model is downloaded; `done` once the Transcript is saved. */
  state: z.enum(["waiting-for-model", "transcribing", "done", "failed"]),
  /** Seconds of the Voiceover transcribed so far, out of `duration`. */
  transcribedSeconds: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  /** The Transcript's language, once detected or chosen. */
  language: z.string().optional(),
  /** The words transcribed so far; the whole Transcript once `done`. */
  words: z.array(TranscriptWordSchema),
  error: TranscriptionErrorSchema.optional(),
});

/** The app's cache of things it can regenerate: resampled audio and raw Whisper output. */
export const CacheStatusSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  capBytes: z.number().int().positive(),
});

const ProjectIdInput = z.object({ projectId: z.string() });

const UNKNOWN_PROJECT = { data: z.object({ projectId: z.string() }) };

/** Why creating or changing a Project failed; UI copy maps the codes to messages. */
const PROJECT_ERRORS = {
  /** FFmpeg can't read the file. */
  VOICEOVER_UNREADABLE: { data: z.object({ path: z.string(), detail: z.string() }) },
  /** A video without sound. */
  NO_AUDIO: { data: z.object({ path: z.string() }) },
  /** It can't be a folder name on every platform. */
  INVALID_NAME: { data: z.object({ name: z.string() }) },
  /** Another folder beside it has that name. */
  NAME_TAKEN: { data: z.object({ name: z.string() }) },
  UNKNOWN_PROJECT,
  FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
};

export const coreContract = {
  system: {
    info: oc.output(CoreInfoSchema),
    /** Streams one beat per second for as long as the caller listens. */
    heartbeat: oc.output(eventIterator(HeartbeatSchema)),
  },
  storyboard: {
    /** Checks an agent-written Storyboard; no issues means it is valid. */
    validate: oc
      .input(
        z.object({
          storyboard: z.unknown(),
          transcript: StoryboardTranscriptSchema,
          rules: StoryboardRulesSchema,
        }),
      )
      .output(z.object({ issues: z.array(StoryboardIssueSchema) })),
  },
  checker: {
    /**
     * Assembles a Storyboard's units in the frame and checks them: `hyperframes lint` and `check`,
     * the token lint, icons and the anchor contract. Units without code are drawn as their fallback
     * Scene. No findings means every unit passes.
     */
    check: oc
      .errors({
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        CHECKER_UNAVAILABLE: { data: CheckerUnavailableSchema },
      })
      .input(
        z.object({
          storyboard: z.unknown(),
          transcript: StoryboardTranscriptSchema,
          rules: StoryboardRulesSchema,
          code: z.record(z.string(), UnitCodeSchema),
        }),
      )
      .output(z.object({ frameContractVersion: z.string(), findings: z.array(CheckFindingSchema) })),
  },
  connection: {
    /** Checks the connection with `claude auth status`; spends no tokens. */
    status: oc.output(ConnectionStatusSchema),
    /** Chooses the subscription login found on this computer. */
    useLogin: oc.output(SetupResultSchema),
    /** Runs the bundled `claude auth login`, which opens Anthropic's sign-in; abort the call to cancel. */
    signIn: oc.output(SetupResultSchema),
    /** Checks the key with the free count_tokens endpoint, then stores and chooses it. */
    setApiKey: oc.input(z.object({ apiKey: z.string() })).output(SetupResultSchema),
    removeApiKey: oc.output(SetupResultSchema),
  },
  /** The Whisper model the Transcriber runs, downloaded once during first-run setup. */
  transcriptionModel: {
    status: oc.output(TranscriptionModelStatusSchema),
    /** Streams the status now and after every change, including download progress. */
    watch: oc.output(eventIterator(TranscriptionModelStatusSchema)),
    /** Starts the download after a free-space check, unless it has started, failed or been paused this session. */
    start: oc,
    pause: oc,
    /** Continues after a pause, or tries again after a failure: Resume and Retry. */
    resume: oc,
    /** Installs a copy of a model file the user already has, if it matches the pinned SHA-256. */
    import: oc.input(z.object({ path: z.string() })),
  },
  project: {
    defaults: oc.output(NewProjectDefaultsSchema),
    /**
     * Creates a Project folder from a Voiceover (any file FFmpeg can read) and starts transcribing it at once.
     * Unset choices default to the last used, the name to the Voiceover's file name.
     */
    create: oc
      .errors(PROJECT_ERRORS)
      .input(
        z.object({
          voiceoverPath: z.string(),
          name: z.string().optional(),
          format: FormatSchema.optional(),
          stylePreset: StylePresetIdSchema.optional(),
          language: LanguageSchema.optional(),
          /** Where the Project folder goes; the default Projects folder when absent. */
          folder: z.string().optional(),
        }),
      )
      .output(ProjectSchema),
    /** Changes an open Project's choices. A new name renames its folder; a new language transcribes it again. */
    update: oc
      .errors(PROJECT_ERRORS)
      .input(
        ProjectIdInput.extend({
          name: z.string().optional(),
          format: FormatSchema.optional(),
          stylePreset: StylePresetIdSchema.optional(),
          language: LanguageSchema.optional(),
        }),
      )
      .output(ProjectSchema),
    /** Streams the Transcript as it is transcribed, then the saved Transcript. */
    transcription: oc.errors({ UNKNOWN_PROJECT }).input(ProjectIdInput).output(eventIterator(TranscriptionStatusSchema)),
    /** Transcribes again after a failure. */
    retryTranscription: oc.errors({ UNKNOWN_PROJECT }).input(ProjectIdInput),
    /** Stops working on the Project and releases its lock. */
    close: oc.input(ProjectIdInput),
  },
  cache: {
    status: oc.output(CacheStatusSchema),
    /** Deletes everything in the cache that isn't in use right now. */
    clear: oc.output(CacheStatusSchema),
  },
};

export type CoreContract = typeof coreContract;
export type CoreClient = ContractRouterClient<CoreContract>;
export type CoreInfo = z.infer<typeof CoreInfoSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type Format = z.infer<typeof FormatSchema>;
export type PresetTransition = z.infer<typeof PresetTransitionSchema>;
export type CanvasPreference = z.infer<typeof CanvasPreferenceSchema>;
export type StoryboardRules = z.infer<typeof StoryboardRulesSchema>;
export type StoryboardTranscript = z.infer<typeof StoryboardTranscriptSchema>;
export type StoryboardIssue = z.infer<typeof StoryboardIssueSchema>;
export type UnitCode = z.infer<typeof UnitCodeSchema>;
export type CheckFinding = z.infer<typeof CheckFindingSchema>;
export type CheckerUnavailable = z.infer<typeof CheckerUnavailableSchema>;
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
export type ConnectorError = z.infer<typeof ConnectorErrorSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type SetupError = z.infer<typeof SetupErrorSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
export type TranscriptionModelError = z.infer<typeof TranscriptionModelErrorSchema>;
export type TranscriptionModelStatus = z.infer<typeof TranscriptionModelStatusSchema>;
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Voiceover = z.infer<typeof VoiceoverSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type NewProjectDefaults = z.infer<typeof NewProjectDefaultsSchema>;
export type TranscriptionError = z.infer<typeof TranscriptionErrorSchema>;
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;
export type CacheStatus = z.infer<typeof CacheStatusSchema>;
