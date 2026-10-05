import type { VideoRef } from "../../contract";
import type { Projects, ProjectsError, VideoDocumentError } from "../projects";

type Result<T, E> = { data: T; error: null } | { data: null; error: E };

/** Where each video was last exported to. */
export type ExportLocations = {
  last: (video: VideoRef) => Promise<string | undefined>;
  remember: (video: VideoRef, path: string) => Promise<Result<null, ProjectsError | VideoDocumentError>>;
};

/** The Project keeps each video's last export path in the video's folder (ADR 0004), so it travels with the Project. */
export function projectExportLocations(projects: Projects): ExportLocations {
  return {
    last: async ({ projectId, format }) => {
      const { data: path } = await projects.lastExportPath(projectId, format);

      return path ?? undefined;
    },
    remember: ({ projectId, format }, path) => projects.rememberExportPath(projectId, format, path),
  };
}
