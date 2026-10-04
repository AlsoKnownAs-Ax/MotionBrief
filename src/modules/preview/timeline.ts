import type { StoryboardTranscript, UnitCode, VideoTimeline } from "../../contract";
import type { AssembledPage } from "../assembler";
import { sceneTimings, type Storyboard } from "../storyboard";

/** The assembled video as the editor shows it: each Scene's timing, unit, status and Transition in, and the words. */
export function timelineOf(storyboard: Storyboard, transcript: StoryboardTranscript, page: AssembledPage, code: Record<string, UnitCode>): VideoTimeline {
  const { format, width, height, duration, units } = page;
  const timings = sceneTimings(storyboard, transcript);

  return {
    format,
    width,
    height,
    duration,
    scenes: timings.map(({ scene, start, end }, index) => {
      const unit = units.find(({ scenes }) => scenes.includes(scene))?.id ?? scene.id;

      return {
        id: scene.id,
        number: index + 1,
        type: scene.type,
        unit,
        start: seconds(start),
        end: seconds(end),
        status: code[unit] ? "ready" : "fallback",
        transitionIn: timings[index - 1]?.scene.transition?.type,
      };
    }),
    words: transcript.words.map(({ text, start }, index) => ({
      text,
      start,
      end: transcript.words[index + 1]?.start ?? duration,
    })),
  };
}

function seconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
