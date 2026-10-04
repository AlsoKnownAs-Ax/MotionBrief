import { isDefinedError, safe } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, LockIcon } from "lucide-react";
import { create } from "zustand";
import { useToast } from "@renderer/components/toast";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { openStoredVideo } from "@renderer/editor/stored-video";
import { useNavigation } from "@renderer/navigation";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import { sinceLabel } from "./labels";

export type LockedProject = { path: string; name: string; host: string; isThisComputer: boolean; isStale: boolean; lockedAt: number };

type TooNewProject = { path: string; name: string; appVersion?: string };

/** What a locked Project's prompt offers instead of Cancel: "Open anyway", "Rename anyway"... */
type LockedAction = { label: string; run: () => void };

/** What opening, renaming or deleting a Project has to ask the creator first. */
type Prompt = { kind: "locked"; project: LockedProject; action: LockedAction } | { kind: "too-new"; project: TooNewProject };

const useOpenPrompt = create<{ prompt?: Prompt; openingPath?: string }>(() => ({}));

export function useOpeningPath() {
  return useOpenPrompt((state) => state.openingPath);
}

/**
 * Opens a Project folder in this window. A lock held elsewhere or a Project from a newer MotionBrief asks first;
 * anything else that goes wrong is a toast.
 */
export async function openProject(path: string, { force = false } = {}) {
  useOpenPrompt.setState({ prompt: undefined, openingPath: path });
  const { data: opened, error } = await safe(core.project.open({ path, force }));

  if (error) {
    useOpenPrompt.setState({ openingPath: undefined });
  }

  if (isDefinedError(error) && error.code === "PROJECT_LOCKED") {
    askAboutLock(error.data, { label: "Open anyway", run: () => void openProject(path, { force: true }) });
    return;
  }

  if (isDefinedError(error) && error.code === "PROJECT_TOO_NEW") {
    useOpenPrompt.setState({ prompt: { kind: "too-new", project: error.data } });
    return;
  }

  if (error) {
    useToast.getState().show({ text: projectErrorMessage(error) });
    return;
  }

  const { project, backupPath } = opened;

  if (backupPath) {
    useToast.getState().show({ text: `Updated "${project.name}" for this version of MotionBrief. Its old files are in ${backupPath}.` });
  }

  void queryClient.invalidateQueries({ queryKey: orpc.project.list.key() });
  // A Project with a video opens in the editor; the first open after a frame major update re-checks it first.
  const shown = await openStoredVideo(project);
  useOpenPrompt.setState({ openingPath: undefined });

  if (shown === "no-video") {
    useNavigation.getState().openProject(project);
  }
}

/** Asks before changing a Project whose lock says it is open elsewhere; `action` goes ahead anyway. */
export function askAboutLock(project: LockedProject, action: LockedAction) {
  useOpenPrompt.setState({ prompt: { kind: "locked", project, action } });
}

/** Open Project…: a folder from anywhere. */
export async function chooseAndOpenProject() {
  const path = await window.motionbrief.chooseFolder("Open Project");

  if (path) {
    await openProject(path);
  }
}

/** The prompts Home can show: a lock's "Open anyway" (or Rename, Delete), and the newer-Project refusal. */
export function OpenProjectPrompts() {
  const prompt = useOpenPrompt((state) => state.prompt);
  const close = () => useOpenPrompt.setState({ prompt: undefined });

  return (
    <Dialog open={prompt !== undefined} onOpenChange={(isOpen) => !isOpen && close()}>
      {prompt?.kind === "locked" ? <LockedPrompt project={prompt.project} action={prompt.action} onClose={close} /> : null}
      {prompt?.kind === "too-new" ? <TooNewPrompt project={prompt.project} /> : null}
    </Dialog>
  );
}

function LockedPrompt({ project, action, onClose }: { project: LockedProject; action: LockedAction; onClose: () => void }) {
  return (
    // Cancel comes first, so it has the focus: going ahead anyway is a deliberate choice.
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2.5">
          <LockIcon aria-hidden="true" className="size-5 text-status-flagged" />
          This Project may be open somewhere else
        </DialogTitle>
        <DialogDescription>{lockedMessage(project)}</DialogDescription>
      </DialogHeader>
      <p className="text-app-sm text-ink-muted">{lockedRisk(project)}</p>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button
          variant="tertiary"
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.label}
        </Button>
      </div>
    </DialogContent>
  );
}

function lockedMessage({ name, host, isThisComputer, isStale, lockedAt }: LockedProject) {
  const since = sinceLabel(lockedAt);

  if (!isThisComputer) {
    return `"${name}" is locked by MotionBrief on ${host || "another computer"}, ${since}.`;
  }

  if (isStale) {
    return `"${name}" was left locked by MotionBrief on this computer, ${since}. That usually means the app closed unexpectedly, and it is safe to go ahead.`;
  }

  return `"${name}" is open in another MotionBrief on this computer, ${since}.`;
}

function lockedRisk({ isThisComputer, isStale }: LockedProject) {
  if (!isThisComputer) {
    return "If the folder is synced and still open on that computer, changing it here can overwrite that computer's changes.";
  }

  if (isStale) {
    return "If the folder is synced and open on another computer, changing it here can overwrite that computer's changes.";
  }

  return "Changing it here too can overwrite the changes made there. Close it there first if you can.";
}

function TooNewPrompt({ project }: { project: TooNewProject }) {
  const { data: info } = useQuery(orpc.system.info.queryOptions());

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2.5">
          <CircleAlertIcon aria-hidden="true" className="size-5 text-ink-muted" />
          Update MotionBrief to open this Project
        </DialogTitle>
        <DialogDescription>{tooNewMessage(project, info?.appVersion)}</DialogDescription>
      </DialogHeader>
      <p className="text-app-sm text-ink-muted">Nothing in the Project was changed.</p>
      <div className="flex justify-end">
        <DialogClose asChild>
          <Button variant="tertiary">Close</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

function tooNewMessage({ name, appVersion }: TooNewProject, currentVersion?: string) {
  const savedBy = appVersion ? `MotionBrief ${appVersion}` : "a newer MotionBrief";
  const current = currentVersion ? `This is version ${currentVersion}, which` : "This version";

  return `"${name}" was saved by ${savedBy}. ${current} can't open it without risking your work.`;
}
