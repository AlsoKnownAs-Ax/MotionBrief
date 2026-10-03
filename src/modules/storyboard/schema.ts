import { z } from "zod";
import { FormatSchema } from "../../contract";

/**
 * The Storyboard the agent writes (ADR 0003): Scenes with a Transcript span, a Scene Type, content
 * in that type's shape with element ids, word anchors, the Transition into the next Scene and the
 * Canvas grouping. No layout, no motion. Every word reference is an index into the Transcript's
 * words, never seconds.
 */

const wordIndex = z
  .number()
  .int("use the index of a Transcript word, never seconds")
  .nonnegative("use the index of a Transcript word, never seconds");

const elementId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,30}$/, "use a kebab-case element id, such as load-balancer")
  .describe("element id, unique within the Scene; kebab-case");

const anchor = wordIndex.describe("index of the Transcript word this element appears on (the word that names it)");

const text = (max: number) => z.string().trim().min(1).max(max);

const icon = z
  .string()
  .regex(/^(lucide|brand):[a-z0-9-]+$/, 'use "lucide:<name>" or "brand:<simple-icons slug>"')
  .describe('"lucide:<name>" (lucide:server) or "brand:<simple-icons slug>" (brand:cloudflare)');

/** One piece of on-screen copy that appears on a word. */
const element = (max: number) => z.object({ id: elementId, text: text(max), at: anchor });

const edge = z.object({ id: elementId, from: elementId, to: elementId, label: text(24).optional(), at: anchor });

const hook = z.object({
  headline: element(60),
  kicker: element(60).optional(),
  source: element(80).optional().describe("optional quoted source card"),
});

const keyTerm = z.object({
  term: element(40),
  definition: element(90).optional(),
  related: z.array(element(30)).max(3).optional(),
});

const architectureDiagram = z.object({
  title: element(50).optional(),
  nodes: z
    .array(z.object({ id: elementId, label: text(24), icon: icon.optional(), at: anchor, group: text(24).optional() }))
    .min(2)
    .max(9),
  edges: z.array(edge).max(12),
});

const flow = z.object({
  title: element(50).optional(),
  steps: z.array(z.object({ id: elementId, label: text(24), icon: icon.optional(), at: anchor })).min(2).max(7),
  edges: z.array(edge).max(10),
  packets: z
    .array(z.object({ id: elementId, label: text(16), path: z.array(elementId).min(2), at: anchor }))
    .max(3)
    .describe("things travelling along the edges, such as a request"),
});

const code = z.object({
  filename: text(40).optional(),
  language: z.enum(["http", "js", "ts", "python", "bash", "json", "yaml", "go", "rust", "sql", "text"]),
  mode: z.enum(["editor", "terminal"]),
  lines: z.array(z.string().max(70)).min(1).max(14),
  reveal: z.enum(["typing", "static"]),
  highlights: z
    .array(z.object({ id: elementId, lines: z.array(z.number().int().min(1)).min(1), note: text(40).optional(), at: anchor }))
    .max(4),
});

const comparisonSide = z.object({ id: elementId, title: text(24), at: anchor, items: z.array(element(40)).max(4) });

const comparison = z.object({ left: comparisonSide, right: comparisonSide, verdict: element(50).optional() });

const list = z.object({
  title: element(50).optional(),
  items: z.array(z.object({ id: elementId, text: text(40), icon: icon.optional(), at: anchor })).min(2).max(6),
});

const statChart = z.object({
  kind: z.enum(["number", "bars"]),
  number: z
    .object({
      id: elementId,
      value: z.number(),
      prefix: z.string().max(3).optional(),
      unit: z.string().max(12).optional(),
      label: text(40),
      at: anchor,
    })
    .optional(),
  bars: z
    .array(z.object({ id: elementId, label: text(20), value: z.number(), unit: z.string().max(8).optional(), at: anchor }))
    .max(5)
    .optional(),
  caption: element(60).optional(),
});

const outro = z.object({ headline: element(50), cta: element(40).optional() });

export const TransitionSchema = z.enum([
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

const sceneBase = {
  id: z.string().regex(/^s\d{2,3}$/, "use a Scene id such as s01").describe("Scene id, unique in the Storyboard: s01, s02, ..."),
  from: wordIndex.describe("index of the Scene's first Transcript word"),
  to: wordIndex.describe("index of the Scene's last Transcript word (inclusive)"),
  canvas: z
    .string()
    .regex(/^c\d{1,2}$/, "use a Canvas id such as c1")
    .optional()
    .describe("Canvas id; a run of consecutive Scenes with the same id shares one Canvas"),
  transition: TransitionSchema.optional().describe(
    'the Transition into the next Scene; every Scene but the last has one; "camera" only between Scenes on the same Canvas',
  ),
};

/** The 9 Scene Types. There is no "custom" type: gaps are fixed by adding a Scene Type. */
export const SceneSchema = z.discriminatedUnion("type", [
  z.object({ ...sceneBase, type: z.literal("hook"), content: hook }),
  z.object({ ...sceneBase, type: z.literal("key-term"), content: keyTerm }),
  z.object({ ...sceneBase, type: z.literal("architecture-diagram"), content: architectureDiagram }),
  z.object({ ...sceneBase, type: z.literal("flow"), content: flow }),
  z.object({ ...sceneBase, type: z.literal("code"), content: code }),
  z.object({ ...sceneBase, type: z.literal("comparison"), content: comparison }),
  z.object({ ...sceneBase, type: z.literal("list"), content: list }),
  z.object({ ...sceneBase, type: z.literal("stat-chart"), content: statChart }),
  z.object({ ...sceneBase, type: z.literal("outro"), content: outro }),
]);

export const StoryboardSchema = z.object({
  format: FormatSchema.describe("the Format this Storyboard is for; a Storyboard is specific to one Format"),
  scenes: z.array(SceneSchema).min(1),
});

export type Storyboard = z.infer<typeof StoryboardSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneType = Scene["type"];
export type Transition = z.infer<typeof TransitionSchema>;
