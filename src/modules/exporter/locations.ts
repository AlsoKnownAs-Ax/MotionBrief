import type { VideoRef } from "../../contract";
import type { Projects } from "../projects";

/** Where each video was last exported to. */
export type ExportLocations = {
  last: (video: VideoRef) => Promise<string | undefined>;
  remember: (video: VideoRef, path: string) => Promise<void>;
};

/** The Project keeps each video's last export path in the video's folder (ADR 0004), so it travels with the Project. */
export function projectExportLocations(projects: Projects): ExportLocations {
  return {
    last: async ({ projectId, format }) => {
      const { data: path } = await projects.lastExportPath(projectId, format);

      return path ?? undefined;
    },
    remember: async ({ projectId, format }, path) => {
      const { error } = await projects.rememberExportPath(projectId, format, path);

      if (error) {
        throw new Error(`The Project didn't save the export path: ${JSON.stringify(error)}`);
      }
    },
  };
}
