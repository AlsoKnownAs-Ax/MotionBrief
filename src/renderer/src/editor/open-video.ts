import { safe } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import type { Preview } from "../../../contract";

type OpenVideo = {
  /** The open Project's id and name. */
  projectId: string;
  projectName: string;
  /** Whether the Project store has the Project open, so its Transcript keeps the word fixes; not the fixture Project. */
  isStored: boolean;
  preview?: Preview;
  /**
   * Word fixes made in the word lane, by word index. With a stored Project each is also saved in its Transcript;
   * the fixture Project only keeps them while it is open.
   */
  wordFixes: Record<number, string>;
  /** Why the last word fix couldn't be saved. */
  fixError?: string;
  /** Opens a video; one still being generated has no preview until its Storyboard is valid. */
  open: (project: { id: string; name: string; isStored?: boolean }, preview?: Preview) => void;
  /** Shows a newer preview of the same video, such as one with more of its units written, keeping the word fixes. */
  showPreview: (preview: Preview) => void;
  fixWord: (index: number, text: string) => Promise<void>;
};

/** The video the editor shows: one per window. */
export const useOpenVideo = create<OpenVideo>((set, get) => {
  /** Shows `text` for the word, or the word as the preview has it when that's what `text` is. */
  function show(index: number, text: string | undefined) {
    set(({ wordFixes, preview }) => {
      const others = Object.fromEntries(Object.entries(wordFixes).filter(([fixed]) => Number(fixed) !== index));

      if (text === undefined || text === preview?.timeline.words[index]?.text) {
        return { wordFixes: others };
      }

      return { wordFixes: { ...others, [index]: text } };
    });
  }

  return {
    projectId: "",
    projectName: "",
    isStored: false,
    wordFixes: {},
    open: (project, preview) =>
      set({
        projectId: project.id,
        projectName: project.name,
        isStored: project.isStored ?? false,
        preview,
        wordFixes: {},
        fixError: undefined,
      }),
    showPreview: (preview) => set({ preview }),
    fixWord: async (index, text) => {
      const { projectId, isStored, wordFixes } = get();
      const before = wordFixes[index];
      show(index, text);
      set({ fixError: undefined });

      if (!isStored) {
        return;
      }

      const { data: saved, error } = await safe(core.project.fixWord({ projectId, index, text }));

      if (error) {
        show(index, before);
        set({ fixError: projectErrorMessage(error) });

        return;
      }

      show(index, saved.text);
    },
  };
});

/** Opens the fixture Project in the editor; development builds only. */
export function useOpenFixtureProject() {
  return useMutation({
    mutationFn: () => core.preview.openSample(),
    onSuccess: ({ projectId, name, preview }) => {
      useOpenVideo.getState().open({ id: projectId, name }, preview);
      useNavigation.getState().openEditor();
    },
  });
}
