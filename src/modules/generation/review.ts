import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { StoryboardRules, StylePreset, Transcript, UnitCode } from "../../contract";
import type { Unit } from "../assembler";
import { defineHostTool } from "../connector";
import type { Stills } from "../preview";
import { sceneTimings, type Storyboard } from "../storyboard";
import type { PresetBrief } from "../style";
import { runTurn, withSession, type AgentRun } from "./agents";
import { REVIEW_TOOL, reviewMessage, reviewSystem } from "./prompts";

/** What the reviewer wants repaired, and the sentence the creator sees if the repair is reverted. */
export type Review = { problems: string[]; note: string };

/** Review stills are this many pixels wide: enough to read labels, small enough to send many. */
const REVIEW_WIDTH = 1280;

/** A Scene's last still is taken just before it ends, with every element in. */
const BEFORE_END = 0.15;

type ReviewRun = AgentRun & {
  stills: Stills;
  storyboard: Storyboard;
  transcript: Transcript;
  rules: StoryboardRules;
  preset: StylePreset;
  brief: PresetBrief;
  unit: Unit;
  /** The unit's code, which passed the checks. */
  code: UnitCode;
};

/**
 * The visual review: the Renderer draws stills of the unit (every other unit as its fallback Scene), and
 * the reviewer judges them once. Resolves with what to repair, or `null` when the unit looks right or
 * couldn't be reviewed, which never holds the unit back.
 */
export async function reviewUnit({ stills, storyboard, transcript, rules, preset, brief, unit, code, ...run }: ReviewRun): Promise<Review | null> {
  const moments = momentsOf(storyboard, transcript, unit);
  const source = { storyboard, transcript, rules, preset, code: { [unit.id]: code } };
  const { data: frames } = await stills.frames(source, moments.map(({ time }) => time), REVIEW_WIDTH);

  if (!frames) {
    return null;
  }

  let verdict: { looksRight: boolean; problems: string[]; note: string } | undefined;
  const submit = defineHostTool({
    name: REVIEW_TOOL,
    description: "Hands in the visual review of the unit's stills.",
    input: {
      looksRight: z.boolean().describe("true when a viewer would notice nothing broken or amateurish"),
      problems: z.array(z.string()).describe("each concrete, fixable visual defect; empty when it looks right"),
      note: z.string().describe("one plain sentence for the creator naming what still looks wrong; empty when it looks right"),
    },
    run: async (input) => {
      verdict = input;

      return { text: "Received." };
    },
  });
  const setup = { label: `review ${unit.id}`, systemPrompt: reviewSystem(storyboard.format, brief), hostTools: [submit] };

  const { data: review } = await withSession(run, setup, async (session, workspaceDir) => {
    const files = moments.map(({ sceneId }, index) => ({ file: `still-${index + 1}.jpg`, time: moments[index]?.time ?? 0, sceneId }));
    await Promise.all(files.map(({ file }, index) => writeFile(join(workspaceDir, file), frames[index] ?? new Uint8Array())));
    const turnError = await runTurn(session, reviewMessage({ unit, stills: files }));

    return { data: turnError ? null : reviewOf(verdict), error: null };
  });

  return review ?? null;
}

function reviewOf(verdict: { looksRight: boolean; problems: string[]; note: string } | undefined): Review | null {
  const problems = verdict?.problems.map((problem) => problem.trim()).filter(Boolean) ?? [];

  if (!verdict || verdict.looksRight || problems.length === 0) {
    return null;
  }

  return { problems, note: verdict.note.trim() || (problems[0] ?? "") };
}

/** Each of the unit's Scenes halfway through and just before it ends, in seconds into the video. */
function momentsOf(storyboard: Storyboard, transcript: Transcript, unit: Unit): { sceneId: string; time: number }[] {
  const ids = new Set(unit.scenes.map(({ id }) => id));

  return sceneTimings(storyboard, transcript)
    .filter(({ scene }) => ids.has(scene.id))
    .flatMap(({ scene, start, end }) => [
      { sceneId: scene.id, time: (start + end) / 2 },
      { sceneId: scene.id, time: Math.max(start, end - BEFORE_END) },
    ]);
}
