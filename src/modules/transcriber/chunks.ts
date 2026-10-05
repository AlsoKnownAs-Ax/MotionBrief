import { sampleAt, type TimeRange } from "../media";

/**
 * whisper-cli can't report words as it goes when DTW timing is on, so the Voiceover is transcribed in chunks cut at
 * pauses, each one filling in more of the Transcript. Longer chunks cost fewer model loads; shorter ones fill in sooner.
 */
const MIN_CHUNK_SECONDS = 20;
const MAX_CHUNK_SECONDS = 60;

/** Splits a Voiceover into chunks of 20 to 60 seconds, each cut in the middle of the longest pause it can reach. */
export function planChunks(duration: number, silences: TimeRange[]): TimeRange[] {
  const chunks: TimeRange[] = [];
  let start = 0;

  while (duration - start > MAX_CHUNK_SECONDS) {
    const end = cutPoint(start, silences);
    chunks.push({ start, end });
    start = end;
  }

  return [...chunks, { start, end: duration }];
}

function cutPoint(start: number, silences: TimeRange[]) {
  const window = { start: start + MIN_CHUNK_SECONDS, end: start + MAX_CHUNK_SECONDS };
  const [longest] = silences
    .map((silence) => ({ start: Math.max(silence.start, window.start), end: Math.min(silence.end, window.end) }))
    .filter((overlap) => overlap.end > overlap.start)
    .sort((a, b) => b.end - b.start - (a.end - a.start));

  // Speech with no pause for a whole minute is cut at the minute.
  const cut = (longest?.start ?? window.end) / 2 + (longest?.end ?? window.end) / 2;

  // On a sample, so a chunk's start in seconds is exactly where its audio starts.
  return sampleAt(cut) / sampleAt(1);
}
