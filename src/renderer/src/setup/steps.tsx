import type { ComponentType } from "react";
import { useConnectClaudeStep } from "@renderer/setup/connect-claude-step";

/**
 * A first-run setup step. Each feature owns its step; the setup screen and Home's checklist
 * only list them, so adding a step is one hook here.
 */
export type SetupStep = {
  id: string;
  title: string;
  description: string;
  isDone: boolean;
  /** The step's full controls on the setup screen. */
  Panel: ComponentType;
  /** Its compact control on Home's checklist, shown while it isn't done. */
  ChecklistAction: ComponentType;
};

export function useSetupSteps(): SetupStep[] {
  return [useConnectClaudeStep()];
}
