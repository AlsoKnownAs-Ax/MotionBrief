import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import { WordEditor } from "@renderer/components/word-editor";
import { cn, rovingTabIndex } from "@renderer/lib/utils";
import { useTranscriptionModelStep } from "@renderer/setup/transcription-model-step";
import type { TranscriptionError, TranscriptionStatus, TranscriptWord } from "../../../contract";
import { clockLabel, languageName } from "./labels";

/** A pause this long starts a new paragraph, so the Transcript reads in breaths rather than one block. */
const PARAGRAPH_PAUSE_SECONDS = 1.2;

/** Saves a word fix; answers with the text saved, or why it wasn't. */
export type FixWord = (index: number, text: string) => Promise<{ text?: string; error?: string }>;

type TranscriptPaneProps = {
  transcription?: TranscriptionStatus;
  onRetry: () => void;
  onFixWord: FixWord;
};

/** The Transcript filling in as the Voiceover is transcribed on this computer; once it's done, words can be fixed. */
export function TranscriptPane({ transcription, onRetry, onFixWord }: TranscriptPaneProps) {
  const isDone = transcription?.state === "done";

  return (
    <section aria-labelledby="transcript-heading" className="flex min-h-0 flex-1 flex-col gap-4 rounded-lg bg-surface-1 p-5">
      <div className="flex min-h-badge items-center gap-2.5">
        <h2 id="transcript-heading" className="text-app-sm font-medium">
          Transcript
        </h2>
        <p aria-live="polite" className="flex items-center gap-2.5">
          {statusLine(transcription)}
        </p>
        <span className="flex-1" />
        {isDone ? (
          <span id="transcript-hint" className="text-app-xs text-ink-muted">
            Double-click a word, or press Enter on it, to fix it.
          </span>
        ) : null}
      </div>
      {body(transcription, onRetry)}
      <Words words={transcription?.words ?? []} isDone={isDone} onFixWord={onFixWord} />
    </section>
  );
}

function statusLine(transcription?: TranscriptionStatus) {
  if (!transcription) {
    return null;
  }

  return STATUS_LINES[transcription.state](transcription);
}

const STATUS_LINES = {
  "waiting-for-model": () => <span className="text-app-xs text-ink-muted">Waiting for the transcription model</span>,
  transcribing: () => (
    <Badge status="working" pulse>
      Transcribing on this computer
    </Badge>
  ),
  done: ({ words, language, duration }) => (
    <span className="text-app-xs text-ink-muted tabular-nums">
      {words.length} words · {languageName(language ?? "en")} · {clockLabel(duration)}
    </span>
  ),
  failed: () => <Badge status="fallback">Transcription stopped</Badge>,
} satisfies Record<TranscriptionStatus["state"], (transcription: TranscriptionStatus) => ReactNode>;

function body(transcription: TranscriptionStatus | undefined, onRetry: () => void) {
  if (!transcription) {
    return (
      <p className="flex items-center gap-2 text-app-sm text-ink-muted">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        Starting…
      </p>
    );
  }

  return BODIES[transcription.state]({ transcription, onRetry });
}

type BodyProps = { transcription: TranscriptionStatus; onRetry: () => void };

const BODIES = {
  "waiting-for-model": () => <WaitingForModel />,
  transcribing: ({ transcription }) => <Transcribing transcription={transcription} />,
  done: () => null,
  failed: ({ transcription, onRetry }) => <Failed error={transcription.error} onRetry={onRetry} />,
} satisfies Record<TranscriptionStatus["state"], (props: BodyProps) => ReactNode>;

function WaitingForModel() {
  const step = useTranscriptionModelStep();

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-4">
      <p className="text-app-sm">Transcription starts as soon as the transcription model finishes downloading.</p>
      {step.summary}
    </div>
  );
}

function Transcribing({ transcription: { transcribedSeconds, duration } }: { transcription: TranscriptionStatus }) {
  const percent = (transcribedSeconds / Math.max(duration, 1)) * 100;
  const label = `${clockLabel(transcribedSeconds)} of ${clockLabel(duration)}`;

  return (
    <div className="flex items-center gap-3">
      <Progress value={percent} aria-label="Transcription" aria-valuetext={label} />
      <span className="shrink-0 text-app-xs text-ink-muted tabular-nums">{label}</span>
    </div>
  );
}

/** One sentence per error code; the details from whisper-cli or FFmpeg stay in the log. */
const ERROR_MESSAGES = {
  VOICEOVER_UNREADABLE: "FFmpeg couldn't read the Voiceover's audio.",
  TRANSCRIBER_FAILED: "whisper-cli stopped before the Transcript was done.",
  FILE_FAILED: "The Transcript couldn't be saved in the Project folder.",
} satisfies Record<TranscriptionError["code"], string>;

function Failed({ error, onRetry }: { error?: TranscriptionError; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-md bg-status-fallback-tint p-4">
      <p className="flex items-start gap-2 text-app-sm">
        <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-status-fallback-ink" />
        {errorMessage(error)}
      </p>
      <Button size="sm" className="self-start" onClick={onRetry}>
        <RotateCcwIcon />
        Retry
      </Button>
    </div>
  );
}

function errorMessage(error?: TranscriptionError) {
  if (!error) {
    return "Transcription stopped.";
  }

  return ERROR_MESSAGES[error.code];
}

type WordsProps = { words: TranscriptWord[]; isDone: boolean; onFixWord: FixWord };

function Words({ words, isDone, onFixWord }: WordsProps) {
  if (words.length === 0) {
    return null;
  }

  return (
    <div aria-busy={!isDone} className="min-h-0 flex-1 overflow-y-auto pr-2">
      <div className="flex max-w-[68ch] flex-col gap-3 text-app-body leading-[1.65]">
        {isDone ? <FixableWords words={words} onFixWord={onFixWord} /> : <LiveWords words={words} />}
      </div>
    </div>
  );
}

function LiveWords({ words }: { words: TranscriptWord[] }) {
  return paragraphs(words).map((paragraph) => <p key={paragraph[0]}>{paragraph.map((index) => words[index]!.text).join(" ")}</p>);
}

/**
 * The saved Transcript, a word at a time: double-click a word, or press Enter or F2 on it, to fix it. Arrow keys,
 * Home and End move between words.
 */
function FixableWords({ words, onFixWord }: { words: TranscriptWord[]; onFixWord: FixWord }) {
  const [focused, setFocused] = useState(0);
  const [editing, setEditing] = useState<number>();
  /** Fixes shown while they save; each is what the core saved once it answers. */
  const [saving, setSaving] = useState<Record<number, string>>({});
  const [error, setError] = useState<string>();
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const returnFocusTo = useRef<number>(undefined);

  // A finished edit hands the keyboard back to its word.
  useEffect(() => {
    if (editing === undefined && returnFocusTo.current !== undefined) {
      buttons.current.get(returnFocusTo.current)?.focus();
      returnFocusTo.current = undefined;
    }
  }, [editing]);

  function moveFocus(index: number) {
    const next = Math.max(0, Math.min(words.length - 1, index));

    setFocused(next);
    buttons.current.get(next)?.focus();
  }

  async function finishEditing(index: number, text: string | undefined) {
    returnFocusTo.current = index;
    setEditing(undefined);
    const fixed = text?.trim();

    if (!fixed || fixed === textOf(index)) {
      return;
    }

    setSaving((shown) => ({ ...shown, [index]: fixed }));
    setError(undefined);
    const { text: saved, error: message } = await onFixWord(index, fixed);

    if (saved === undefined) {
      setSaving((shown) => Object.fromEntries(Object.entries(shown).filter(([fixed]) => Number(fixed) !== index)));
      setError(message);

      return;
    }

    setSaving((shown) => ({ ...shown, [index]: saved }));
  }

  function textOf(index: number) {
    return saving[index] ?? words[index]!.text;
  }

  return (
    <>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-app-sm text-status-fallback-ink">
          <CircleAlertIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      <div role="group" aria-label="Transcript words" aria-describedby="transcript-hint" className="contents">
        {paragraphs(words).map((paragraph) => (
          <p key={paragraph[0]}>
            {paragraph.map((index) => {
              const word = words[index]!;
              const text = textOf(index);
              const heard = word.heard ?? word.text;

              if (editing === index) {
                return (
                  <Fragment key={index}>
                    <WordEditor text={text} className="h-[1.65em] text-app-body" onDone={(value) => void finishEditing(index, value)} />{" "}
                  </Fragment>
                );
              }

              return (
                <Fragment key={index}>
                  <button
                    ref={(button) => {
                      if (button) {
                        buttons.current.set(index, button);
                      } else {
                        buttons.current.delete(index);
                      }
                    }}
                    type="button"
                    tabIndex={rovingTabIndex(index === focused)}
                    aria-keyshortcuts="Enter F2"
                    title={fixedTitle(text, heard)}
                    className={cn("cursor-text rounded-[4px] hover:bg-surface-2", text !== heard && "underline decoration-dotted underline-offset-[3px]")}
                    onFocus={() => setFocused(index)}
                    onDoubleClick={() => setEditing(index)}
                    onKeyDown={(event) => {
                      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
                      const ends: Record<string, number> = { Home: 0, End: words.length - 1 };

                      if (event.key === "Enter" || event.key === "F2") {
                        event.preventDefault();
                        setEditing(index);
                      } else if (moves[event.key] !== undefined) {
                        event.preventDefault();
                        moveFocus(index + moves[event.key]!);
                      } else if (ends[event.key] !== undefined) {
                        event.preventDefault();
                        moveFocus(ends[event.key]!);
                      }
                    }}
                  >
                    {text}
                  </button>{" "}
                </Fragment>
              );
            })}
          </p>
        ))}
      </div>
    </>
  );
}

/** Splits the words, by index, wherever the speaker paused for a breath. */
/** A fixed word's tooltip names what whisper-cli heard. */
function fixedTitle(text: string, heard: string) {
  if (text === heard) {
    return undefined;
  }

  return `Fixed from “${heard}”`;
}

function paragraphs(words: TranscriptWord[]) {
  return words.reduce<number[][]>((split, word, index) => {
    const before = words[index - 1];
    const current = split.at(-1);

    if (!current || !before || word.start - before.end >= PARAGRAPH_PAUSE_SECONDS) {
      split.push([index]);

      return split;
    }

    current.push(index);

    return split;
  }, []);
}
