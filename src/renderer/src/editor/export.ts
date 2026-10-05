import { create } from "zustand";
import { core } from "@renderer/core/connection";
import { errorMessage } from "@renderer/lib/utils";
import type { ExportError, ExportStage, Format } from "../../../contract";
import { useOpenVideo } from "./open-video";

/** An export failed outside the render: the core stopped answering mid-export, say. */
type UnexpectedError = { code: "UNEXPECTED"; message: string };

export type ExportJobError = ExportError | UnexpectedError;

/** The window's export: idle, rendering through its stages to `path`, then saved there or failed. */
export type ExportJob = {
  state: "idle" | "rendering" | "done" | "failed";
  stage?: ExportStage;
  /** 0 to 1, across every stage, while rendering. */
  progress?: number;
  /** Where the MP4 goes, once chosen. */
  path?: string;
  error?: ExportJobError;
};

type ExportStore = {
  job: ExportJob;
  /** Asks where to save the open video, then exports it there. */
  start: () => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
};

const MP4_FILTERS = [{ name: "MP4 video", extensions: ["mp4"] }];

/** The Format in a suggested file name; "16:9" can't be part of one on Windows. */
const FILE_NAME_FORMATS = { horizontal: "horizontal", vertical: "vertical" } satisfies Record<Format, string>;

let controller: AbortController | undefined;

/** The open video's export: one at a time per window, carrying on while the creator keeps editing. */
export const useExport = create<ExportStore>((set) => ({
  job: { state: "idle" },
  start: async () => {
    const { projectId, projectName, preview } = useOpenVideo.getState();

    if (!preview || controller) {
      return;
    }

    const current = new AbortController();
    controller = current;

    try {
      const video = { projectId, format: preview.timeline.format };
      const { path: lastPath } = await core.export.lastPath(video);
      const path = await window.motionbrief.chooseSavePath({
        title: "Export MP4",
        defaultPath: lastPath ?? `${projectName} - ${FILE_NAME_FORMATS[video.format]}.mp4`,
        filters: MP4_FILTERS,
      });

      if (!path) {
        return;
      }

      set({ job: { state: "rendering", stage: "preparing", progress: 0, path } });

      for await (const status of await core.export.mp4({ previewId: preview.id, path, video }, { signal: current.signal })) {
        set({ job: { ...status, path: status.path ?? path } });
      }
    } catch (error) {
      if (!current.signal.aborted) {
        set({ job: { state: "failed", error: { code: "UNEXPECTED", message: errorMessage(error) } } });
      }
    } finally {
      controller = undefined;
    }
  },
  cancel: () => {
    controller?.abort();
    set({ job: { state: "idle" } });
  },
  dismiss: () => set({ job: { state: "idle" } }),
}));
