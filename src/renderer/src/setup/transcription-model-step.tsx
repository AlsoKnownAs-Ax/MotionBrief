import { safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "@renderer/components/ui/button";
import { Progress } from "@renderer/components/ui/progress";
import { core, orpc, useCoreConnection } from "@renderer/core/connection";
import type { TranscriptionModelError, TranscriptionModelStatus } from "../../../contract";
import type { SetupStep } from "./steps";

/** The transcription model's setup step: its download, progress, and recovery. */
export function useTranscriptionModelStep(): SetupStep {
  const { data: status } = useQuery(orpc.transcriptionModel.watch.experimental_liveOptions());

  return {
    id: "transcription-model",
    title: "Download the transcription model",
    label: "Transcription model",
    description: describeStep(status),
    done: isReady(status),
    panel: <ModelDownload status={status} />,
    summary: <ModelDownload status={status} compact />,
  };
}

/**
 * Starts the download whenever this window reaches a core: at launch, and again after the core restarts, which
 * resumes it. A download the user paused, or one that failed, waits for them instead.
 */
export function useStartTranscriptionModel() {
  const connection = useCoreConnection((state) => state.status);

  useEffect(() => {
    if (connection !== "connected") {
      return;
    }

    void call(() => core.transcriptionModel.start());
  }, [connection]);
}

function describeStep(status?: TranscriptionModelStatus) {
  const intro = "Transcription runs on this computer, so your Voiceover never leaves it.";

  if (!status) {
    return intro;
  }

  return `${intro} ${megabytes(status.totalBytes)} MB, downloaded once.`;
}

function isReady(status?: TranscriptionModelStatus) {
  if (!status) {
    return undefined;
  }

  return status.state === "ready";
}

type ModelDownloadProps = {
  status?: TranscriptionModelStatus;
  /** Home's checklist: no import link unless something failed. */
  compact?: boolean;
};

function ModelDownload({ status, compact = false }: ModelDownloadProps) {
  if (!status) {
    return <Note icon={<LoaderCircleIcon className="animate-spin text-ink-muted" />}>Checking the transcription model…</Note>;
  }

  return STATE_VIEWS[status.state]({ status, compact });
}

type StateView = (props: { status: TranscriptionModelStatus; compact: boolean }) => ReactNode;

const STATE_VIEWS = {
  idle: (props) => <Transfer {...props} label={`${progressLabel(props.status)} · Waiting to start`} action="start" />,
  downloading: (props) => <Transfer {...props} label={progressLabel(props.status)} action="pause" />,
  paused: (props) => <Transfer {...props} label={`Paused at ${progressLabel(props.status)}`} action="resume" />,
  verifying: () => <Note icon={<LoaderCircleIcon className="animate-spin text-ink-muted" />}>Checking the file…</Note>,
  ready: () => (
    <Note icon={<CircleCheckIcon className="text-status-success" />}>Ready · Whisper large-v3-turbo runs on this computer</Note>
  ),
  failed: ({ status }) => <Failed error={status.error} />,
} satisfies Record<TranscriptionModelStatus["state"], StateView>;

type TransferAction = "start" | "pause" | "resume";

const TRANSFER_ACTIONS = {
  start: { label: "Download", icon: <PlayIcon />, run: () => core.transcriptionModel.start() },
  pause: { label: "Pause", icon: <PauseIcon />, run: () => core.transcriptionModel.pause() },
  resume: { label: "Resume", icon: <PlayIcon />, run: () => core.transcriptionModel.resume() },
} satisfies Record<TransferAction, { label: string; icon: ReactNode; run: () => Promise<unknown> }>;

type TransferProps = {
  status: TranscriptionModelStatus;
  compact: boolean;
  label: string;
  action: TransferAction;
};

function Transfer({ status, compact, label, action }: TransferProps) {
  const { label: actionLabel, icon, run } = TRANSFER_ACTIONS[action];
  const percent = (status.receivedBytes / status.totalBytes) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
          <Progress
            value={percent}
            status={progressStatus(status)}
            aria-label="Transcription model download"
            aria-valuetext={label}
          />
          <span className="text-app-xs text-ink-muted tabular-nums">{label}</span>
        </div>
        <Button size="sm" onClick={() => void call(run)}>
          {icon}
          {actionLabel}
        </Button>
      </div>
      {!compact ? <ImportLink>Already have the file? Import it…</ImportLink> : null}
    </div>
  );
}

function progressStatus({ state }: TranscriptionModelStatus) {
  if (state === "downloading") {
    return "working";
  }

  return "neutral";
}

function Failed({ error }: { error?: TranscriptionModelError }) {
  return (
    <div role="alert" className="flex flex-col gap-2.5">
      <Note icon={<CircleAlertIcon className="text-status-fallback-ink" />}>{describeError(error)}</Note>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void call(() => core.transcriptionModel.resume())}>
          <RotateCcwIcon />
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void chooseAndImport()}>
          Use a file I already have…
        </Button>
      </div>
    </div>
  );
}

/** One sentence the user can act on, per error code. */
const ERROR_MESSAGES = {
  NOT_ENOUGH_SPACE: (error) =>
    `Not enough free space: the model needs ${megabytes(error.requiredBytes)} MB and ${megabytes(error.freeBytes)} MB is free. Free up some space, then Retry.`,
  DOWNLOAD_FAILED: () => "Couldn't download the model from Hugging Face. Check your connection and Retry, or use a copy you already have.",
  HASH_MISMATCH: () =>
    "The downloaded model didn't match its checksum, even after downloading it again. Retry, or use a copy you already have.",
  IMPORT_MISMATCH: (error) => `${fileName(error.path)} isn't the transcription model MotionBrief needs: its checksum doesn't match.`,
  FILE_FAILED: (error) => `Couldn't save the model to ${error.path}. Retry, or use a copy you already have.`,
} satisfies { [Code in TranscriptionModelError["code"]]: (error: Extract<TranscriptionModelError, { code: Code }>) => string };

function describeError(error?: TranscriptionModelError) {
  if (!error) {
    return "The model couldn't be set up. Retry, or use a copy you already have.";
  }

  return ERROR_MESSAGES[error.code](error as never);
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-app-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  );
}

function ImportLink({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="self-start text-app-xs text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-current"
      onClick={() => void chooseAndImport()}
    >
      {children}
    </button>
  );
}

async function chooseAndImport() {
  const path = await window.motionbrief.chooseFile({
    title: "Choose the Whisper model file",
    filters: [{ name: "Whisper model", extensions: ["bin"] }],
  });

  if (!path) {
    return;
  }

  await call(() => core.transcriptionModel.import({ path }));
}

/** Runs a core call whose outcome arrives on the status stream; a failed call is only logged. */
async function call(run: () => Promise<unknown>) {
  const { error } = await safe(run());

  if (error) {
    console.error("[renderer] transcription model call failed", error);
  }
}

function progressLabel({ receivedBytes, totalBytes }: TranscriptionModelStatus) {
  return `${megabytes(receivedBytes)} of ${megabytes(totalBytes)} MB`;
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1_000_000);
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}
