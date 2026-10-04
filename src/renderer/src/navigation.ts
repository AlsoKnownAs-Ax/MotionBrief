import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Screen = "home" | "setup" | "editor";

type Navigation = {
  screen: Screen;
  /** The setup step to bring into view, such as "connect-claude" when Generate needs Claude. */
  focusedStep?: string;
  /** First run opens the setup screen; once left, launches open Home and its checklist. */
  hasLeftSetup: boolean;
  openSetup: (stepId?: string) => void;
  openHome: () => void;
  openEditor: () => void;
};

export const useNavigation = create<Navigation>()(
  persist(
    (set) => ({
      screen: "setup",
      hasLeftSetup: false,
      openSetup: (stepId) => set({ screen: "setup", focusedStep: stepId }),
      openHome: () => set({ screen: "home", focusedStep: undefined, hasLeftSetup: true }),
      openEditor: () => set({ screen: "editor", focusedStep: undefined }),
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
