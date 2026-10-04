import { useQuery } from "@tanstack/react-query";
import { AudioLinesIcon, FlaskConicalIcon, FolderOpenIcon, PlusIcon, UploadIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ShortcutKeys } from "@renderer/components/shortcut-keys";
import { Button } from "@renderer/components/ui/button";
import { orpc } from "@renderer/core/connection";
import { useOpenFixtureProject } from "@renderer/editor/open-video";
import { chooseAndOpenProject, OpenProjectPrompts } from "@renderer/home/open-project";
import { ProjectList } from "@renderer/home/project-list";
import { cn } from "@renderer/lib/utils";
import { useNavigation } from "@renderer/navigation";
import { chooseVoiceover, useFileDrop } from "@renderer/new-project/voiceover-file";
import { SetupChecklist } from "@renderer/setup/checklist";
import type { ProjectSummary } from "../../../contract";
import { SHORTCUTS } from "../../../shared/shortcuts";

const NO_VALUE = "–";

function uptimeLabel(startedAt?: number, now?: number) {
  if (startedAt === undefined || now === undefined) {
    return NO_VALUE;
  }

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

/** `format(value)`, or a dash while the value hasn't arrived. */
function labelOrDash<T>(value: T | undefined, format: (value: T) => string) {
  if (value === undefined) {
    return NO_VALUE;
  }

  return format(value);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-6 border-b border-hairline-soft last:border-0">
      <dt className="text-app-sm text-ink-muted">{label}</dt>
      <dd className="text-app-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Where a first Project starts: drop a Voiceover, or choose one. */
function StartWithVoiceover() {
  const openNewProject = useNavigation((state) => state.openNewProject);

  async function choose() {
    const path = await chooseVoiceover();

    if (path) {
      openNewProject(path);
    }
  }

  return (
    <section className="flex w-full max-w-3xl flex-col items-center gap-3 rounded-lg border border-dashed border-hairline bg-surface-1 px-8 py-10 text-center">
      <AudioLinesIcon aria-hidden="true" className="size-6 text-ink-muted" />
      <h2 className="text-app-title">Start with a Voiceover</h2>
      <p className="max-w-[52ch] text-app-sm text-ink-muted">
        Drop a recording anywhere on this window, or choose one. MotionBrief transcribes it on this computer and turns it into a
        motion-graphics video you revise by asking.
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button variant="ghost" onClick={() => void chooseAndOpenProject()}>
          <FolderOpenIcon />
          Open Project…
        </Button>
        <Button variant="primary" onClick={() => void choose()}>
          <PlusIcon />
          New Project
        </Button>
      </div>
    </section>
  );
}

/** Covers the window while a file is dragged over it. */
function DropOverlay({ isOver }: { isOver: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border border-dashed border-primary bg-canvas/85 opacity-0 transition-opacity duration-150",
        isOver && "opacity-100",
      )}
    >
      <span className="flex items-center gap-2.5 text-app-title">
        <AudioLinesIcon className="size-6 text-primary" />
        Drop to start a new Project
      </span>
    </div>
  );
}

/** Projects, Open Project… and New Project, over the recent Projects. */
function RecentProjects({ projects }: { projects: ProjectSummary[] }) {
  const openNewProject = useNavigation((state) => state.openNewProject);

  async function choose() {
    const path = await chooseVoiceover();

    if (path) {
      openNewProject(path);
    }
  }

  return (
    <section aria-labelledby="projects-heading" className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <h1 id="projects-heading" className="text-app-title">
          Projects
        </h1>
        <span className="flex-1" />
        <Button variant="tertiary" onClick={() => void chooseAndOpenProject()}>
          <FolderOpenIcon />
          Open Project…
        </Button>
        <Button variant="primary" onClick={() => void choose()}>
          <PlusIcon />
          New Project
        </Button>
      </div>
      <ProjectList projects={projects} />
      <p className="flex items-center gap-2 text-app-xs text-ink-muted">
        <UploadIcon aria-hidden="true" className="size-3.5" />
        Drop a Voiceover anywhere on this window to start a new Project. Projects are plain folders you can move, sync or copy.
      </p>
    </section>
  );
}

/** Home: the setup checklist, the recent Projects, and the way into a new one. */
export function Home() {
  const info = useQuery(orpc.system.info.queryOptions());
  const heartbeat = useQuery(orpc.system.heartbeat.experimental_liveOptions());
  const projects = useQuery(orpc.project.list.queryOptions());
  const openNewProject = useNavigation((state) => state.openNewProject);
  const drop = useFileDrop(openNewProject);
  const hasProjects = (projects.data?.length ?? 0) > 0;

  return (
    <main
      className={cn("relative flex flex-1 flex-col items-center gap-8 overflow-y-auto p-10", !hasProjects && "justify-center")}
      {...drop.handlers}
    >
      <SetupChecklist />
      {hasProjects ? <RecentProjects projects={projects.data ?? []} /> : <StartWithVoiceover />}

      <section aria-label="Core" className="w-full max-w-sm rounded-lg bg-surface-1 px-3 py-1">
        <dl className="flex flex-col">
          <Fact label="App version">{labelOrDash(info.data?.appVersion, (version) => version)}</Fact>
          <Fact label="Core process">{labelOrDash(info.data?.pid, (pid) => `pid ${pid}`)}</Fact>
          <Fact label="Core uptime">{uptimeLabel(info.data?.startedAt, heartbeat.data?.at)}</Fact>
          <Fact label="Heartbeat">{labelOrDash(heartbeat.data?.seq, (seq) => `#${seq}`)}</Fact>
        </dl>
      </section>

      {import.meta.env.DEV && <OpenFixtureProject />}

      <p className="flex items-center gap-2 text-app-xs text-ink-muted">
        <ShortcutKeys shortcut={SHORTCUTS.showShortcuts} />
        Keyboard shortcuts
      </p>
      <DropOverlay isOver={drop.isOver} />
      <OpenProjectPrompts />
    </main>
  );
}

/** Development builds only: opens the fixture Project in the editor, until Projects open from disk. */
function OpenFixtureProject() {
  const openFixture = useOpenFixtureProject();

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="tertiary" disabled={openFixture.isPending} onClick={() => openFixture.mutate()}>
        <FlaskConicalIcon />
        {openFixture.isPending ? "Opening the fixture Project" : "Open the fixture Project"}
      </Button>
      {openFixture.error && (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          {openFixture.error.message}
        </p>
      )}
    </div>
  );
}
