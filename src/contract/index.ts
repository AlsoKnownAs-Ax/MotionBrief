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

/** A Palette's fixed roles: backgrounds, surfaces, a line color, text, three accents, positive and negative. */
export const PaletteRoleSchema = z.enum(["bg", "bg2", "surface", "surface2", "line", "ink", "muted", "accent", "accent2", "accent3", "good", "bad"]);

/** The Palette roles that can be kept to fills: the accents, positive and negative. */
export const AccentRoleSchema = z.enum(["accent", "accent2", "accent3", "good", "bad"]);

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a six-digit hex color, such as #ff7a3d");

/** The colors of a Style Preset, light or dark; a Preset holds its own copy, never a link to a bundled Palette. */
export const PaletteSchema = z.object({
  name: z.string().trim().min(1).max(40),
  mode: z.enum(["light", "dark"]),
  colors: z.record(PaletteRoleSchema, HexColorSchema),
  /** Accents used only as fills with ink on them, never as text or lines, so they may sit close to bg. */
  fills: z.array(AccentRoleSchema).optional(),
});

/**
 * Where a Palette falls short of WCAG AA: text (or ink on a fill) below 4.5:1, an accent used for text or lines
 * below 3:1, a fill that barely stands out from bg, or a line color that barely shows. `block` stops a Preset
 * from being saved; `warn` only says so. Ratios are rounded to two decimals, as they are compared.
 */
export const ContrastFindingSchema = z.object({
  level: z.enum(["block", "warn"]),
  use: z.enum(["text", "accent", "fill", "line"]),
  /** The color that falls short. */
  role: PaletteRoleSchema,
  /** The color it is read against. */
  against: PaletteRoleSchema,
  ratio: z.number(),
  minimum: z.number(),
});

/** The OFL font families the frame bundles; Scene code reaches them only through `var(--font-*)`. */
export const FontFamilySchema = z.enum(["Inter", "JetBrains Mono", "Manrope", "IBM Plex Mono", "Fredoka", "Nunito", "VT323"]);

export const FaceSchema = z.object({
  family: FontFamilySchema,
  weight: z.number().int().min(100).max(900).multipleOf(100),
  /** CSS letter-spacing in em. */
  tracking: z
    .string()
    .regex(/^-?\d*\.?\d+em$/, "use a letter-spacing in em, such as -0.03em")
    .optional(),
  /** Size relative to the frame's type scale, for faces that run small or large. */
  scale: z.number().min(0.5).max(2).optional(),
});

/** An OFL font pairing: a face for each typography role. */
export const TypographySchema = z.object({
  name: z.string().trim().min(1).max(40),
  display: FaceSchema,
  body: FaceSchema,
  label: FaceSchema,
  mono: FaceSchema,
});

/** The frame-owned visual treatments a Style Preset picks; Scene code never draws them itself. */
export const TreatmentsSchema = z.object({
  surface: z.enum(["flat", "outlined", "elevated"]),
  /** Corner radius of surfaces, in pixels. */
  radius: z.number().int().min(0).max(48),
  background: z.enum(["solid", "gradient", "dot-grid", "line-grid"]),
  connector: z.object({ style: z.enum(["straight", "curved"]), weight: z.number().int().min(1).max(8) }),
  line: z.enum(["clean", "sketchy"]),
  texture: z.enum(["none", "paper", "film-grain", "scanlines"]),
  icons: z.enum(["outline", "outline-chip", "filled-chip"]),
});

/** How energetically (energy) and in what manner (character) elements move. */
export const MotionSchema = z.object({
  energy: z.enum(["calm", "balanced", "punchy"]),
  character: z.enum(["smooth", "springy", "snappy", "stepped"]),
});

/** How Captions show the current word: highlighted, popping, or plain. */
export const CaptionStyleSchema = z.enum(["highlight", "pop", "plain"]);

/** A Style Preset, the same in either Format. A video keeps a snapshot of the one it was generated with. */
export const StylePresetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "use a kebab-case id"),
  name: z.string().trim().min(1).max(40),
  palette: PaletteSchema,
  typography: TypographySchema,
  treatments: TreatmentsSchema,
  motion: MotionSchema,
  /** Written direction for the agent: what the video should feel like. */
  direction: z.string().trim().min(1).max(600),
  transitions: z.array(PresetTransitionSchema).min(1),
  canvas: CanvasPreferenceSchema,
  captions: CaptionStyleSchema,
});

/** A Style Preset as the app lists it: the bundled ones are read-only and are duplicated to edit. */
export const ListedPresetSchema = StylePresetSchema.extend({ readOnly: z.boolean() });

/** A font family the frame bundles, with the weights it ships; a face may use only these. */
export const BundledFontSchema = z.object({ family: FontFamilySchema, weights: z.array(z.number().int()) });

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
    /** A Revision's patch changes Scenes outside the ones the creator selected. */
    "SCOPE",
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
  /**
   * `hyperframes lint`, `hyperframes check`, the anchor contract, the token lint, icon inlining, or
   * the Checker's own rules (an icon or image over text, a texture overlay too opaque).
   */
  source: z.enum(["lint", "check", "contract", "tokens", "icons", "rules"]),
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

/** A unit a generation is still working on: waiting for a free subagent, being written, or being checked. */
export const UnitWorkSchema = z.enum(["queued", "writing", "checking"]);

/** What a video is assembled from: its Storyboard, Transcript, Style Preset snapshot and units' Scene code, and its Voiceover. */
export const VideoSourceSchema = z.object({
  storyboard: z.unknown(),
  transcript: StoryboardTranscriptSchema,
  rules: StoryboardRulesSchema,
  /** The video's Style Preset snapshot. */
  preset: StylePresetSchema,
  /** Scene code per unit id; a unit without code plays as its fallback Scene. */
  code: z.record(z.string(), UnitCodeSchema),
  /** Units still being generated, which play as the Storyboard animatic until their code is written. */
  pending: z.record(z.string(), UnitWorkSchema).optional(),
  /** The Voiceover file, played as the video's audio track. Absent, the video plays silent. */
  voiceover: z.string().optional(),
  /** The visual reviewer's remaining complaint per unit id, for units whose repair was reverted. */
  notes: z.record(z.string(), z.string()).optional(),
  /**
   * Whether Captions are drawn, when that differs from what the Storyboard was written for (`rules.captions`):
   * Captions turned on later still check the Storyboard by the rules it was written to.
   */
  captions: z.boolean().optional(),
});

/**
 * How a Scene plays: from its Scene code (`flagged` when it carries a review note), or as its fallback
 * Scene; or, while a generation is still working on it, as the Storyboard animatic (its planned
 * elements appearing on their words).
 */
export const SceneStatusSchema = z.enum(["ready", "flagged", "fallback", ...UnitWorkSchema.options]);

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
      /** The visual reviewer's sentence on a `flagged` Scene: what still looks wrong after its reverted repair. */
      note: z.string().optional(),
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

/** One video of a Project: a Project has at most one video in each Format. */
export const VideoRefSchema = z.object({ projectId: z.string(), format: FormatSchema });

/** Why an export saved nothing. */
export const ExportErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("CHROME_MISSING"), path: z.string() }),
  z.object({ code: z.literal("FFMPEG_MISSING"), path: z.string() }),
  /** The render itself failed; `message` is the producer's. */
  z.object({ code: z.literal("RENDER_FAILED"), message: z.string() }),
  /** The chosen folder isn't there, or the MP4 couldn't be moved into it. */
  z.object({ code: z.literal("SAVE_FAILED"), path: z.string(), message: z.string() }),
  /** MotionBrief is restarting into an app update, so it starts no new exports. */
  z.object({ code: z.literal("UPDATING") }),
]);

export const ExportStageSchema = z.enum(["preparing", "capturing", "encoding", "finishing"]);

/** Where an export stands: rendering through its stages, then saved or failed. */
export const ExportStatusSchema = z.object({
  state: z.enum(["rendering", "done", "failed"]),
  /** While rendering. */
  stage: ExportStageSchema.optional(),
  /** 0 to 1, across every stage, while rendering. */
  progress: z.number().min(0).max(1).optional(),
  /** Where the MP4 was saved, once done. */
  path: z.string().optional(),
  error: ExportErrorSchema.optional(),
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
    /** The run reached the creator's "Stop a run above $X" cap; it stops as Stop does. */
    "COST_CAP",
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

/** A Style Preset's id: a bundled Preset (blueprint, whiteboard, sketchbook, terminal) or one of the creator's own. */
export const StylePresetIdSchema = z.string().regex(/^[a-z0-9-]+$/);

export const TranscriptWordSchema = z.object({
  text: z.string(),
  /** Seconds into the Voiceover. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  /** What whisper-cli heard, once the creator fixed the word's text; absent while the word is as heard. */
  heard: z.string().optional(),
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

/** A Project as Home lists it, open or not. */
export const ProjectSummarySchema = z.object({
  path: z.string(),
  /** The folder's name. */
  name: z.string(),
  /** The Formats it has videos in; before its first video, the Format it will be generated in. */
  formats: z.array(FormatSchema),
  /** The Voiceover's length in seconds, when the document says. */
  duration: z.number().nonnegative().optional(),
  /** Versions across all its videos. */
  versions: z.number().int().nonnegative(),
  /** Everything in the folder. */
  bytes: z.number().int().nonnegative(),
  /** The newest change to any file in it, in ms since the epoch. */
  modifiedAt: z.number().nonnegative(),
  /** The folder it is in, when that isn't the default Projects folder. */
  location: z.string().optional(),
});

/** An opened Project, and where its old files went if it was migrated to this app's schema. */
export const OpenedProjectSchema = z.object({
  project: ProjectSchema,
  /** Relative to the Project folder. */
  backupPath: z.string().optional(),
  /** Videos whose first generation the app quit or crashed during: saved as a Version on this open, by Stop's rules. */
  recovered: z.array(z.object({ format: FormatSchema, version: z.number().int().positive() })).optional(),
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

const CostRangeSchema = z.object({ low: z.number().nonnegative(), high: z.number().nonnegative() });

/** What a first generation will take, before the creator presses Generate. */
export const GenerationEstimateSchema = z.object({
  /** Wall-clock minutes. */
  minutes: z.object({ low: z.number().nonnegative(), high: z.number().nonnegative() }),
  /** US dollars, from the running cost per Voiceover minute; only on an API key, since a subscription isn't billed per run. */
  costUsd: CostRangeSchema.optional(),
  /** API key with "Approve cost before running" on: Generate needs the creator's approval of `costUsd`. */
  needsApproval: z.boolean(),
});

/** The agent roles, each running on the model Settings choose for it. Retry runs on the Scene code model. */
export const ModelRoleSchema = z.enum(["storyboard", "sceneCode", "visualReview", "revision"]);

/** The models Settings offer for an agent role. */
export const MODEL_CHOICES = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

export const ModelIdSchema = z.enum(MODEL_CHOICES.map(({ id }) => id) as [string, ...string[]]);

export const RoleModelsSchema = z.object({
  storyboard: ModelIdSchema,
  sceneCode: ModelIdSchema,
  visualReview: ModelIdSchema,
  revision: ModelIdSchema,
});

/** The creator's app settings. Changes apply to the next run, except the cap, which a running run follows too. */
export const SettingsSchema = z.object({
  models: RoleModelsSchema,
  /** API key only: an estimate to approve before a first generation, and before any Revision that regenerates Scenes. */
  approveCost: z.boolean(),
  /** API key only: a run stops, as Stop does, once its agent runs together have cost this many US dollars. */
  costCapUsd: z.number().positive().optional(),
});

export const SettingsChangesSchema = z.object({
  models: RoleModelsSchema.partial().optional(),
  approveCost: z.boolean().optional(),
  /** `null` removes the cap. */
  costCapUsd: z.number().positive().nullable().optional(),
});

/** Tokens and, on an API key, US dollars. A subscription isn't billed per run, so it never shows dollars. */
export const UsageTotalsSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});

/** What one agent role used in a run, on the model it ran on. */
export const RoleUsageSchema = UsageTotalsSchema.extend({ role: ModelRoleSchema, model: z.string() });

/** A subscription plan's usage window, from Claude's rate-limit reports. */
export const PlanWindowSchema = z.object({
  window: z.enum(["five-hour", "seven-day"]),
  /** 0-1, when Claude reports it. */
  utilization: z.number().min(0).max(1).optional(),
  /** Epoch ms. */
  resetsAt: z.number().optional(),
  /** The window's limit is reached: runs are refused until it resets. */
  isRejected: z.boolean(),
});

export const UsageStatusSchema = z.object({
  method: AuthMethodSchema.optional(),
  /** The video's latest run, summed across its parallel agent runs: running, finished, or stopped at the cap. */
  run: z
    .object({
      state: z.enum(["running", "finished", "capped"]),
      roles: z.array(RoleUsageSchema),
      total: UsageTotalsSchema,
      /** API key only: the cap it runs under. */
      capUsd: z.number().optional(),
    })
    .optional(),
  /** Everything the video's runs have used, stored with the video. */
  video: UsageTotalsSchema.optional(),
  /** Every run today, on this computer. */
  today: UsageTotalsSchema,
  /** Subscription only: the plan's windows as last reported. */
  plan: z.array(PlanWindowSchema),
});

/** Why a generation ended without a video. */
export const GenerationErrorSchema = z.discriminatedUnion("code", [
  /** The Storyboard agent's last Storyboard still had these issues after its retries. */
  z.object({ code: z.literal("STORYBOARD_INVALID"), issues: z.array(StoryboardIssueSchema) }),
  /** The Storyboard agent couldn't run or stopped, such as when Claude isn't connected. */
  z.object({ code: z.literal("AGENT_FAILED"), error: ConnectorErrorSchema }),
  z.object({ code: z.literal("FILE_FAILED"), path: z.string(), message: z.string() }),
]);

/** A unit of the video being generated: its Scene code is written, checked and retried on its own. */
export const GenerationUnitSchema = z.object({
  /** Named after its Scene, or its Canvas. */
  id: z.string(),
  status: SceneStatusSchema,
  /** Scene code the agent has submitted so far; more than one means it was retried. */
  attempts: z.number().int().nonnegative(),
});

/** Why the video so far couldn't be shown, such as its Voiceover having moved. */
export const GenerationPreviewErrorSchema = z.object({ code: z.string(), message: z.string() });

/**
 * Why a run ended early, keeping its finished units: the creator pressed Stop, the subscription plan's limit was
 * reached (until `resetsAt`, epoch ms), Claude's login failed, or the Project was closed.
 */
export const GenerationStopSchema = z.object({
  cause: z.enum(["stopped", "plan-limit", "cost-cap", "authentication", "closed"]),
  resetsAt: z.number().optional(),
});

export const GenerationStatusSchema = z.object({
  /**
   * `idle` until Generate is pressed, and again after a stop before the Storyboard was valid; `planning` while the
   * Storyboard is written; `writing` while its units are, or flagged units are retried.
   */
  state: z.enum(["idle", "planning", "writing", "done", "failed"]),
  /** Set when the run ended early. `done` then has a complete Version whose unfinished units are flagged fallbacks. */
  stopped: GenerationStopSchema.optional(),
  /** Every unit, once the Storyboard is valid. */
  units: z.array(GenerationUnitSchema),
  /** The video so far, once the Storyboard is valid: it plays as units finish, the rest as the Storyboard animatic. */
  preview: PreviewSchema.optional(),
  /** Set while the newest preview couldn't be built; `preview`, if any, is then an older one. The generation carries on. */
  previewError: GenerationPreviewErrorSchema.optional(),
  /** The Version the generation saved, once `done`. */
  version: z.number().int().positive().optional(),
  error: GenerationErrorSchema.optional(),
});

/** A change the creator asks for in chat, scoped to the selected Scenes, or to the whole video when none are. */
export const RevisionRequestSchema = z.object({
  message: z.string().trim().min(1),
  /** Scene ids of the current Version; empty for the whole video. */
  scope: z.array(z.string()),
});

/**
 * A Revision offered after a word fix, when the old word is still on screen: the request to send, scoped to the
 * Scenes whose copy says it. Declined, nothing changes.
 */
export const WordFixOfferSchema = RevisionRequestSchema.extend({
  /**
   * Every spelling of the word the on-screen copy still says (its text before the fix, what whisper-cli heard), and
   * the fixed word, without the punctuation around them.
   */
  from: z.array(z.string()).min(1),
  to: z.string(),
});

/** Why a Revision ended without a Version. */
export const RevisionErrorSchema = z.discriminatedUnion("code", [
  /** The agent's Storyboard patch still had these issues after its retries. */
  z.object({ code: z.literal("PATCH_INVALID"), issues: z.array(StoryboardIssueSchema) }),
  /** The Revision agent couldn't run or stopped, such as when Claude isn't connected. */
  z.object({ code: z.literal("AGENT_FAILED"), error: ConnectorErrorSchema }),
  /** The checks couldn't run on the units the patch re-renders. */
  z.object({ code: z.literal("CHECKER_UNAVAILABLE"), detail: z.string() }),
  z.object({ code: z.literal("FILE_FAILED"), path: z.string(), message: z.string() }),
]);

/** A unit the Revision rebuilds: re-rendered from its own code, or regenerated by a Scene-code subagent. */
export const RevisionUnitSchema = z.object({
  /** Named after its Scene, or its Canvas, in the revised Storyboard. */
  id: z.string(),
  rebuild: z.enum(["rerender", "regenerate"]),
  status: SceneStatusSchema,
  attempts: z.number().int().nonnegative(),
});

export const RevisionStatusSchema = z.object({
  /**
   * `idle` until a request is sent; `revising` while the agent reads it; `rebuilding` while units are re-rendered and
   * regenerated; `saving` once its Version is being saved, when Stop is too late. It ends `answered` (a reply or one
   * clarifying question, no Version), `done` (a new Version), `failed` or `stopped`; neither of the last two leaves a
   * Version. On an API key with approval on, a Revision that regenerates Scenes waits in `approval` after planning
   * until the creator approves `costUsd` (`video.approveRevision`) or stops it.
   */
  state: z.enum(["idle", "revising", "approval", "rebuilding", "saving", "answered", "done", "failed", "stopped"]),
  request: RevisionRequestSchema.optional(),
  /** Scenes of the current Version the Revision is working on: the scope while the agent reads it, then what it rebuilds. */
  affected: z.array(z.string()),
  units: z.array(RevisionUnitSchema),
  /** The agent's answer or clarifying question, once `answered`. */
  reply: z.string().optional(),
  /** The agent's one-line summary of its change. */
  summary: z.string().optional(),
  /** US dollars, while `approval`: what regenerating its Scenes is estimated to cost. */
  costUsd: CostRangeSchema.optional(),
  /** Scenes whose instruction couldn't be applied, so they kept their previous code. */
  notApplied: z.array(z.string()).optional(),
  /** The Version the Revision saved, once `done`, and the video as it now is. */
  version: z.number().int().positive().optional(),
  preview: PreviewSchema.optional(),
  /** Set when the new Version is saved but couldn't be shown. */
  previewError: GenerationPreviewErrorSchema.optional(),
  error: RevisionErrorSchema.optional(),
});

/**
 * What opening a video found after an app update changed the frame's major version: its units were checked again
 * against the new frame, at no cost, and these no longer pass. They play as flagged fallback Scenes in a new Version.
 */
export const FrameUpdateSchema = z.object({
  /** The frame contract the units were written against, and the one they were checked against now. */
  previous: z.string(),
  frameContractVersion: z.string(),
  /** The units that became flagged fallbacks, named after their Scene or Canvas. */
  units: z.array(z.string()).min(1),
});

/** A video of a Project as it plays now: its newest Version, or nothing in a Format without a video. */
export const OpenedVideoSchema = z.object({
  version: z.number().int().positive().optional(),
  /** Whether the video shows Captions. */
  captions: z.boolean().optional(),
  /** The Style Preset snapshot the Version is drawn in, which the Style tab changes. */
  preset: StylePresetSchema.optional(),
  preview: PreviewSchema.optional(),
  /** Present when this open re-checked the units after a frame major update and some failed. */
  frameUpdate: FrameUpdateSchema.optional(),
});

/**
 * What made a Version: a first generation; the re-check after a frame major update, which flagged units that no
 * longer pass; a Retry of flagged units; a Revision; a Restore of an earlier Version; a Style tab swap, re-rendered
 * with no agent; a restyle, which regenerated every unit; or a regeneration from scratch, a new Storyboard and every unit.
 */
export const VersionOriginSchema = z.enum(["generation", "frame-update", "retry", "revision", "restore", "style", "restyle", "regeneration"]);

/**
 * What a change in the Style tab costs: nothing, when it changes nothing; a `swap` (Palette, typography, caption style,
 * Captions on or off) re-renders with no agent; a `restyle` (another Style Preset, Motion, direction, treatments,
 * Transitions or Canvas preference) regenerates every unit.
 */
export const StyleChangeKindSchema = z.enum(["none", "swap", "restyle"]);

/** What a style change did: a swap answers with the video as it now plays; a restyle streams through `generation`. */
export const StyleChangedSchema = z.object({
  change: StyleChangeKindSchema,
  video: OpenedVideoSchema.optional(),
});

/** A saved Version as the Versions tab lists it. */
export const VersionSummarySchema = z.object({
  version: z.number().int().positive(),
  origin: VersionOriginSchema,
  createdAt: z.iso.datetime(),
  /** What a Revision was asked, and its one-line summary; a style change's summary says what it changed. */
  request: z.string().optional(),
  summary: z.string().optional(),
  /** The Version a Restore copied. */
  restoredFrom: z.number().int().positive().optional(),
  /** Units playing as their fallback Scene. */
  fallbacks: z.number().int().nonnegative(),
});

/**
 * Where a request sent in chat stands: `queued` behind the running job or a paused queue; `running` as a Revision;
 * then how its Revision ended. `refused` when the Revision couldn't start, such as a scope naming a Scene the video no
 * longer has; `closed` when MotionBrief quit or crashed while it ran, which discards a Revision.
 */
export const ChatRequestStateSchema = z.enum(["queued", "running", "answered", "done", "failed", "stopped", "closed", "refused"]);

/**
 * A line of the video's chat, as its append-only log adds up: a request the creator sent, with what came of it, or a
 * Restore. Kept with the video, so the chat outlives the window and the app.
 */
export const ChatEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["request", "restore"]),
  /** When it was sent, or restored. */
  at: z.iso.datetime(),
  message: z.string().optional(),
  /** The Scenes a request was scoped to; none for the whole video. */
  scope: z.array(z.string()).optional(),
  state: ChatRequestStateSchema.optional(),
  /** The agent's answer or clarifying question. */
  reply: z.string().optional(),
  summary: z.string().optional(),
  notApplied: z.array(z.string()).optional(),
  /** The Version it saved: a Revision's, or the Restore's. */
  version: z.number().int().positive().optional(),
  restoredFrom: z.number().int().positive().optional(),
  error: RevisionErrorSchema.optional(),
  /** The estimated cost the creator approved for the Scenes its Revision regenerates, on an API key with approval on. */
  approvedUsd: CostRangeSchema.optional(),
  /** The code the Revision was refused with. */
  refused: z.string().optional(),
});

export const ChatStatusSchema = z.object({
  entries: z.array(ChatEntrySchema),
  /**
   * Queued requests wait for Resume queue: after MotionBrief quit or crashed with requests queued, and after a
   * Revision was stopped. Nothing is ever spent on its own.
   */
  isPaused: z.boolean(),
  /**
   * Set while how a request ended couldn't be saved to the Project folder: the queue pauses, the chat shows it as it
   * ended, and Resume queue saves it again before running anything.
   */
  saveError: z.object({ path: z.string(), message: z.string() }).optional(),
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
  /** The folder has no Project document, or one MotionBrief can't read. */
  NOT_A_PROJECT: { data: z.object({ path: z.string(), detail: z.string() }) },
  /** A newer MotionBrief saved it; opening it here could damage it. Nothing was changed. */
  PROJECT_TOO_NEW: { data: z.object({ path: z.string(), name: z.string(), appVersion: z.string().optional() }) },
  /**
   * Its `.lock` says it is open elsewhere. Stale when the holder is gone (a MotionBrief that quit unexpectedly) or on
   * another computer; opening with `force` takes the lock either way.
   */
  PROJECT_LOCKED: {
    data: z.object({
      path: z.string(),
      name: z.string(),
      host: z.string(),
      isThisComputer: z.boolean(),
      isStale: z.boolean(),
      lockedAt: z.number(),
    }),
  },
  /** Another window has it open. */
  ALREADY_OPEN: { data: z.object({ path: z.string() }) },
};

/** Why a word fix was refused. */
const WORD_FIX_ERRORS = {
  UNKNOWN_PROJECT,
  /** Words can be fixed once the Transcript is saved, not while it is transcribed. */
  TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
  /** `index` is past the end of the Transcript's `words`. */
  UNKNOWN_WORD: { data: z.object({ index: z.number(), words: z.number() }) },
  /** A word's text can't be empty. */
  INVALID_WORD: { data: z.object({ text: z.string() }) },
  FILE_FAILED: PROJECT_ERRORS.FILE_FAILED,
};

const ProjectPathInput = z.object({ path: z.string() });

const LockedPathInput = ProjectPathInput.extend({
  /** Go ahead even though the lock says it is open elsewhere: "Open anyway" and the like. */
  force: z.boolean().optional(),
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
     * the token lint, icons, the anchor contract and the Checker's own rules. Units without code are
     * drawn as their fallback Scene. No findings means every unit passes.
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
          /** The video's Style Preset snapshot, which the frame draws the units in. */
          preset: StylePresetSchema,
          code: z.record(z.string(), UnitCodeSchema),
        }),
      )
      .output(z.object({ frameContractVersion: z.string(), findings: z.array(CheckFindingSchema) })),
  },
  style: {
    /** The Style Presets to choose from: the four bundled ones, read-only and Blueprint first, then the creator's own. */
    presets: oc.output(z.array(ListedPresetSchema)),
    /** The bundled Palettes a Preset copies its colors from. */
    palettes: oc.output(z.array(PaletteSchema)),
    /** The bundled OFL font pairings a Preset copies its typography from. */
    typography: oc.output(z.array(TypographySchema)),
    /** The font families the frame bundles, with their weights. */
    fonts: oc.output(z.array(BundledFontSchema)),
    /** Checks a Palette against the contrast rule; no findings means it passes. */
    contrast: oc.input(z.object({ palette: PaletteSchema })).output(z.object({ findings: z.array(ContrastFindingSchema) })),
    /** Makes the creator's own copy of any Preset, under a new id and name, to edit. */
    duplicate: oc
      .errors({ UNKNOWN_PRESET: { data: z.object({ id: z.string() }) }, FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) } })
      .input(z.object({ id: StylePresetIdSchema }))
      .output(ListedPresetSchema),
    /**
     * Saves the creator's edits to one of their own Presets, unless the contrast rule blocks its Palette. Answers
     * with the warnings it saved with. Videos keep their own snapshot, so a save never changes one.
     */
    save: oc
      .errors({
        READ_ONLY: { data: z.object({ id: z.string() }) },
        UNKNOWN_PRESET: { data: z.object({ id: z.string() }) },
        LOW_CONTRAST: { data: z.object({ findings: z.array(ContrastFindingSchema) }) },
        UNBUNDLED_WEIGHT: { data: z.object({ family: FontFamilySchema, weight: z.number(), weights: z.array(z.number()) }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(z.object({ preset: StylePresetSchema }))
      .output(z.object({ preset: ListedPresetSchema, findings: z.array(ContrastFindingSchema) })),
    /** Deletes one of the creator's own Presets; videos made with it keep their snapshot. */
    remove: oc
      .errors({
        READ_ONLY: { data: z.object({ id: z.string() }) },
        UNKNOWN_PRESET: { data: z.object({ id: z.string() }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(z.object({ id: StylePresetIdSchema })),
    /** A still of a small diagram drawn in the bundled frame in a Preset, as a JPEG data URL; cached by Preset. */
    sample: oc
      .errors({ CHECKER_UNAVAILABLE: { data: CheckerUnavailableSchema } })
      .input(z.object({ preset: StylePresetSchema }))
      .output(z.object({ image: z.string() })),
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
    openSample: oc.errors({ SAMPLE_UNAVAILABLE: {} }).output(z.object({ projectId: z.string(), name: z.string(), preview: PreviewSchema })),
  },
  export: {
    /**
     * Renders an open preview's video to an MP4 with the engine the player uses, then saves it at
     * `path` and remembers that path for the video. Streams its status; abort the call to cancel,
     * and nothing is saved.
     */
    mp4: oc
      .errors({ PREVIEW_NOT_FOUND: { data: z.object({ id: z.string() }) } })
      .input(z.object({ previewId: z.string(), path: z.string(), video: VideoRefSchema }))
      .output(eventIterator(ExportStatusSchema)),
    /** Where the video was last exported to; absent before its first export. */
    lastPath: oc.input(VideoRefSchema).output(z.object({ path: z.string().optional() })),
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
    /** The recent Projects: those in the default folder and those opened from elsewhere, newest change first. */
    list: oc.output(z.array(ProjectSummarySchema)),
    /**
     * Opens a Project folder from anywhere in this window, closing the window's other Project. Takes its lock, migrates
     * an older schema forward after backing up its documents, and gives a copied folder its own id. A Project without
     * a saved Transcript starts transcribing; one with a Transcript, word fixes and all, is never transcribed again.
     */
    open: oc
      .errors(PROJECT_ERRORS)
      .input(
        LockedPathInput.extend({
          /**
           * Opens it again after the core restarted: takes a lock left on this computer by a holder that is gone, such as
           * the crashed core, without asking. Any other lock still answers PROJECT_LOCKED.
           */
          reclaim: z.boolean().optional(),
        }),
      )
      .output(OpenedProjectSchema),
    /** Renames a closed Project, which renames its folder. A lock left by anyone else needs `force`, as open does. */
    rename: oc.errors(PROJECT_ERRORS).input(LockedPathInput.extend({ name: z.string() })).output(ProjectSummarySchema),
    /** Copies a Project's folder beside it. The copy keeps the id until it is first opened, which gives it its own. */
    duplicate: oc.errors(PROJECT_ERRORS).input(ProjectPathInput).output(ProjectSummarySchema),
    /** Moves a closed Project's folder to the Trash or Recycle Bin. A lock left by anyone else needs `force`. */
    delete: oc.errors(PROJECT_ERRORS).input(LockedPathInput),
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
    /**
     * Fixes a misheard word: changes the text of the word at `index` in the saved Transcript and keeps its timing.
     * The Transcript is Project-level, so a fix never makes a Version. Answers with the word as saved.
     */
    fixWord: oc
      .errors(WORD_FIX_ERRORS)
      .input(ProjectIdInput.extend({ index: z.number().int().nonnegative(), text: z.string() }))
      .output(TranscriptWordSchema),
    /** Transcribes again after a failure. */
    retryTranscription: oc.errors({ UNKNOWN_PROJECT }).input(ProjectIdInput),
    /** Stops working on the Project and releases its lock. */
    close: oc.input(ProjectIdInput),
  },
  video: {
    /** How long, and on an API key what, generating the video will take, and whether Generate needs approving. */
    estimate: oc.errors({ UNKNOWN_PROJECT }).input(VideoRefSchema).output(GenerationEstimateSchema),
    /**
     * Turns the video's Captions on or off. A video not generated yet saves it as the choice its generation takes; a
     * generated video's switch is a swap, as `changeStyle` makes it: a new Version, which alone says whether Captions
     * show, re-rendered with no agent run. Answers with the video as it plays now, as `open` does.
     */
    setCaptions: oc
      .errors({
        UNKNOWN_PROJECT,
        FILE_FAILED: PROJECT_ERRORS.FILE_FAILED,
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        VOICEOVER_MISSING: { data: z.object({ path: z.string() }) },
        /** A generation, Retry, Revision or Restore is running; switch once it ends. */
        BUSY: { data: z.object({ projectId: z.string() }) },
      })
      .input(VideoRefSchema.extend({ captions: z.boolean() }))
      .output(OpenedVideoSchema),
    /**
     * Changes the video's look from the Style tab: `preset` is the snapshot to draw it in (another Style Preset, or the
     * current one with instant changes) and `captions` turns Captions on or off. A swap saves a new Version at once,
     * re-rendered with no agent run, and answers with it. A restyle regenerates every unit, keeping the Storyboard
     * unless the new Preset's allowed Transitions or Canvas preference rule it out, in which case it is planned again:
     * it always needs `confirmed`, which on an API key also approves its cost. It starts and returns at once; progress
     * streams through `generation`, and it saves a Version as a first generation does.
     */
    changeStyle: oc
      .errors({
        UNKNOWN_PROJECT,
        FILE_FAILED: PROJECT_ERRORS.FILE_FAILED,
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        /** The video has no Version yet; its first generation takes the Project's Style Preset. */
        NO_VIDEO: { data: z.object({ format: FormatSchema }) },
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        VOICEOVER_MISSING: { data: z.object({ path: z.string() }) },
        /** A generation, Retry, Revision or Restore is running; change the style once it ends. */
        BUSY: { data: z.object({ projectId: z.string() }) },
        /**
         * The change is a restyle: ask the creator, then change again with `confirmed`. `replans` when the Storyboard
         * must be planned again; `costUsd` on an API key, priced like a first generation.
         */
        RESTYLE_UNCONFIRMED: { data: z.object({ replans: z.boolean(), costUsd: CostRangeSchema.optional() }) },
      })
      .input(
        VideoRefSchema.extend({
          preset: StylePresetSchema.optional(),
          captions: z.boolean().optional(),
          /** The creator confirmed the restyle, and on an API key its cost. */
          confirmed: z.boolean().optional(),
        }),
      )
      .output(StyleChangedSchema),
    /**
     * Generates the video from the Project's Transcript: a Storyboard, then each unit's Scene code, checked and
     * retried, saved as Version 1. The Project's first video is drawn in its Style Preset; the other Format's
     * copies the first video's current Preset snapshot and shares its Transcript. A Format is always a generation
     * of its own, never a Revision of the other. Only ever starts when the creator presses Generate.
     */
    generate: oc
      .errors({
        UNKNOWN_PROJECT,
        /** The Voiceover is still being transcribed. */
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        GENERATING: { data: z.object({ projectId: z.string() }) },
        /** The video exists; it changes through Revisions and the Style tab. */
        ALREADY_GENERATED: { data: z.object({ version: z.number().int().positive() }) },
        UNKNOWN_STYLE_PRESET: { data: z.object({ stylePreset: z.string() }) },
        /** API key with "Approve cost before running" on: generate again with `approved` once the creator approves the estimate. */
        APPROVAL_REQUIRED: { data: z.object({ costUsd: CostRangeSchema }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(
        VideoRefSchema.extend({
          /** The creator approved the estimate. Ignored on a subscription, which never asks. */
          approved: z.boolean().optional(),
        }),
      ),
    /**
     * Regenerates a generated video from scratch: a new Storyboard and every unit, in its current Style Preset snapshot
     * and Captions. It always needs `confirmed`, which on an API key also approves its cost. The current Version plays
     * until it completes and saves the next Version; cut short (Stop, the cost cap, a plan limit, a failed login, a crash)
     * it is discarded, as a restyle is. It starts and returns at once; progress streams through `generation`.
     */
    regenerate: oc
      .errors({
        UNKNOWN_PROJECT,
        FILE_FAILED: PROJECT_ERRORS.FILE_FAILED,
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        /** The video has no Version yet: Generate it instead. */
        NO_VIDEO: { data: z.object({ format: FormatSchema }) },
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        VOICEOVER_MISSING: { data: z.object({ path: z.string() }) },
        /** A generation, Retry, Revision or Restore is running; regenerate once it ends. */
        BUSY: { data: z.object({ projectId: z.string() }) },
        /** Ask the creator, then regenerate again with `confirmed`; `costUsd` on an API key, priced like a first generation. */
        REGENERATE_UNCONFIRMED: { data: z.object({ costUsd: CostRangeSchema.optional() }) },
      })
      .input(
        VideoRefSchema.extend({
          /** The creator confirmed the regeneration, and on an API key its cost. */
          confirmed: z.boolean().optional(),
        }),
      ),
    /** Streams the video's generation now and after every change, until the window stops listening. */
    generation: oc.errors({ UNKNOWN_PROJECT }).input(VideoRefSchema).output(eventIterator(GenerationStatusSchema)),
    /**
     * Starts a Revision of the video's current Version: a fresh agent run that answers, asks one clarifying question,
     * or patches the Storyboard. Our code decides what each unit needs from the patch (ADR 0003), and a patch saves a
     * new Version. Progress streams through `revision`.
     */
    revise: oc
      .errors({
        UNKNOWN_PROJECT,
        /** The video has no Version to revise yet. */
        NOT_GENERATED: { data: z.object({ projectId: z.string() }) },
        /** One Revision runs at a time per video. */
        REVISING: { data: z.object({ projectId: z.string() }) },
        /** The scope names a Scene the current Version doesn't have. */
        UNKNOWN_SCENE: { data: z.object({ sceneId: z.string() }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(VideoRefSchema.extend(RevisionRequestSchema.shape)),
    /** Streams the video's Revision now and after every change, until the window stops listening. */
    revision: oc.errors({ UNKNOWN_PROJECT }).input(VideoRefSchema).output(eventIterator(RevisionStatusSchema)),
    /** Lets a Revision waiting in `approval` regenerate its Scenes; no-op otherwise. */
    approveRevision: oc.input(VideoRefSchema),
    /**
     * After the word at `index` was fixed from `previous`, searches the current Version's Storyboard copy for the word
     * as it was. Answers with a Revision to offer, scoped to the Scenes that still say it, or nothing when none do or
     * the video has no Version. Captions follow the Transcript on their own; only Scene copy needs a Revision.
     */
    wordFixOffer: oc
      .errors({ UNKNOWN_PROJECT, UNKNOWN_WORD: WORD_FIX_ERRORS.UNKNOWN_WORD, FILE_FAILED: PROJECT_ERRORS.FILE_FAILED })
      .input(VideoRefSchema.extend({ index: z.number().int().nonnegative(), previous: z.string() }))
      .output(WordFixOfferSchema.optional()),
    /** Stops the running Revision and discards it: the current Version stays as it is. Queued requests pause. */
    stopRevision: oc.input(VideoRefSchema),
    /**
     * Sends a request in chat. It runs as a Revision at once when the video is idle; while a generation, Retry or
     * Revision runs, or the queue is paused, it queues and runs after, one at a time. Answers with its chat entry.
     */
    send: oc
      .errors({ UNKNOWN_PROJECT, FILE_FAILED: PROJECT_ERRORS.FILE_FAILED })
      .input(VideoRefSchema.extend(RevisionRequestSchema.shape))
      .output(ChatEntrySchema),
    /** Streams the video's chat, from its saved log, now and after every change. */
    chat: oc.errors({ UNKNOWN_PROJECT, FILE_FAILED: PROJECT_ERRORS.FILE_FAILED }).input(VideoRefSchema).output(eventIterator(ChatStatusSchema)),
    /** Runs the paused queue: its first request starts once the video is idle. */
    resumeQueue: oc.errors({ UNKNOWN_PROJECT, FILE_FAILED: PROJECT_ERRORS.FILE_FAILED }).input(VideoRefSchema),
    /** The video's Versions, newest first. */
    versions: oc
      .errors({ UNKNOWN_PROJECT, FILE_FAILED: PROJECT_ERRORS.FILE_FAILED, INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) } })
      .input(VideoRefSchema)
      .output(z.array(VersionSummarySchema)),
    /**
     * Restores an earlier Version by saving a copy of it as the newest Version, so nothing is lost; its units are
     * shared, not copied. The Transcript, word fixes and all, stays as it is; Captions show as they did in that
     * Version. Answers with the new Version's number.
     */
    restore: oc
      .errors({
        UNKNOWN_PROJECT,
        FILE_FAILED: PROJECT_ERRORS.FILE_FAILED,
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        UNKNOWN_VERSION: { data: z.object({ version: z.number() }) },
        /** A generation, Retry or Revision is running; restore once it ends. */
        BUSY: { data: z.object({ projectId: z.string() }) },
      })
      .input(VideoRefSchema.extend({ version: z.number().int().positive() }))
      .output(z.object({ version: z.number().int().positive() })),
    /**
     * Opens the video of a Format for the player: its newest Version with the Project's current Transcript, word
     * fixes and all, and the video's Captions choice. A Format without a video yet answers with no Version, for its
     * Generate empty state. After an app update that changed the frame's major version, its units are first checked
     * again (lint, check and the contract; no agent). Units that fail become flagged fallbacks in a new Version, and
     * nothing is regenerated until the creator asks.
     */
    open: oc
      .errors({
        UNKNOWN_PROJECT,
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        /** A Version or unit file in the Project can't be read as one. */
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        INVALID_STORYBOARD: { data: z.object({ issues: z.array(StoryboardIssueSchema) }) },
        UNKNOWN_UNIT: { data: z.object({ unit: z.string(), units: z.array(z.string()) }) },
        VOICEOVER_MISSING: { data: z.object({ path: z.string() }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(VideoRefSchema)
      .output(OpenedVideoSchema),
    /**
     * Stops the video's run and resolves once it has ended. Finished units are kept and unfinished ones become flagged
     * fallbacks in a saved Version; before the Storyboard is valid nothing is saved. Nothing running: nothing happens.
     */
    stop: oc.errors({ UNKNOWN_PROJECT }).input(VideoRefSchema),
    /**
     * Regenerates flagged units of the newest Version, `units` or every flagged fallback, with the Scene-code model,
     * checked, reviewed and retried like a first generation. Starts and returns at once; progress streams through
     * `generation`. Units that now pass make a new Version. Only ever starts when the creator asks.
     */
    retry: oc
      .errors({
        UNKNOWN_PROJECT,
        TRANSCRIPT_NOT_READY: { data: z.object({ projectId: z.string() }) },
        /** The video has no Version yet. */
        NO_VIDEO: { data: z.object({ format: FormatSchema }) },
        INVALID_VERSION: { data: z.object({ path: z.string(), message: z.string() }) },
        GENERATING: { data: z.object({ projectId: z.string() }) },
        /** The newest Version doesn't flag these units, or flags no fallback, so there is nothing to retry. */
        NOT_FLAGGED: { data: z.object({ units: z.array(z.string()) }) },
        FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) },
      })
      .input(VideoRefSchema.extend({ units: z.array(z.string()).optional() })),
  },
  usage: {
    /**
     * Streams what runs are using now and after every change: the video's latest run per model role, its stored
     * totals and today's, live while agents run in parallel. Plan windows on a subscription, which shows no dollars.
     */
    watch: oc.errors({ UNKNOWN_PROJECT }).input(z.object({ video: VideoRefSchema.optional() })).output(eventIterator(UsageStatusSchema)),
  },
  settings: {
    get: oc.output(SettingsSchema),
    /** Saves the changes; models apply from the next run. */
    update: oc
      .errors({ FILE_FAILED: { data: z.object({ path: z.string(), message: z.string() }) } })
      .input(SettingsChangesSchema)
      .output(SettingsSchema),
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
export type PaletteRole = z.infer<typeof PaletteRoleSchema>;
export type AccentRole = z.infer<typeof AccentRoleSchema>;
export type Palette = z.infer<typeof PaletteSchema>;
export type ContrastFinding = z.infer<typeof ContrastFindingSchema>;
export type BundledFont = z.infer<typeof BundledFontSchema>;
export type FontFamily = z.infer<typeof FontFamilySchema>;
export type Face = z.infer<typeof FaceSchema>;
export type Typography = z.infer<typeof TypographySchema>;
export type Treatments = z.infer<typeof TreatmentsSchema>;
export type Motion = z.infer<typeof MotionSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type StylePreset = z.infer<typeof StylePresetSchema>;
export type ListedPreset = z.infer<typeof ListedPresetSchema>;
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
export type VideoRef = z.infer<typeof VideoRefSchema>;
export type ExportError = z.infer<typeof ExportErrorSchema>;
export type ExportStatus = z.infer<typeof ExportStatusSchema>;
export type ExportStage = z.infer<typeof ExportStageSchema>;
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
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type OpenedProject = z.infer<typeof OpenedProjectSchema>;
export type TranscriptionError = z.infer<typeof TranscriptionErrorSchema>;
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;
export type CacheStatus = z.infer<typeof CacheStatusSchema>;
export type UnitWork = z.infer<typeof UnitWorkSchema>;
export type GenerationEstimate = z.infer<typeof GenerationEstimateSchema>;
export type CostRange = z.infer<typeof CostRangeSchema>;
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type RoleModels = z.infer<typeof RoleModelsSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsChanges = z.infer<typeof SettingsChangesSchema>;
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;
export type RoleUsage = z.infer<typeof RoleUsageSchema>;
export type PlanWindow = z.infer<typeof PlanWindowSchema>;
export type UsageStatus = z.infer<typeof UsageStatusSchema>;
export type GenerationError = z.infer<typeof GenerationErrorSchema>;
export type GenerationUnit = z.infer<typeof GenerationUnitSchema>;
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;
export type GenerationStop = z.infer<typeof GenerationStopSchema>;
export type GenerationPreviewError = z.infer<typeof GenerationPreviewErrorSchema>;
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
export type WordFixOffer = z.infer<typeof WordFixOfferSchema>;
export type RevisionError = z.infer<typeof RevisionErrorSchema>;
export type RevisionUnit = z.infer<typeof RevisionUnitSchema>;
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;
export type FrameUpdate = z.infer<typeof FrameUpdateSchema>;
export type OpenedVideo = z.infer<typeof OpenedVideoSchema>;
export type VersionOrigin = z.infer<typeof VersionOriginSchema>;
export type StyleChangeKind = z.infer<typeof StyleChangeKindSchema>;
export type StyleChanged = z.infer<typeof StyleChangedSchema>;
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
export type ChatRequestState = z.infer<typeof ChatRequestStateSchema>;
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
export type ChatStatus = z.infer<typeof ChatStatusSchema>;
