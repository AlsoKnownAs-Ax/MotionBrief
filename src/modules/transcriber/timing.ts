import type { TranscriptWord } from "../../contract";

/** Onsets closer than this to the first of a run were stacked by DTW rather than spoken that fast. */
const STACKED_SECONDS = 0.03;

/** A word lasts at least this long, unless the next word starts sooner. */
const MIN_WORD_SECONDS = 0.05;

/**
 * Makes words ready to sync to: onsets in order, onsets DTW stacked on one time spread out, ends that never run into
 * the next word, all within the Voiceover and rounded to the millisecond.
 */
export function finishWords(words: TranscriptWord[], duration: number): TranscriptWord[] {
  const spread = spreadStacked(inOrder(words));

  return spread.map((word, index) => {
    const start = Math.min(word.start, duration);
    const next = spread[index + 1]?.start ?? duration;
    const end = Math.min(Math.max(word.end, start + MIN_WORD_SECONDS), next, duration);

    return { text: word.text, start: milliseconds(start), end: milliseconds(end) };
  });
}

/**
 * DTW sometimes puts several words on one onset, mostly the words after a pause (6–9% of onsets in the spike), so
 * every element anchored to them would appear at once. Each stacked run is spread over the gap to the next onset,
 * weighted by word length.
 */
function spreadStacked(words: TranscriptWord[]): TranscriptWord[] {
  const runs = runsOf(words);

  return runs.flatMap((run, index) => {
    const first = run[0];
    const last = run.at(-1);

    if (run.length === 1 || !first || !last) {
      return run;
    }

    // The last run has no next onset; its words get at least their minimum length.
    const until = runs[index + 1]?.[0]?.start ?? Math.max(last.end, first.start + MIN_WORD_SECONDS * run.length);
    const weights = run.map(({ text }) => text.length + 2);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const before = weights.map((_, position) => weights.slice(0, position).reduce((sum, weight) => sum + weight, 0));

    return run.map((word, position) => ({ ...word, start: first.start + ((until - first.start) * (before[position] ?? 0)) / total }));
  });
}

/** DTW onsets can step backwards by a few milliseconds; a word never starts before the one spoken before it. */
function inOrder(words: TranscriptWord[]): TranscriptWord[] {
  return words.reduce<TranscriptWord[]>((ordered, word) => {
    ordered.push({ ...word, start: Math.max(word.start, ordered.at(-1)?.start ?? 0) });

    return ordered;
  }, []);
}

/** Groups consecutive words whose onsets sit within STACKED_SECONDS of their run's first onset. */
function runsOf(words: TranscriptWord[]): TranscriptWord[][] {
  return words.reduce<TranscriptWord[][]>((runs, word) => {
    const run = runs.at(-1);
    const first = run?.[0];

    if (!run || !first || word.start - first.start >= STACKED_SECONDS) {
      runs.push([word]);

      return runs;
    }

    run.push(word);

    return runs;
  }, []);
}

function milliseconds(seconds: number) {
  return Math.round(seconds * 1000) / 1000;
}
