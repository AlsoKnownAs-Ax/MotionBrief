import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../../contract";
import { projectsView } from "./projects-view";

const PROJECT: ProjectSummary = {
  path: "C:/Projects/Launch",
  name: "Launch",
  location: "C:/Projects",
  formats: ["horizontal"],
  duration: 42,
  versions: 2,
  bytes: 1_000,
  modifiedAt: 0,
};

/** The Project list query, answered when the test says so. */
function slowProjectList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { promise, resolve, reject } = Promise.withResolvers<ProjectSummary[]>();
  const observer = new QueryObserver(client, { queryKey: ["project", "list"], queryFn: () => promise });
  const settled = new Promise<void>((done) => observer.subscribe((result) => result.status !== "pending" && done()));

  return { view: () => projectsView(observer.getCurrentResult()), settled, resolve, reject };
}

describe("projectsView", () => {
  it("shows the list once a returning creator's Projects load, never the empty state first", async () => {
    const list = slowProjectList();
    expect(list.view()).toEqual({ kind: "loading" });

    list.resolve([PROJECT]);
    await list.settled;

    expect(list.view()).toEqual({ kind: "list", projects: [PROJECT] });
  });

  it("shows the empty state only once the list has loaded empty", async () => {
    const list = slowProjectList();
    expect(list.view()).toEqual({ kind: "loading" });

    list.resolve([]);
    await list.settled;

    expect(list.view()).toEqual({ kind: "empty" });
  });

  it("says the list failed to load instead of claiming there are no Projects", async () => {
    const list = slowProjectList();
    const error = new Error("core went away");

    list.reject(error);
    await list.settled;

    expect(list.view()).toEqual({ kind: "failed", error });
  });
});
