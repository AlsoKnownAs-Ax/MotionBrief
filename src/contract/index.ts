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

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a six-digit hex color, such as #ff7a3d");

/** The colors of a Style Preset, light or dark; a Preset holds its own copy, never a link to a bundled Palette. */
export const PaletteSchema = z.object({
  name: z.string().trim().min(1).max(40),
  mode: z.enum(["light", "dark"]),
  colors: z.record(PaletteRoleSchema, HexColorSchema),
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
    /** The Style Presets to choose from, Blueprint first. The four bundled ones are read-only. */
    presets: oc.output(z.array(ListedPresetSchema)),
    /** The bundled Palettes a Preset copies its colors from. */
    palettes: oc.output(z.array(PaletteSchema)),
    /** The bundled OFL font pairings a Preset copies its typography from. */
    typography: oc.output(z.array(TypographySchema)),
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
export type PaletteRole = z.infer<typeof PaletteRoleSchema>;
export type Palette = z.infer<typeof PaletteSchema>;
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
export type AuthMethod = z.infer<typeof AuthMethodSchema>;
export type ConnectorError = z.infer<typeof ConnectorErrorSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type SetupError = z.infer<typeof SetupErrorSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
export type TranscriptionModelError = z.infer<typeof TranscriptionModelErrorSchema>;
export type TranscriptionModelStatus = z.infer<typeof TranscriptionModelStatusSchema>;
