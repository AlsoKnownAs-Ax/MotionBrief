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

/** The 9 Scene Types. */
export const SceneTypeSchema = z.enum([
  "hook",
  "key-term",
  "architecture-diagram",
  "flow",
  "code",
  "comparison",
  "list",
  "stat-chart",
  "outro",
]);

/** The Transitions a Storyboard can name: a push has a direction, and a carry-over names the element it morphs. */
export const TransitionTypeSchema = z.enum([
  "cut",
  "crossfade",
  "push-left",
  "push-right",
  "push-up",
  "push-down",
  "zoom-through",
  "carry-over",
  "camera",
]);

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

/** What a video is assembled from: its Storyboard, Transcript and units' Scene code, and its Voiceover. */
export const VideoSourceSchema = z.object({
  storyboard: z.unknown(),
  transcript: StoryboardTranscriptSchema,
  rules: StoryboardRulesSchema,
  /** Scene code per unit id; a unit without code plays as its fallback Scene. */
  code: z.record(z.string(), UnitCodeSchema),
  /** The Voiceover file, played as the video's audio track. Absent, the video plays silent. */
  voiceover: z.string().optional(),
});

/** How a Scene plays: from its Scene code, or as its fallback Scene. */
export const SceneStatusSchema = z.enum(["ready", "fallback"]);

/** A video laid out in time, as the editor's player and Scene timeline show it. Times are seconds. */
export const VideoTimelineSchema = z.object({
  format: FormatSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().nonnegative(),
  scenes: z.array(
    z.object({
      id: z.string(),
      /** The Scene's place in the video, counted from 1. */
      number: z.number().int().positive(),
      type: SceneTypeSchema,
      /** The unit the Scene's code belongs to: the Scene's own id, or its Canvas. */
      unit: z.string(),
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
      status: SceneStatusSchema,
      /** The Transition from the Scene before into this one; the first Scene has none. */
      transitionIn: TransitionTypeSchema.optional(),
    }),
  ),
  /** The Transcript's words, each until the next one starts. */
  words: z.array(z.object({ text: z.string(), start: z.number().nonnegative(), end: z.number().nonnegative() })),
});

/** An assembled video the player can load: `url` serves its root composition on this computer. */
export const PreviewSchema = z.object({
  id: z.string(),
  url: z.string(),
  timeline: VideoTimelineSchema,
});

/** A Scene's still, as a data URL, for its card in the Scene timeline. */
export const SceneThumbnailSchema = z.object({ sceneId: z.string(), image: z.string() });

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
  preview: {
    /**
     * Assembles a video and serves it for the player: Scene timing from the word anchors, the
     * Transitions, fallback Scenes for units without code, and the Voiceover track. The same source
     * always builds the same page, under the same id.
     */
    open: oc
      .errors({
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        VOICEOVER_MISSING: { data: z.object({ path: z.string() }) },
      })
      .input(VideoSourceSchema)
      .output(PreviewSchema),
    /** Renders a still of each Scene of an open preview, streaming each as it is ready. */
    thumbnails: oc
      .errors({
        PREVIEW_NOT_FOUND: { data: z.object({ id: z.string() }) },
        CHECKER_UNAVAILABLE: { data: CheckerUnavailableSchema },
      })
      .input(z.object({ id: z.string() }))
      .output(eventIterator(SceneThumbnailSchema)),
    /**
     * Opens the fixture Project's video, until Projects open from disk. Only development builds
     * have it; elsewhere this fails with SAMPLE_UNAVAILABLE.
     */
    openSample: oc.errors({ SAMPLE_UNAVAILABLE: {} }).output(z.object({ name: z.string(), preview: PreviewSchema })),
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
export type SceneType = z.infer<typeof SceneTypeSchema>;
export type TransitionType = z.infer<typeof TransitionTypeSchema>;
export type VideoSource = z.infer<typeof VideoSourceSchema>;
export type SceneStatus = z.infer<typeof SceneStatusSchema>;
export type VideoTimeline = z.infer<typeof VideoTimelineSchema>;
export type TimelineScene = VideoTimeline["scenes"][number];
export type TimelineWord = VideoTimeline["words"][number];
export type Preview = z.infer<typeof PreviewSchema>;
export type SceneThumbnail = z.infer<typeof SceneThumbnailSchema>;
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
export type ConnectorError = z.infer<typeof ConnectorErrorSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type SetupError = z.infer<typeof SetupErrorSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
export type TranscriptionModelError = z.infer<typeof TranscriptionModelErrorSchema>;
export type TranscriptionModelStatus = z.infer<typeof TranscriptionModelStatusSchema>;
