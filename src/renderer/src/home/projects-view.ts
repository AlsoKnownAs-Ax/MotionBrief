import type { ProjectSummary } from "../../../contract";

export type ProjectsView =
  | { kind: "loading" }
  | { kind: "failed"; error: Error }
  | { kind: "empty" }
  | { kind: "list"; projects: ProjectSummary[] };

/** What Home shows for the Project list query: the empty state only once the list has loaded empty. */
export function projectsView({ data, error }: { data?: ProjectSummary[]; error: Error | null }): ProjectsView {
  // A failed refetch keeps the list it already has.
  if (data) {
    return data.length > 0 ? { kind: "list", projects: data } : { kind: "empty" };
  }

  if (error) {
    return { kind: "failed", error };
  }

  return { kind: "loading" };
}
