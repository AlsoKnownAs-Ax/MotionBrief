import { useMutation } from "@tanstack/react-query";
import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { useNavigation } from "@renderer/navigation";
import type { Preview } from "../../../contract";

type OpenVideo = {
  /** The open Project's name. */
  projectName: string;
  preview?: Preview;
  /**
   * Word fixes made in the word lane, by word index. They live with the open video until the
   * Project stores its Transcript.
   */
  wordFixes: Record<number, string>;
  open: (projectName: string, preview: Preview) => void;
  fixWord: (index: number, text: string) => void;
};

/** The video the editor shows: one per window. */
export const useOpenVideo = create<OpenVideo>((set) => ({
  projectName: "",
  wordFixes: {},
  open: (projectName, preview) => set({ projectName, preview, wordFixes: {} }),
  fixWord: (index, text) =>
    set(({ wordFixes, preview }) => {
      const spoken = preview?.timeline.words[index]?.text;
      const others = Object.fromEntries(Object.entries(wordFixes).filter(([fixed]) => Number(fixed) !== index));

      if (text === spoken) {
        return { wordFixes: others };
      }

      return { wordFixes: { ...others, [index]: text } };
    }),
}));

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
