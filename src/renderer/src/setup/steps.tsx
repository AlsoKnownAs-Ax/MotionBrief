import type { ReactNode } from "react";
import { useConnectClaudeStep } from "./connect-claude-step";
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
  const connectClaude = useConnectClaudeStep();

  return [transcriptionModel, connectClaude];
}
