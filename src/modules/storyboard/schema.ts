import { z } from "zod";
import { FormatSchema } from "../../contract";

/**
 * The Storyboard the agent writes (ADR 0003): Scenes with a Transcript span, a Scene Type, content
 * in that type's shape with element ids, word anchors, the Transition into the next Scene and the
 * Canvas grouping. No layout, no motion: every object is strict, so a field outside this shape is
 * rejected rather than dropped. Every word reference is an index into the Transcript's words,
 * never seconds.
 *
 * Copy and item limits keep each Scene legible in either Format; they come from the spike.
 */

const wordIndex = z
  .number()
  .int("use the index of a Transcript word, never seconds")
  .nonnegative("use the index of a Transcript word, never seconds");

const elementId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "use a kebab-case element id, such as load-balancer")
  .describe("element id, unique within the Scene; kebab-case");

/** No hyphen, so the DOM id `<sceneId>-<elementId>` splits one way only. */
const groupId = (example: string) =>
  z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, `use letters, digits and underscores only, such as ${example}`);

const anchor = wordIndex.describe("index of the Transcript word this element appears on (the word that names it)");

const text = (max: number) => z.string().trim().min(1).max(max);

/** The frame inlines icons from two bundled sets whose names overlap, so the set is part of the name. */
const icon = z
  .string()
  .regex(/^(lucide|brand):[a-z0-9-]+$/, 'use "lucide:<name>" or "brand:<simple-icons slug>"')
  .describe('"lucide:<name>" (lucide:server) or "brand:<simple-icons slug>" (brand:cloudflare)');

/** One piece of on-screen copy that appears on a word. */
const element = (max: number) => z.strictObject({ id: elementId, text: text(max), at: anchor });

const edge = z.strictObject({ id: elementId, from: elementId, to: elementId, label: text(24).optional(), at: anchor });

const hook = z.strictObject({
  headline: element(60),
  kicker: element(60).optional(),
  source: element(80).optional().describe("optional quoted source card"),
});

const keyTerm = z.strictObject({
  term: element(40),
  definition: element(90).optional(),
  related: z.array(element(30)).max(3).optional(),
});

const architectureDiagram = z.strictObject({
  title: element(50).optional(),
  nodes: z
    .array(z.strictObject({ id: elementId, label: text(24), icon: icon.optional(), at: anchor, group: text(24).optional() }))
    .min(2)
    .max(9),
  edges: z.array(edge).max(12),
});

const flow = z.strictObject({
  title: element(50).optional(),
  steps: z.array(z.strictObject({ id: elementId, label: text(24), icon: icon.optional(), at: anchor })).min(2).max(7),
  edges: z.array(edge).max(10),
  packets: z
    .array(z.strictObject({ id: elementId, label: text(16), path: z.array(elementId).min(2), at: anchor }))
    .max(3)
    .describe("things travelling along the edges, such as a request"),
});

const code = z.strictObject({
  filename: text(40).optional(),
  language: text(20).describe("the code's language, such as ts, python or bash"),
  mode: z.enum(["editor", "terminal"]),
  blocks: z
    .array(z.strictObject({ id: elementId, lines: z.array(z.string().max(70)).min(1), at: anchor }))
    .min(1)
    .describe("the code in order, in blocks that each appear on a word; at most 14 lines in all"),
  highlights: z
    .array(
      z.strictObject({
        id: elementId,
        lines: z.array(z.number().int().min(1)).min(1).describe("line numbers, counted from 1 across all blocks"),
        note: text(40).optional(),
        at: anchor,
      }),
    )
    .max(4),
});

const comparisonSide = z.strictObject({ id: elementId, title: text(24), at: anchor, items: z.array(element(40)).max(4) });

const comparison = z.strictObject({ left: comparisonSide, right: comparisonSide, verdict: element(50).optional() });

const list = z.strictObject({
  title: element(50).optional(),
  items: z.array(z.strictObject({ id: elementId, text: text(40), icon: icon.optional(), at: anchor })).min(2).max(6),
});

const statChart = z.strictObject({
  kind: z.enum(["number", "bars"]),
  number: z
    .strictObject({
      id: elementId,
      value: z.number(),
      prefix: z.string().max(3).optional(),
      unit: z.string().max(12).optional(),
      label: text(40),
      at: anchor,
    })
    .optional(),
  bars: z
    .array(z.strictObject({ id: elementId, label: text(20), value: z.number(), unit: z.string().max(8).optional(), at: anchor }))
    .max(5)
    .optional(),
  caption: element(60).optional(),
});

const outro = z.strictObject({ headline: element(50), cta: element(40).optional() });

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

/** A carry-over names the element it morphs, so the Assembler never has to choose one. */
const TransitionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: TransitionTypeSchema.exclude(["carry-over"]) }),
  z.strictObject({
    type: z.literal("carry-over"),
    element: elementId.describe("id of the element that morphs from this Scene into the next; both Scenes have it"),
  }),
]);

const sceneBase = {
  id: groupId("s01").describe("Scene id, unique in the Storyboard"),
  from: wordIndex.describe("index of the Scene's first Transcript word"),
  to: wordIndex.describe("index of the Scene's last Transcript word (inclusive)"),
  canvas: groupId("c1").optional().describe("Canvas id; a run of consecutive Scenes with the same id shares one Canvas"),
  transition: TransitionSchema.optional().describe(
    'the Transition into the next Scene; every Scene but the last has one; "camera" only between Scenes on the same Canvas',
  ),
};

/** The 9 Scene Types, each with its own content shape. There is no "custom" type: gaps are fixed by adding a Scene Type. */
export const SceneSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...sceneBase, type: z.literal("hook"), content: hook }),
  z.strictObject({ ...sceneBase, type: z.literal("key-term"), content: keyTerm }),
  z.strictObject({ ...sceneBase, type: z.literal("architecture-diagram"), content: architectureDiagram }),
  z.strictObject({ ...sceneBase, type: z.literal("flow"), content: flow }),
  z.strictObject({ ...sceneBase, type: z.literal("code"), content: code }),
  z.strictObject({ ...sceneBase, type: z.literal("comparison"), content: comparison }),
  z.strictObject({ ...sceneBase, type: z.literal("list"), content: list }),
  z.strictObject({ ...sceneBase, type: z.literal("stat-chart"), content: statChart }),
  z.strictObject({ ...sceneBase, type: z.literal("outro"), content: outro }),
]);

export const StoryboardSchema = z.strictObject({
  format: FormatSchema.describe("the Format this Storyboard is for; a Storyboard is specific to one Format"),
  scenes: z.array(SceneSchema).min(1),
});

export type Storyboard = z.infer<typeof StoryboardSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneType = Scene["type"];
export type Transition = z.infer<typeof TransitionSchema>;
export type TransitionType = z.infer<typeof TransitionTypeSchema>;
