import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import { useTranscriptionModelStep } from "@renderer/setup/transcription-model-step";
import type { TranscriptionError, TranscriptionStatus, TranscriptWord } from "../../../contract";
import { clockLabel, languageName } from "./labels";

/** A pause this long starts a new paragraph, so the Transcript reads in breaths rather than one block. */
const PARAGRAPH_PAUSE_SECONDS = 1.2;

type TranscriptPaneProps = {
  transcription?: TranscriptionStatus;
  onRetry: () => void;
};

/** The Transcript filling in as the Voiceover is transcribed on this computer. */
export function TranscriptPane({ transcription, onRetry }: TranscriptPaneProps) {
  return (
    <section aria-labelledby="transcript-heading" className="flex min-h-0 flex-1 flex-col gap-4 rounded-lg bg-surface-1 p-5">
      <div className="flex min-h-badge items-center gap-2.5">
        <h2 id="transcript-heading" className="text-app-sm font-medium">
          Transcript
        </h2>
        <p aria-live="polite" className="flex items-center gap-2.5">
          {statusLine(transcription)}
        </p>
      </div>
      {body(transcription, onRetry)}
      <Words words={transcription?.words ?? []} isBusy={transcription?.state !== "done"} />
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

function Words({ words, isBusy }: { words: TranscriptWord[]; isBusy: boolean }) {
  if (words.length === 0) {
    return null;
  }

  return (
    <div aria-busy={isBusy} className="min-h-0 flex-1 overflow-y-auto pr-2">
      <div className="flex max-w-[68ch] flex-col gap-3 text-app-body leading-[1.65]">
        {paragraphs(words).map((paragraph) => (
          <p key={paragraph[0]?.start}>{paragraph.map(({ text }) => text).join(" ")}</p>
        ))}
      </div>
    </div>
  );
}

/** Splits the words wherever the speaker paused for a breath. */
function paragraphs(words: TranscriptWord[]) {
  return words.reduce<TranscriptWord[][]>((split, word, index) => {
    const before = words[index - 1];
    const current = split.at(-1);

    if (!current || !before || word.start - before.end >= PARAGRAPH_PAUSE_SECONDS) {
      split.push([word]);

      return split;
    }

    current.push(word);

    return split;
  }, []);
}
