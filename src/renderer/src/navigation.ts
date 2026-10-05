import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project } from "../../contract";

export type Screen = "home" | "setup" | "new-project" | "editor";

type Navigation = {
  screen: Screen;
  /** The setup step to bring into view, such as "connect-claude" when Generate needs Claude. */
  focusedStep?: string;
  /** A Voiceover dropped on Home, which the New Project screen starts with. */
  droppedVoiceover?: string;
  /** A Project opened from Home, which the Project screen shows until it has a video. */
  openedProject?: Project;
  /** First run opens the setup screen; once left, launches open Home and its checklist. */
  hasLeftSetup: boolean;
  openSetup: (stepId?: string) => void;
  openHome: () => void;
  openNewProject: (voiceoverPath?: string) => void;
  openProject: (project: Project) => void;
  openEditor: () => void;
};

export const useNavigation = create<Navigation>()(
  persist(
    (set) => ({
      screen: "setup",
      hasLeftSetup: false,
      openSetup: (stepId) => set({ screen: "setup", focusedStep: stepId }),
      openHome: () => set({ screen: "home", focusedStep: undefined, droppedVoiceover: undefined, openedProject: undefined, hasLeftSetup: true }),
      openNewProject: (voiceoverPath) => set({ screen: "new-project", droppedVoiceover: voiceoverPath, openedProject: undefined, hasLeftSetup: true }),
      openProject: (project) => set({ screen: "new-project", droppedVoiceover: undefined, openedProject: project, hasLeftSetup: true }),
      openEditor: () => set({ screen: "editor", focusedStep: undefined, droppedVoiceover: undefined, openedProject: undefined }),
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
