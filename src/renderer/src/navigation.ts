import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Screen = "home" | "setup" | "new-project";

type Navigation = {
  screen: Screen;
  /** The setup step to bring into view, such as "connect-claude" when Generate needs Claude. */
  focusedStep?: string;
  /** A Voiceover dropped on Home, which the New Project screen starts with. */
  droppedVoiceover?: string;
  /** First run opens the setup screen; once left, launches open Home and its checklist. */
  hasLeftSetup: boolean;
  openSetup: (stepId?: string) => void;
  openHome: () => void;
  openNewProject: (voiceoverPath?: string) => void;
};

export const useNavigation = create<Navigation>()(
  persist(
    (set) => ({
      screen: "setup",
      hasLeftSetup: false,
      openSetup: (stepId) => set({ screen: "setup", focusedStep: stepId }),
      openHome: () => set({ screen: "home", focusedStep: undefined, droppedVoiceover: undefined, hasLeftSetup: true }),
      openNewProject: (voiceoverPath) => set({ screen: "new-project", droppedVoiceover: voiceoverPath, hasLeftSetup: true }),
    }),
    {
      name: "motionbrief.navigation",
      partialize: ({ hasLeftSetup }) => ({ hasLeftSetup }),
      onRehydrateStorage: () => (state) => {
        if (state?.hasLeftSetup) {
          state.openHome();
        }
      },
    },
  ),
);
