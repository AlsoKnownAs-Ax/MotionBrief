import { safe } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, AudioLinesIcon, CheckIcon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@renderer/components/ui/button";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { useGeneration } from "@renderer/editor/generation";
import { cn } from "@renderer/lib/utils";
import { useNavigation } from "@renderer/navigation";
import { GenerateBar } from "@renderer/new-project/generate-bar";
import { projectErrorMessage } from "@renderer/new-project/project-errors";
import { ProjectForm, type ProjectChanges } from "@renderer/new-project/project-form";
import { TranscriptPane, type FixWord } from "@renderer/new-project/transcript-pane";
import { chooseVoiceover, useFileDrop } from "@renderer/new-project/voiceover-file";
import type { Project } from "../../../contract";

/**
 * New Project: a Voiceover makes a Project folder and starts transcribing at once, while the creator names it and
 * picks its Format, Style Preset and language. Every choice saves as it changes. Generate hands the Project to the editor.
 */
export function NewProject() {
  const droppedVoiceover = useNavigation((state) => state.droppedVoiceover);
  const openedProject = useNavigation((state) => state.openedProject);
  const openHome = useNavigation((state) => state.openHome);
  const [project, setProject] = useState<Project | undefined>(openedProject);
  const [savesRunning, setSavesRunning] = useState(0);
  const create = useMutation({ mutationFn: (voiceoverPath: string) => core.project.create({ voiceoverPath }), onSuccess: setProject });
  const started = useRef<string>(undefined);

  /** Each Voiceover makes one Project, even when React runs effects twice. */
  function start(voiceoverPath: string) {
    if (started.current === voiceoverPath) {
      return;
    }

    started.current = voiceoverPath;
    create.mutate(voiceoverPath);
  }

  useEffect(() => {
    if (droppedVoiceover) {
      start(droppedVoiceover);
    }
    // Only a new drop starts a Project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedVoiceover]);

  useCloseOnLeave(project?.id);

  /** The editor follows the generation and keeps the Project open. */
  function openGenerating(generating: Project) {
    useGeneration.getState().follow(generating, { projectId: generating.id, format: generating.format });
    useNavigation.getState().openEditor();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline-soft px-3">
        <Button variant="ghost" size="icon-sm" aria-label="Back to Home" onClick={openHome}>
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 truncate text-app-body font-medium">{openedProject ? project?.name : "New Project"}</h1>
        {project ? <SavedStatus isSaving={savesRunning > 0} /> : null}
      </div>
      {project ? (
        <ProjectEditor
          project={project}
          onProject={setProject}
          onSaving={(isSaving) => setSavesRunning((running) => running + (isSaving ? 1 : -1))}
          onGenerating={() => openGenerating(project)}
        />
      ) : null}
      {project ? null : <VoiceoverDrop isCreating={create.isPending} error={create.error} onVoiceover={start} />}
    </div>
  );
}

/**
 * Releases the Project's lock when the creator leaves the screen, unless the editor took the Project over; Home then
 * lists it as it was left.
 */
function useCloseOnLeave(projectId: string | undefined) {
  useEffect(() => {
    if (!projectId) {
      return;
    }

    return () => {
      if (useNavigation.getState().screen !== "editor") {
        void safe(core.project.close({ projectId })).then(() => queryClient.invalidateQueries({ queryKey: orpc.project.list.key() }));
      }
    };
  }, [projectId]);
}

/** Every change saves as it is made, so the toolbar says so instead of offering a Save button. */
function SavedStatus({ isSaving }: { isSaving: boolean }) {
  if (isSaving) {
    return (
      <span role="status" className="flex shrink-0 items-center gap-1.5 text-app-xs text-ink-muted">
        <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
        Saving
      </span>
    );
  }

  return (
    <span role="status" className="flex shrink-0 items-center gap-1.5 text-app-xs text-ink-muted">
      <CheckIcon aria-hidden="true" className="size-3.5" />
      Saved
    </span>
  );
}

type VoiceoverDropProps = { isCreating: boolean; error: unknown; onVoiceover: (path: string) => void };

function VoiceoverDrop({ isCreating, error, onVoiceover }: VoiceoverDropProps) {
  const drop = useFileDrop(onVoiceover);

  async function choose() {
    const path = await chooseVoiceover();

    if (path) {
      onVoiceover(path);
    }
  }

  if (isCreating) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p role="status" className="flex items-center gap-2.5 text-app-body text-ink-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Copying the Voiceover into its Project folder…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-10" {...drop.handlers}>
      <div
        className={cn(
          "flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface-1 px-10 py-12 text-center transition-colors",
          drop.isOver && "border-primary bg-surface-2",
        )}
      >
        <AudioLinesIcon aria-hidden="true" className="size-6 text-ink-muted" />
        <h2 className="text-app-title">Drop a Voiceover</h2>
        <p className="max-w-[48ch] text-app-sm text-ink-muted">
          Any audio or video file FFmpeg can read, such as WAV, MP3, M4A or MP4. It’s copied into the Project folder; your original stays
          where it is.
        </p>
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-left text-app-sm text-status-fallback-ink">
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {projectErrorMessage(error)}
          </p>
        ) : null}
        <Button variant="primary" className="mt-1" onClick={() => void choose()}>
          Choose file…
        </Button>
      </div>
    </div>
  );
}

type ProjectEditorProps = {
  project: Project;
  onProject: (project: Project) => void;
  onSaving: (isSaving: boolean) => void;
  onGenerating: () => void;
};

function ProjectEditor({ project, onProject, onSaving, onGenerating }: ProjectEditorProps) {
  const { data: transcription } = useQuery(orpc.project.transcription.experimental_liveOptions({ input: { projectId: project.id } }));

  /** Shows a choice at once, then whatever the core saved; a new name waits for its folder to be renamed. */
  async function change(changes: ProjectChanges) {
    onProject(withChoices(project, changes));
    onSaving(true);
    const { data: saved, error } = await safe(core.project.update({ projectId: project.id, ...changes }));
    onSaving(false);

    if (error) {
      onProject(project);

      return projectErrorMessage(error);
    }

    onProject(saved);

    return undefined;
  }

  /** The Transcript stream shows the fix too, once it is saved. */
  const fixWord: FixWord = async (index, text) => {
    onSaving(true);
    const { data: saved, error } = await safe(core.project.fixWord({ projectId: project.id, index, text }));
    onSaving(false);

    if (error) {
      return { error: projectErrorMessage(error) };
    }

    return { text: saved.text };
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 gap-5 p-5">
        <div className="w-[360px] shrink-0 overflow-y-auto pr-1">
          <ProjectForm project={project} transcription={transcription} onChange={change} />
        </div>
        <TranscriptPane
          transcription={transcription}
          onRetry={() => void safe(core.project.retryTranscription({ projectId: project.id }))}
          onFixWord={fixWord}
        />
      </div>
      <GenerateBar project={project} transcription={transcription} onGenerating={onGenerating} />
    </>
  );
}

function withChoices(project: Project, { format, stylePreset, language }: ProjectChanges): Project {
  return {
    ...project,
    format: format ?? project.format,
    stylePreset: stylePreset ?? project.stylePreset,
    language: language ?? project.language,
  };
}
