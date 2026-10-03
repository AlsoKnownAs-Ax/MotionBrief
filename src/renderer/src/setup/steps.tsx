import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { useTranscriptionModelStep } from "./transcription-model-step";

/**
 * One thing to finish before the first video. Each feature owns its step; the setup screen
 * and Home's checklist list them in the order `useSetupSteps` returns them.
 */
export type SetupStep = {
  id: string;
  /** Heading on the setup screen. */
  title: string;
  /** Shorter name on Home's checklist. */
  label: string;
  description: string;
  /** Absent until the step's state has loaded. */
  done?: boolean;
  /** The step's controls on the setup screen. */
  panel: ReactNode;
  /** Its compact controls on Home's checklist, shown until it is done. */
  summary: ReactNode;
};

/** Every setup step, in order. */
export function useSetupSteps(): SetupStep[] {
  const transcriptionModel = useTranscriptionModelStep();

  return [transcriptionModel];
}

type StepMarkProps = {
  number: number;
  done?: boolean;
  size?: "default" | "sm";
};

/** The step's number, or a check once it is done. */
export function StepMark({ number, done = false, size = "default" }: StepMarkProps) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-ink",
        size === "sm" && "size-[22px] text-[11px]",
        size === "default" && "size-7 text-app-sm",
        done && "bg-status-success-tint text-status-success",
      )}
    >
      {done ? <CheckIcon aria-label="Done" className="size-[15px]" /> : number}
    </span>
  );
}
