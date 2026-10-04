import { isDefinedError, safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { EllipsisIcon, FolderIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent } from "react";
import { create } from "zustand";
import { TOAST_MS, useToast } from "@renderer/components/toast";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { FORMAT_LABELS } from "@renderer/editor/labels";
import { cn } from "@renderer/lib/utils";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import { clockLabel, sizeLabel } from "@renderer/new-project/labels";
import type { ProjectSummary } from "../../../contract";
import { fileManagerName, modifiedLabel, trashName } from "./labels";
import { askAboutLock, openProject, useOpeningPath } from "./open-project";

const ROW = "grid grid-cols-[minmax(0,1fr)_104px_60px_68px_76px_136px_28px] items-center gap-4 px-3";

const NO_VALUE = "-";

/** Projects deleted on Home, waiting out their Undo before they go to the Trash. */
const usePendingDeletes = create<{ paths: string[] }>(() => ({ paths: [] }));

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function refreshList() {
  void queryClient.invalidateQueries({ queryKey: orpc.project.list.key() });
}

/** Hides the row at once and moves the folder to the Trash once Undo has had its time. */
function deleteWithUndo({ path, name }: ProjectSummary) {
  usePendingDeletes.setState(({ paths }) => ({ paths: [...paths, path] }));
  pendingTimers.set(
    path,
    setTimeout(() => void commitDelete(path), TOAST_MS),
  );
  useToast.getState().show({
    text: `Moved "${name}" to the ${trashName()}.`,
    action: { label: "Undo", run: () => undoDelete(path) },
  });
}

function undoDelete(path: string) {
  clearTimeout(pendingTimers.get(path));
  pendingTimers.delete(path);
  usePendingDeletes.setState(({ paths }) => ({ paths: paths.filter((pending) => pending !== path) }));
}

async function commitDelete(path: string, { force = false } = {}) {
  pendingTimers.delete(path);
  const { error } = await safe(core.project.delete({ path, force }));
  usePendingDeletes.setState(({ paths }) => ({ paths: paths.filter((pending) => pending !== path) }));
  refreshList();

  if (isDefinedError(error) && error.code === "PROJECT_LOCKED") {
    askAboutLock(error.data, { label: `Move to ${trashName()} anyway`, run: () => void commitDelete(path, { force: true }) });
    return;
  }

  if (error) {
    useToast.getState().show({ text: projectErrorMessage(error) });
  }
}

/** A window closing mid-Undo still deletes what the creator deleted. */
function useCommitDeletesOnLeave() {
  useEffect(() => {
    const flush = () => [...pendingTimers.keys()].forEach((path) => void commitDelete(path));
    window.addEventListener("pagehide", flush);

    return () => window.removeEventListener("pagehide", flush);
  }, []);
}

type ProjectListProps = { projects: ProjectSummary[] };

/** The recent Projects as a table: click a row to open it; its menu renames, duplicates, shows or deletes it. */
export function ProjectList({ projects }: ProjectListProps) {
  const pending = usePendingDeletes((state) => state.paths);
  const [renaming, setRenaming] = useState<string>();
  const shown = projects.filter(({ path }) => !pending.includes(path));

  useCommitDeletesOnLeave();

  return (
    <div role="table" aria-label="Recent Projects" className="flex flex-col">
      <div role="row" className={cn(ROW, "h-8 text-app-xs text-ink-muted")}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Formats</span>
        <span role="columnheader">Length</span>
        <span role="columnheader">Versions</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Modified</span>
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      {shown.map((project) => (
        <ProjectRow
          key={project.path}
          project={project}
          isRenaming={renaming === project.path}
          onRename={() => setRenaming(project.path)}
          onRenamed={() => setRenaming(undefined)}
        />
      ))}
    </div>
  );
}

type ProjectRowProps = {
  project: ProjectSummary;
  isRenaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
};

function ProjectRow({ project, isRenaming, onRename, onRenamed }: ProjectRowProps) {
  const isOpening = useOpeningPath() === project.path;

  async function showMenu() {
    const choice = await window.motionbrief.showContextMenu([
      { id: "open", label: "Open" },
      { id: "rename", label: "Rename" },
      { id: "duplicate", label: "Duplicate" },
      { id: "show", label: `Show in ${fileManagerName()}` },
      { id: "delete", label: `Delete` },
    ]);

    if (choice === "open") {
      void openProject(project.path);
    }

    if (choice === "rename") {
      onRename();
    }

    if (choice === "duplicate") {
      void duplicate(project);
    }

    if (choice === "show") {
      window.motionbrief.showInFolder(project.path);
    }

    if (choice === "delete") {
      deleteWithUndo(project);
    }
  }

  function onRowClick(event: MouseEvent<HTMLDivElement>) {
    if (isRenaming || (event.target as HTMLElement).closest("button, input")) {
      return;
    }

    void openProject(project.path);
  }

  return (
    <div
      role="row"
      className={cn(ROW, "min-h-14 cursor-pointer rounded-lg py-2 transition-colors hover:bg-surface-1", isRenaming && "cursor-default bg-surface-1")}
      onClick={onRowClick}
      onContextMenu={(event) => {
        event.preventDefault();
        void showMenu();
      }}
    >
      <div role="cell" className="flex min-w-0 flex-col gap-0.5">
        {isRenaming ? (
          <RenameField project={project} onDone={onRenamed} />
        ) : (
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 self-start rounded-sm text-left text-app-body font-medium outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
            onClick={() => void openProject(project.path)}
          >
            <span className="truncate">{project.name}</span>
            {isOpening ? <LoaderCircleIcon aria-label="Opening" className="size-3.5 shrink-0 animate-spin text-ink-muted" /> : null}
          </button>
        )}
        {project.location ? (
          <span title={project.location} className="flex min-w-0 items-center gap-1.5 text-app-xs text-ink-muted">
            <FolderIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{project.location}</span>
          </span>
        ) : null}
      </div>
      <div role="cell" className="flex gap-1">
        {project.formats.map((format) => (
          <span key={format} className="rounded-sm bg-surface-2 px-[7px] py-0.5 text-app-xs font-medium text-[#cfcfcf] tabular-nums">
            {FORMAT_LABELS[format]}
          </span>
        ))}
      </div>
      <span role="cell" className="text-app-sm text-ink-muted tabular-nums">
        {project.duration === undefined ? NO_VALUE : clockLabel(project.duration)}
      </span>
      <span role="cell" className="text-app-sm text-ink-muted tabular-nums">
        {project.versions}
      </span>
      <span role="cell" className="text-app-sm text-ink-muted tabular-nums">
        {sizeLabel(project.bytes)}
      </span>
      <span role="cell" className="text-app-sm text-ink-muted">
        {modifiedLabel(project.modifiedAt)}
      </span>
      <div role="cell">
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${project.name}`} onClick={() => void showMenu()}>
          <EllipsisIcon />
        </Button>
      </div>
    </div>
  );
}

async function duplicate({ path }: ProjectSummary) {
  const { data: copy, error } = await safe(core.project.duplicate({ path }));

  if (error) {
    useToast.getState().show({ text: projectErrorMessage(error) });
    return;
  }

  refreshList();
  useToast.getState().show({ text: `Duplicated as "${copy.name}".` });
}

async function renameAnyway(path: string, name: string) {
  const { error } = await safe(core.project.rename({ path, name, force: true }));
  refreshList();

  if (error) {
    useToast.getState().show({ text: projectErrorMessage(error) });
  }
}

/** Renames the Project's folder on Enter or when the field loses focus; Escape keeps the old name. */
function RenameField({ project, onDone }: { project: ProjectSummary; onDone: () => void }) {
  const id = useId();
  const client = useQueryClient();
  const [draft, setDraft] = useState(project.name);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function commit() {
    if (isSaving) {
      return;
    }

    if (draft.trim() === project.name) {
      onDone();
      return;
    }

    setIsSaving(true);
    const { error } = await safe(core.project.rename({ path: project.path, name: draft }));
    setIsSaving(false);

    if (isDefinedError(error) && error.code === "PROJECT_LOCKED") {
      onDone();
      askAboutLock(error.data, { label: "Rename anyway", run: () => void renameAnyway(project.path, draft) });
      return;
    }

    if (error) {
      setError(projectErrorMessage(error));
      return;
    }

    await client.invalidateQueries({ queryKey: orpc.project.list.key() });
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      void commit();
    }

    if (event.key === "Escape") {
      onDone();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        // The field appears because the creator chose Rename; it takes the focus with the name selected.
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Project name"
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={draft}
        disabled={isSaving}
        className="h-8"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <span id={`${id}-error`} className="text-app-xs text-status-fallback-ink">
          {error}
        </span>
      ) : null}
    </div>
  );
}
