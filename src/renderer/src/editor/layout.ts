import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DEFAULT_LAYOUT = { panelWidth: 340, timelineHeight: 236 };

export const PANE_LIMITS = {
  panelWidth: { min: 280, maxShare: 0.45 },
  timelineHeight: { min: 150, maxShare: 0.6 },
};

type EditorLayout = typeof DEFAULT_LAYOUT & {
  resize: (sizes: Partial<typeof DEFAULT_LAYOUT>) => void;
};

/**
 * The editor's pane sizes. They belong to the window, not to the Project: kept in the window's
 * session storage, so a reload keeps them and another window has its own.
 */
export const useEditorLayout = create<EditorLayout>()(
  persist(
    (set) => ({
      ...DEFAULT_LAYOUT,
      resize: (sizes) => set(sizes),
    }),
    {
      name: "motionbrief.editor-layout",
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ panelWidth, timelineHeight }) => ({ panelWidth, timelineHeight }),
    },
  ),
);
