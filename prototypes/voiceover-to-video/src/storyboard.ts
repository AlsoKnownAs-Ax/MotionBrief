// PROTOTYPE: draft Storyboard contract (ADR 0003) — one content shape per Scene Type, anchors are word indices.
import { z } from "zod";
import type { Transcript } from "./transcribe.ts";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,30}$/).describe("element id, unique within the Scene; kebab-case");
const at = z.number().int().describe("Transcript word index this element appears on (the word that names it)");
const text = (max: number) => z.string().min(1).max(max);
const icon = z
  .string()
  .regex(/^(lucide|brand):[a-z0-9-]+$/)
  .describe('icon name: "lucide:<name>" (e.g. lucide:server) or "brand:<simple-icons slug>" (e.g. brand:cloudflare)');
const el = (max: number) => z.object({ id, text: text(max), at });

export const SCENE_TYPES = ["hook", "key-term", "architecture", "flow", "code", "comparison", "list", "stat", "outro"] as const;

const content = {
  hook: z.object({ headline: el(60), kicker: el(60).optional(), source: el(80).optional().describe("optional quoted source card") }),
  "key-term": z.object({ term: el(40), definition: el(90).optional(), related: z.array(el(30)).max(3).optional() }),
  architecture: z.object({
    title: el(50).optional(),
    nodes: z.array(z.object({ id, label: text(24), icon: icon.optional(), at, group: z.string().optional() })).min(2).max(9),
    edges: z.array(z.object({ id, from: z.string(), to: z.string(), label: text(24).optional(), at })).max(12),
  }),
  flow: z.object({
    title: el(50).optional(),
    steps: z.array(z.object({ id, label: text(24), icon: icon.optional(), at })).min(2).max(7),
    edges: z.array(z.object({ id, from: z.string(), to: z.string(), label: text(24).optional(), at })).max(10),
    packets: z.array(z.object({ id, label: text(16), path: z.array(z.string()).min(2), at })).max(3).describe("things travelling along edges, e.g. a request"),
  }),
  code: z.object({
    filename: text(40).optional(),
    language: z.enum(["http", "js", "ts", "python", "bash", "json", "yaml", "go", "rust", "sql", "text"]),
    mode: z.enum(["editor", "terminal"]),
    lines: z.array(z.string().max(70)).min(1).max(14),
    reveal: z.enum(["typing", "static"]),
    highlights: z.array(z.object({ id, lines: z.array(z.number().int().min(1)).min(1), note: text(40).optional(), at })).max(4),
  }),
  comparison: z.object({
    left: z.object({ id, title: text(24), at, items: z.array(el(40)).max(4) }),
    right: z.object({ id, title: text(24), at, items: z.array(el(40)).max(4) }),
    verdict: el(50).optional(),
  }),
  list: z.object({ title: el(50).optional(), items: z.array(z.object({ id, text: text(40), icon: icon.optional(), at })).min(2).max(6) }),
  stat: z.object({
    kind: z.enum(["number", "bars"]),
    number: z.object({ id, value: z.number(), prefix: z.string().max(3).optional(), unit: z.string().max(12).optional(), label: text(40), at }).optional(),
    bars: z.array(z.object({ id, label: text(20), value: z.number(), unit: z.string().max(8).optional(), at })).max(5).optional(),
    caption: el(60).optional(),
  }),
  outro: z.object({ headline: el(50), cta: el(40).optional() }),
} as const;

export const TRANSITIONS = ["cut", "crossfade", "push-left", "push-right", "push-up", "push-down", "zoom-through", "camera"] as const;

const sceneBase = {
  id: z.string().regex(/^s\d{2}$/).describe("s01, s02, ..."),
  from: z.number().int().describe("first Transcript word index of the Scene (inclusive)"),
  to: z.number().int().describe("last Transcript word index of the Scene (inclusive)"),
  canvas: z.string().regex(/^c\d$/).optional().describe("Canvas group id; consecutive Scenes with the same id share one Canvas"),
  transitionIn: z.enum(TRANSITIONS).describe('Transition from the previous Scene into this one; "camera" only between Scenes on the same Canvas; the first Scene uses "cut"'),
  intent: z.string().max(160).describe("one line of visual intent for the Scene code author (design direction, not narration)"),
};

export const SceneSchema = z.discriminatedUnion(
  "type",
  SCENE_TYPES.map((t) => z.object({ ...sceneBase, type: z.literal(t), content: content[t] })) as never,
);
export const StoryboardSchema = z.object({
  title: z.string().max(80),
  transitionSet: z.array(z.enum(TRANSITIONS)).min(1).max(4).describe("the small, consistent subset of Transitions this video uses"),
  scenes: z.array(SceneSchema).min(2),
});

export type Scene = { id: string; type: (typeof SCENE_TYPES)[number]; from: number; to: number; canvas?: string; transitionIn: (typeof TRANSITIONS)[number]; intent: string; content: any };
export type Storyboard = { title: string; transitionSet: string[]; scenes: Scene[] };

export const storyboardJsonSchema = () => z.toJSONSchema(StoryboardSchema, { target: "draft-7" }) as Record<string, unknown>;

// Every element with an anchor: [elementId, wordIndex]
export function anchorsOf(scene: Scene): [string, number][] {
  const out: [string, number][] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.at === "number") out.push([o.id, o.at]);
      Object.values(o).forEach(walk);
    }
  };
  walk(scene.content);
  return out;
}

export type Pacing = { minScene: number; maxScene: number };

// Semantic checks the JSON schema can't express. Returns human-readable errors for the agent.
export function validateStoryboard(raw: unknown, t: Transcript, pacing: Pacing): { sb?: Storyboard; errors: string[]; warnings: string[] } {
  const parsed = StoryboardSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [] };
  const sb = parsed.data as unknown as Storyboard;
  const errors: string[] = [];
  const warnings: string[] = [];
  const W = t.words;
  const last = W.length - 1;
  const boundaryOk = (i: number) => i === last || !!W[i].end;

  sb.scenes.forEach((s, k) => {
    const prev = sb.scenes[k - 1];
    if (s.id !== `s${String(k + 1).padStart(2, "0")}`) errors.push(`${s.id}: scene ids must be s01, s02, ... in order`);
    if (k === 0 && s.from !== 0) errors.push(`${s.id}: first Scene must start at word 0`);
    if (prev && s.from !== prev.to + 1) errors.push(`${s.id}: must start at word ${prev.to + 1} (right after ${prev.id}), got ${s.from}`);
    if (s.to < s.from) errors.push(`${s.id}: to < from`);
    if (!boundaryOk(s.to)) errors.push(`${s.id}: ends at word ${s.to} "${W[s.to]?.w}", which is not a sentence or clause end`);
    const start = W[s.from]?.s ?? 0;
    const end = s.to === last ? t.duration : (W[s.to + 1]?.s ?? t.duration);
    const len = end - start;
    if (len < pacing.minScene) warnings.push(`${s.id}: ${len.toFixed(1)}s is shorter than ${pacing.minScene}s`);
    if (len > pacing.maxScene) errors.push(`${s.id}: ${len.toFixed(1)}s is longer than ${pacing.maxScene}s; split it`);
    if (k === 0 && s.transitionIn !== "cut") errors.push(`${s.id}: first Scene must use "cut"`);
    if (s.transitionIn === "camera" && (!s.canvas || prev?.canvas !== s.canvas)) errors.push(`${s.id}: "camera" needs the same canvas as the previous Scene`);
    if (prev && s.canvas && prev.canvas === s.canvas && s.transitionIn !== "camera") errors.push(`${s.id}: Scenes on the same Canvas must use "camera"`);
    if (s.canvas && sb.scenes.some((o, j) => o.canvas === s.canvas && Math.abs(j - k) > 1 && !sb.scenes.slice(Math.min(j, k), Math.max(j, k)).every((m) => m.canvas === s.canvas)))
      errors.push(`${s.id}: Canvas ${s.canvas} must be a run of consecutive Scenes`);
    if (!sb.transitionSet.includes(s.transitionIn)) errors.push(`${s.id}: transition "${s.transitionIn}" is not in transitionSet`);

    const seen = new Set<string>();
    for (const [eid, a] of anchorsOf(s)) {
      if (seen.has(eid)) errors.push(`${s.id}: duplicate element id "${eid}"`);
      seen.add(eid);
      if (a < s.from || a > s.to) errors.push(`${s.id}.${eid}: anchor ${a} is outside the Scene's words ${s.from}-${s.to}`);
    }
    const c = s.content;
    if (s.type === "architecture" || s.type === "flow") {
      const nodes = new Set((s.type === "flow" ? c.steps : c.nodes).map((n: { id: string }) => n.id));
      for (const e of c.edges) if (!nodes.has(e.from) || !nodes.has(e.to)) errors.push(`${s.id}.${e.id}: edge references an unknown node`);
      for (const p of c.packets ?? []) for (const n of p.path) if (!nodes.has(n)) errors.push(`${s.id}.${p.id}: packet path references unknown step "${n}"`);
    }
    if (s.type === "stat" && ((c.kind === "number" && !c.number) || (c.kind === "bars" && !c.bars?.length))) errors.push(`${s.id}: stat kind "${c.kind}" needs its data`);
    if (s.type === "code") for (const h of c.highlights) if (h.lines.some((n: number) => n > c.lines.length)) errors.push(`${s.id}.${h.id}: highlight line out of range`);
  });
  const lastScene = sb.scenes[sb.scenes.length - 1];
  if (lastScene && lastScene.to !== last) errors.push(`last Scene must end at the last word (${last}), got ${lastScene.to}`);
  return { sb: errors.length ? undefined : sb, errors, warnings };
}

// Absolute timing derived by our code, never by the agent.
export type SceneTiming = { id: string; start: number; end: number; anchors: Record<string, number> };
export function sceneTimings(sb: Storyboard, t: Transcript, lead: number): SceneTiming[] {
  return sb.scenes.map((s, k) => {
    const start = k === 0 ? 0 : Math.max(t.words[s.from].s - lead, t.words[sb.scenes[k - 1].to].s + 0.2);
    const next = sb.scenes[k + 1];
    const end = next ? Math.max(t.words[next.from].s - lead, t.words[s.to].s + 0.2) : t.duration + 0.6;
    const anchors: Record<string, number> = {};
    for (const [eid, a] of anchorsOf(s)) anchors[eid] = Math.max(0, +(t.words[a].s - start).toFixed(3));
    return { id: s.id, start: +start.toFixed(3), end: +end.toFixed(3), anchors };
  });
}
