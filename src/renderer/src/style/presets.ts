import { keepPreviousData, skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { core, orpc, queryClient } from "@renderer/core/connection";
import type { StylePreset } from "../../../contract";

/** The Preset being edited, if any; the editor is its own modal over Settings. */
export const usePresetEditor = create<{ editingId?: string; edit: (id?: string) => void }>((set) => ({
  edit: (editingId) => set({ editingId }),
}));

function refreshPresets() {
  return queryClient.invalidateQueries({ queryKey: orpc.style.presets.queryKey() });
}

export function usePresets() {
  return useQuery(orpc.style.presets.queryOptions());
}

export function useDuplicatePreset() {
  const edit = usePresetEditor((state) => state.edit);

  return useMutation({
    mutationFn: (id: string) => core.style.duplicate({ id }),
    onSuccess: async (copy) => {
      await refreshPresets();
      edit(copy.id);
    },
  });
}

export function useSavePreset() {
  return useMutation({ mutationFn: (preset: StylePreset) => core.style.save({ preset }), onSuccess: refreshPresets });
}

export function useRemovePreset() {
  return useMutation({ mutationFn: (id: string) => core.style.remove({ id }), onSuccess: refreshPresets });
}

/** The still of a Preset's sample, drawn by the core in the bundled frame; the same Preset always draws the same. */
export function usePresetSample(preset: StylePreset | undefined) {
  return useQuery(
    orpc.style.sample.queryOptions({
      input: preset ? { preset } : skipToken,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      retry: false,
    }),
  );
}
