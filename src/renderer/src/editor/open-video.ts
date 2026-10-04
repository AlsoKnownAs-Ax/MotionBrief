import { safe } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import type { Preview } from "../../../contract";

type OpenVideo = {
  /** The open Project's name. */
  projectName: string;
  /** The open Project, whose Transcript keeps the word fixes; absent for the fixture Project. */
  projectId?: string;
  preview?: Preview;
  /**
   * Word fixes made in the word lane, by word index. With an open Project each is also saved in its Transcript;
   * the fixture Project only keeps them while it is open.
   */
  wordFixes: Record<number, string>;
  /** Why the last word fix couldn't be saved. */
  fixError?: string;
  open: (projectName: string, preview: Preview, projectId?: string) => void;
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
    projectName: "",
    wordFixes: {},
    open: (projectName, preview, projectId) => set({ projectName, preview, projectId, wordFixes: {}, fixError: undefined }),
    fixWord: async (index, text) => {
      const { projectId, wordFixes } = get();
      const before = wordFixes[index];
      show(index, text);
      set({ fixError: undefined });

      if (!projectId) {
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
    onSuccess: ({ name, preview }) => {
      useOpenVideo.getState().open(name, preview);
      useNavigation.getState().openEditor();
    },
  });
}
