import type { VideoRef } from "../../contract";

/**
 * Where each video was last exported to. The Project keeps it, in the video's folder (ADR 0004);
 * until the Project store lands, the core keeps it in memory.
 */
export type ExportLocations = {
  last: (video: VideoRef) => Promise<string | undefined>;
  remember: (video: VideoRef, path: string) => Promise<void>;
};

export function memoryExportLocations(): ExportLocations {
  const paths = new Map<string, string>();
  const key = ({ projectId, format }: VideoRef) => `${projectId}/${format}`;

  return {
    last: async (video) => paths.get(key(video)),
    remember: async (video, path) => {
      paths.set(key(video), path);
    },
  };
}
