import type { Format, PresetTransition, StoryboardIssue, StoryboardRules, StoryboardTranscript } from "../../contract";
import { copyOf, elementsOf } from "./content";
import type { Scene, SceneType, Storyboard, Transition } from "./schema";

/** What every check sees: a Storyboard that already fits the schema, and what it is checked against. */
type CheckInput = {
  storyboard: Storyboard;
  transcript: StoryboardTranscript;
  rules: StoryboardRules;
};

type Check = (input: CheckInput) => StoryboardIssue[];

function checkFormat({ storyboard, rules }: CheckInput): StoryboardIssue[] {
  if (storyboard.format === rules.format) {
    return [];
  }

  return [
    {
      code: "FORMAT",
      field: "format",
      message: `This video is ${rules.format}, but the Storyboard is for ${storyboard.format}. A Storyboard is specific to one Format.`,
    },
  ];
}

/** A rule that applies to one Scene: when it is broken, it becomes an issue on that Scene's field. */
type SceneRule = { broken: boolean; code: StoryboardIssue["code"]; field: string; message: string };

function issuesFor(sceneId: string, rules: SceneRule[]): StoryboardIssue[] {
  return rules.filter((rule) => rule.broken).map(({ code, field, message }) => ({ code, sceneId, field, message }));
}

/** Scene ids are unique, so element DOM ids `<sceneId>-<elementId>` never collide across the page. */
function checkSceneIds({ storyboard }: CheckInput): StoryboardIssue[] {
  return storyboard.scenes.flatMap((scene, index, scenes) =>
    issuesFor(scene.id, [
      {
        broken: scenes.findIndex(({ id }) => id === scene.id) < index,
        code: "DUPLICATE_ID",
        field: "id",
        message: `Another Scene already has the id "${scene.id}"; Scene ids are unique.`,
      },
    ]),
  );
}

/** Spans tile the Transcript: no gaps, no overlaps, from its first word to its last. */
function checkSpans({ storyboard, transcript }: CheckInput): StoryboardIssue[] {
  const lastWord = transcript.words.length - 1;

  return storyboard.scenes.flatMap((scene, index) => {
    const previous = storyboard.scenes[index - 1];
    const isLast = index === storyboard.scenes.length - 1;
    const expectedFrom = (previous?.to ?? -1) + 1;

    return issuesFor(scene.id, [
      {
        broken: scene.from !== expectedFrom,
        code: "SPAN",
        field: "from",
        message: `Starts at word ${scene.from}, but must start at word ${expectedFrom}${rightAfter(previous)}: Scenes cover the Transcript with no gaps or overlaps.`,
      },
      {
        broken: scene.to < scene.from,
        code: "SPAN",
        field: "to",
        message: `Ends at word ${scene.to}, before its first word ${scene.from}.`,
      },
      {
        broken: isLast && scene.to !== lastWord,
        code: "SPAN",
        field: "to",
        message: `The last Scene must end at the Transcript's last word, ${lastWord}; it ends at word ${scene.to}.`,
      },
      {
        broken: !isLast && scene.to > lastWord,
        code: "SPAN",
        field: "to",
        message: `Ends at word ${scene.to}, past the Transcript's last word, ${lastWord}.`,
      },
    ]);
  });
}

function rightAfter(previous: Scene | undefined): string {
  if (!previous) {
    return "";
  }

  return `, right after ${previous.id} ends`;
}

/** Ends a sentence or clause: . ? ! , ; : … or a dash, optionally followed by closing quotes or brackets. */
const BOUNDARY = /[.?!,;:…—–-]["'”’)\]]*$/;

/** Scenes break only at sentence or clause ends, so no Scene starts mid-thought. */
function checkBoundaries({ storyboard, transcript }: CheckInput): StoryboardIssue[] {
  const lastWord = transcript.words.length - 1;

  return storyboard.scenes
    .filter((scene) => scene.to < lastWord)
    .flatMap((scene) => {
      const word = transcript.words[scene.to]?.text ?? "";

      return issuesFor(scene.id, [
        {
          broken: !BOUNDARY.test(word),
          code: "BOUNDARY",
          field: "to",
          message: `Ends at word ${scene.to} "${word}", which doesn't end a sentence or clause. Break Scenes only after words ending in . ? ! , ; : or a dash.`,
        },
      ]);
    });
}

/** How long a Scene may last in each Format, in seconds. */
const PACING = {
  horizontal: { min: 3, max: 10 },
  vertical: { min: 2.5, max: 7 },
} satisfies Record<Format, { min: number; max: number }>;

/** A Scene starts this long before its first word is spoken. */
const SCENE_LEAD_SECONDS = 0.25;

/** When each Scene starts and ends on the Voiceover, in seconds. Assumes the spans are valid. */
function sceneTimes({ storyboard, transcript }: CheckInput) {
  const starts = storyboard.scenes.map((scene, index) => sceneStart(scene, index, transcript));

  return storyboard.scenes.map((scene, index) => ({
    scene,
    start: starts[index] ?? 0,
    end: starts[index + 1] ?? transcript.duration,
  }));
}

function sceneStart(scene: Scene, index: number, transcript: StoryboardTranscript): number {
  if (index === 0) {
    return 0;
  }

  return Math.max(0, (transcript.words[scene.from]?.start ?? 0) - SCENE_LEAD_SECONDS);
}

/** Each Scene lasts as long as its Format's pacing allows. A lone Scene may be as short as its Voiceover. */
function checkPacing(input: CheckInput): StoryboardIssue[] {
  if (checkSpans(input).length > 0) {
    return [];
  }

  const { min, max } = PACING[input.rules.format];
  const isLone = input.storyboard.scenes.length === 1;

  return sceneTimes(input).flatMap(({ scene, start, end }) => {
    const seconds = Math.round((end - start) * 1000) / 1000;

    return issuesFor(scene.id, [
      {
        broken: seconds > max,
        code: "PACING",
        field: "to",
        message: `Lasts ${seconds} s; ${input.rules.format} Scenes last ${min}–${max} s. Split it at a sentence or clause end.`,
      },
      {
        broken: seconds < min && !isLone,
        code: "PACING",
        field: "to",
        message: `Lasts ${seconds} s; ${input.rules.format} Scenes last ${min}–${max} s. Merge it with a neighbouring Scene.`,
      },
    ]);
  });
}

/**
 * Every element appears on a word of its own Scene, and its id is unique within the Scene, so its
 * DOM id `<sceneId>-<elementId>` is unique across the assembled page.
 */
function checkElements({ storyboard }: CheckInput): StoryboardIssue[] {
  return storyboard.scenes.flatMap((scene) =>
    issuesFor(
      scene.id,
      elementsOf(scene).flatMap((element, index, elements) => [
        {
          broken: element.at < scene.from || element.at > scene.to,
          code: "ANCHOR",
          field: `${element.field}.at`,
          message: `"${element.id}" appears on word ${element.at}, outside the Scene's words ${scene.from}–${scene.to}. Anchor it on the word that names it.`,
        },
        {
          broken: elements.findIndex(({ id }) => id === element.id) < index,
          code: "DUPLICATE_ID",
          field: `${element.field}.id`,
          message: `Another element in this Scene already has the id "${element.id}"; element ids are unique within a Scene.`,
        },
      ]),
    ),
  );
}

/** Rules that depend on a Scene Type's content shape. */
const CONTENT_RULES = {
  hook: () => [],
  "key-term": () => [],
  "architecture-diagram": ({ nodes, edges }) => edgeRules(new Set(nodes.map(({ id }) => id)), edges, "node"),
  flow: ({ steps, edges, packets }) => {
    const stepIds = new Set(steps.map(({ id }) => id));
    const packetRules = packets.flatMap((packet, index) =>
      packet.path.map((stepId, stop) => ({
        broken: !stepIds.has(stepId),
        code: "REFERENCE" as const,
        field: `content.packets[${index}].path[${stop}]`,
        message: `Packet "${packet.id}" travels through "${stepId}", which isn't a step of this flow.`,
      })),
    );

    return [...edgeRules(stepIds, edges, "step"), ...packetRules];
  },
  code: ({ lines, highlights }) =>
    highlights.flatMap((highlight, index) =>
      highlight.lines.map((line, position) => ({
        broken: line > lines.length,
        code: "CONTENT" as const,
        field: `content.highlights[${index}].lines[${position}]`,
        message: `Highlight "${highlight.id}" marks line ${line}, but the code has ${lines.length} lines.`,
      })),
    ),
  comparison: () => [],
  list: () => [],
  "stat-chart": ({ kind, number, bars }) => [
    {
      broken: kind === "number" && !number,
      code: "CONTENT",
      field: "content.number",
      message: 'A stat-chart of kind "number" needs its number.',
    },
    {
      broken: kind === "bars" && !bars?.length,
      code: "CONTENT",
      field: "content.bars",
      message: 'A stat-chart of kind "bars" needs at least one bar.',
    },
  ],
  outro: () => [],
} satisfies { [Type in SceneType]: (content: Extract<Scene, { type: Type }>["content"]) => SceneRule[] };

function edgeRules(ids: Set<string>, edges: { id: string; from: string; to: string }[], kind: string): SceneRule[] {
  return edges.flatMap((edge, index) =>
    (["from", "to"] as const).map((end) => ({
      broken: !ids.has(edge[end]),
      code: "REFERENCE" as const,
      field: `content.edges[${index}].${end}`,
      message: `Edge "${edge.id}" connects ${end} "${edge[end]}", which isn't a ${kind} of this Scene.`,
    })),
  );
}

function checkContent({ storyboard }: CheckInput): StoryboardIssue[] {
  return storyboard.scenes.flatMap((scene) => {
    // The table is keyed by Scene Type, so each entry receives the content shape of its own type.
    const rules = CONTENT_RULES[scene.type] as (content: Scene["content"]) => SceneRule[];

    return issuesFor(scene.id, rules(scene.content));
  });
}

/** The Style Preset choice each Transition falls under; camera moves come with a Canvas instead. */
const PRESET_TRANSITION = {
  cut: "cut",
  crossfade: "crossfade",
  "push-left": "push",
  "push-right": "push",
  "push-up": "push",
  "push-down": "push",
  "zoom-through": "zoom-through",
  "carry-over": "carry-over",
  camera: undefined,
} satisfies Record<Transition, PresetTransition | undefined>;

/**
 * Every Scene but the last names the Transition into the next one, drawn from the Style Preset's
 * allowed set. Camera moves happen exactly between Scenes on the same Canvas; a carry-over needs an
 * element both Scenes share.
 */
function checkTransitions({ storyboard, rules }: CheckInput): StoryboardIssue[] {
  return storyboard.scenes.flatMap((scene, index) => {
    const next = storyboard.scenes[index + 1];
    const { transition } = scene;
    const presetTransition = presetTransitionOf(transition);
    const sharesCanvas = Boolean(scene.canvas) && scene.canvas === next?.canvas;

    return issuesFor(scene.id, [
      {
        broken: !next && transition !== undefined,
        code: "TRANSITION",
        field: "transition",
        message: "The last Scene has no next Scene to transition into; remove its transition.",
      },
      {
        broken: next !== undefined && transition === undefined,
        code: "TRANSITION",
        field: "transition",
        message: `Needs the Transition into ${next?.id}.`,
      },
      {
        broken: presetTransition !== undefined && !rules.transitions.includes(presetTransition),
        code: "TRANSITION",
        field: "transition",
        message: `The Style Preset doesn't allow "${transition}"; it allows ${allowedTransitions(rules)}.`,
      },
      {
        broken: next !== undefined && transition === "camera" && !sharesCanvas,
        code: "TRANSITION",
        field: "transition",
        message: `"camera" moves only between Scenes on the same Canvas, and ${next?.id} isn't on this Scene's Canvas.`,
      },
      {
        broken: sharesCanvas && transition !== "camera",
        code: "TRANSITION",
        field: "transition",
        message: `This Scene and ${next?.id} share Canvas ${scene.canvas}, so the Transition between them is "camera".`,
      },
      {
        broken: next !== undefined && transition === "carry-over" && !sharesElement(scene, next),
        code: "TRANSITION",
        field: "transition",
        message: `"carry-over" morphs an element into the next Scene, but ${next?.id} has no element with the same id as one in this Scene.`,
      },
    ]);
  });
}

function presetTransitionOf(transition: Transition | undefined): PresetTransition | undefined {
  if (!transition) {
    return undefined;
  }

  return PRESET_TRANSITION[transition];
}

function allowedTransitions(rules: StoryboardRules): string {
  const allowed = Object.entries(PRESET_TRANSITION)
    .filter(([, presetTransition]) => presetTransition !== undefined && rules.transitions.includes(presetTransition))
    .map(([transition]) => `"${transition}"`);

  if (rules.canvas === "never") {
    return allowed.join(", ");
  }

  return [...allowed, '"camera" within a Canvas'].join(", ");
}

function sharesElement(scene: Scene, next: Scene): boolean {
  const ids = new Set(elementsOf(scene).map(({ id }) => id));

  return elementsOf(next).some(({ id }) => ids.has(id));
}

/**
 * A Canvas is one run of at least two consecutive Scenes, used as readily as the Style Preset's
 * Canvas preference says: never, where it helps (the agent's call), or whenever possible.
 */
function checkCanvases({ storyboard, rules }: CheckInput): StoryboardIssue[] {
  const { scenes } = storyboard;

  if (rules.canvas === "never") {
    return scenes
      .filter((scene) => scene.canvas !== undefined)
      .flatMap((scene) =>
        issuesFor(scene.id, [
          {
            broken: true,
            code: "CANVAS",
            field: "canvas",
            message: "The Style Preset never uses a Canvas; remove canvas so the Scene stands alone.",
          },
        ]),
      );
  }

  const runIssues = scenes.flatMap((scene, index) => {
    const startsRun = scene.canvas !== undefined && scenes[index - 1]?.canvas !== scene.canvas;
    const isReused = scenes.slice(0, index).some(({ canvas }) => canvas === scene.canvas);
    const holdsOneScene = scenes[index + 1]?.canvas !== scene.canvas;

    return issuesFor(scene.id, [
      {
        broken: startsRun && isReused,
        code: "CANVAS",
        field: "canvas",
        message: `Canvas ${scene.canvas} is already used by earlier Scenes; a Canvas is one run of consecutive Scenes.`,
      },
      {
        broken: startsRun && !isReused && holdsOneScene,
        code: "CANVAS",
        field: "canvas",
        message: `Canvas ${scene.canvas} holds only this Scene; a Canvas is shared by at least two consecutive Scenes.`,
      },
    ]);
  });

  const usesNoCanvas = scenes.length > 1 && scenes.every(({ canvas }) => canvas === undefined);

  if (rules.canvas === "whenever-possible" && usesNoCanvas) {
    return [
      ...runIssues,
      {
        code: "CANVAS",
        field: "scenes",
        message: "The Style Preset uses a Canvas whenever possible; put runs of consecutive Scenes about the same picture on a shared Canvas.",
      },
    ];
  }

  return runIssues;
}

/** The most words a label or hero word may have when Captions already show the spoken words. */
const MAX_CAPTIONED_COPY_WORDS = 4;

/** With Captions on, Storyboard copy is labels, numbers or hero words only: the Captions say the rest. */
function checkCaptions({ storyboard, rules }: CheckInput): StoryboardIssue[] {
  if (!rules.captions) {
    return [];
  }

  return storyboard.scenes.flatMap((scene) =>
    issuesFor(
      scene.id,
      copyOf(scene).map(({ text, field }) => ({
        broken: text.split(/\s+/).length > MAX_CAPTIONED_COPY_WORDS,
        code: "CAPTIONS",
        field,
        message: `"${text}" is too long while Captions are on; use a label, number or hero word of at most ${MAX_CAPTIONED_COPY_WORDS} words.`,
      })),
    ),
  );
}

/** The rules a Storyboard must meet beyond its schema, in the order their issues are reported. */
export const CHECKS: Check[] = [
  checkFormat,
  checkSceneIds,
  checkSpans,
  checkBoundaries,
  checkPacing,
  checkElements,
  checkContent,
  checkTransitions,
  checkCanvases,
  checkCaptions,
];
