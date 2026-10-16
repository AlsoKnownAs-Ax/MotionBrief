import { useQueries } from "@tanstack/react-query";
import { orpc } from "@renderer/core/connection";
import { usePresets } from "@renderer/style/presets";
import type { PresetSound, StylePreset } from "../../../contract";
import { isGenerating, useGeneration } from "./generation";
import type { LibraryAsset } from "./library";
import { useOpenVideo } from "./open-video";
import { isRevising, useRevision } from "./revision";
import { useStyleChange } from "./style-tab";

/** The open Project's Asset inputs, or none for a video that isn't a stored Project, such as the fixture. */
export function useProjectScope() {
  const projectId = useOpenVideo((state) => state.projectId);
  const isStored = useOpenVideo((state) => state.isStored);

  if (!isStored) {
    return undefined;
  }

  return projectId;
}

/** Every Asset the Library can show: the open Project's, the Library's and the bundled set. */
export function useAssets() {
  const projectId = useProjectScope();
  const results = useQueries({
    queries: [
      { ...orpc.assets.list.queryOptions({ input: { scope: "project", projectId: projectId ?? "" } }), enabled: projectId !== undefined },
      orpc.assets.list.queryOptions({ input: { scope: "library" } }),
      orpc.assets.list.queryOptions({ input: { scope: "bundled" } }),
    ],
  });
  const scopes = ["project", "library", "bundled"] as const;
  const assets: LibraryAsset[] = results.flatMap(({ data }, index) => (data ?? []).map((asset) => ({ ...asset, scope: scopes[index]! })));

  return { assets, error: results.find(({ error }) => error)?.error };
}

/**
 * The video's sound and a way to change it. Each change is a swap, a re-render with no agent that saves a Version, so
 * a music bed picked here is this video's alone.
 */
export function useVideoSound() {
  const video = useGeneration((state) => state.video);
  const preset = useGeneration((state) => state.stored?.preset);
  const generating = useGeneration((state) => isGenerating(state.status));
  const revising = useRevision((state) => isRevising(state.status));
  const { change, isChanging, error } = useStyleChange(video);
  const sound = useSoundOf(preset);
  const set = (changes: Partial<PresetSound>) => {
    if (preset && sound) {
      void change({ preset: { ...preset, sound: { ...sound, ...changes } } });
    }
  };

  return { sound, set, isBusy: generating || revising || isChanging, error };
}

/** The video's sound: its snapshot's, or for a snapshot from before Presets had sound, its bundled Preset's. */
function useSoundOf(preset: StylePreset | undefined): PresetSound | undefined {
  const { data: presets = [] } = usePresets();

  return preset?.sound ?? (presets.find(({ id }) => id === preset?.id) ?? presets[0])?.sound;
}
