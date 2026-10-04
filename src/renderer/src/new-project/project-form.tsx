import { FileAudioIcon, FileVideoIcon, TriangleAlertIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/utils";
import { PresetSample } from "@renderer/style/preset-sample";
import { usePresets } from "@renderer/style/presets";
import type { Format, Project, TranscriptionStatus } from "../../../contract";
import { clockLabel, FORMAT_OPTIONS, LANGUAGES, languageName, sizeLabel } from "./labels";
import { presetBlurb } from "./presets";

export type ProjectChanges = { name?: string; format?: Format; stylePreset?: string; language?: string };

type ProjectFormProps = {
  project: Project;
  transcription?: TranscriptionStatus;
  /** Saves changes; resolves to an error message when they were refused. */
  onChange: (changes: ProjectChanges) => Promise<string | undefined>;
};

/** The New Project choices. Every change saves at once; there is no Save button. */
export function ProjectForm({ project, transcription, onChange }: ProjectFormProps) {
  return (
    <div className="flex flex-col gap-6">
      <VoiceoverRow project={project} />
      <NameField project={project} onChange={onChange} />
      <Field label="Format" help="You can add the other Format later, from the same Transcript.">
        <FormatChoice value={project.format} onChange={(format) => void onChange({ format })} />
      </Field>
      <Field label="Style Preset" help={`${presetBlurb(project.stylePreset)}. Palette and typography can change later without the agent.`}>
        <PresetChoices value={project.stylePreset} onChange={(stylePreset) => void onChange({ stylePreset })} />
      </Field>
      <LanguageField project={project} transcription={transcription} onChange={(language) => void onChange({ language })} />
    </div>
  );
}

function FileIcon({ isVideo }: { isVideo: boolean }) {
  if (isVideo) {
    return <FileVideoIcon aria-hidden="true" className="size-[18px] shrink-0 text-ink-muted" />;
  }

  return <FileAudioIcon aria-hidden="true" className="size-[18px] shrink-0 text-ink-muted" />;
}

function VoiceoverRow({ project: { voiceover } }: { project: Project }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2.5">
        <FileIcon isVideo={voiceover.isVideo} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-app-sm">{voiceover.fileName}</span>
          <span className="text-app-xs text-ink-muted tabular-nums">
            {clockLabel(voiceover.duration)} · {sizeLabel(voiceover.bytes)}
            {voiceover.isVideo ? " · only its audio is used" : null}
          </span>
        </div>
      </div>
      {voiceover.isLong ? (
        <p className="flex items-start gap-2 text-app-xs text-status-flagged">
          <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          This Voiceover is over 20 minutes. Generating it will take a long time and cost more.
        </p>
      ) : null}
    </div>
  );
}

/** Renames the Project, and its folder, when the field loses focus or on Enter; Escape puts the name back. */
function NameField({ project, onChange }: { project: Project; onChange: ProjectFormProps["onChange"] }) {
  const id = useId();
  const [draft, setDraft] = useState(project.name);
  const [error, setError] = useState<string>();
  const [isRenaming, setIsRenaming] = useState(false);

  async function commit() {
    if (draft === project.name) {
      setError(undefined);
      return;
    }

    setIsRenaming(true);
    setError(await onChange({ name: draft }));
    setIsRenaming(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      setDraft(project.name);
      setError(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-app-sm font-medium">
        Project name
      </label>
      <Input
        id={id}
        value={draft}
        aria-invalid={error !== undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
      <span id={`${id}-help`} className={cn("text-app-xs text-ink-muted", error && "text-status-fallback-ink")}>
        {nameHelp({ project, error, isRenaming })}
      </span>
    </div>
  );
}

function nameHelp({ project, error, isRenaming }: { project: Project; error?: string; isRenaming: boolean }) {
  if (isRenaming) {
    return "Renaming the Project folder…";
  }

  return error ?? `Saved to ${project.path}`;
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  const id = useId();

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <span id={id} className="text-app-sm font-medium">
        {label}
      </span>
      {children}
      <span className="text-app-xs text-ink-muted">{help}</span>
    </div>
  );
}

function FormatChoice({ value, onChange }: { value: Format; onChange: (format: Format) => void }) {
  return (
    <RadioGroup.Root
      aria-label="Format"
      value={value}
      onValueChange={(format) => onChange(format as Format)}
      orientation="horizontal"
      className="grid grid-cols-2 gap-1 rounded-pill bg-surface-2 p-1"
    >
      {FORMAT_OPTIONS.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className="flex h-control-sm items-center justify-center gap-1.5 rounded-pill text-app-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:shadow-[0_0_0_1px_var(--brand)] data-[state=checked]:bg-surface-3 data-[state=checked]:text-ink"
        >
          <span className="font-medium tabular-nums">{option.ratio}</span>
          <span>· {option.use}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** The core's Style Presets, Blueprint first, each shown as the bundled frame draws it. */
function PresetChoices({ value, onChange }: { value: string; onChange: (stylePreset: string) => void }) {
  const { data: presets = [] } = usePresets();

  return (
    <RadioGroup.Root aria-label="Style Preset" value={value} onValueChange={onChange} className="grid grid-cols-2 gap-2">
      {presets.map((preset) => (
        <RadioGroup.Item
          key={preset.id}
          value={preset.id}
          className="group flex flex-col gap-2 rounded-lg bg-surface-2 p-2 text-left outline-none transition-shadow hover:bg-surface-3 focus-visible:shadow-[0_0_0_1px_var(--brand)] data-[state=checked]:shadow-[0_0_0_2px_var(--brand)]"
        >
          <PresetSample preset={preset} />
          <span className="truncate px-0.5 text-app-sm">{preset.name}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

type LanguageFieldProps = {
  project: Project;
  transcription?: TranscriptionStatus;
  onChange: (language: string) => void;
};

function LanguageField({ project, transcription, onChange }: LanguageFieldProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-app-sm font-medium">
        Language
      </label>
      <select
        id={id}
        value={project.language}
        onChange={(event) => onChange(event.target.value)}
        className="h-input w-full rounded-md bg-surface-2 px-3 text-app-body text-ink outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)]"
      >
        <option value="auto">Auto-detect</option>
        {LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {languageName(code)}
          </option>
        ))}
      </select>
      <span className="text-app-xs text-ink-muted">
        {detectedLabel(project, transcription)}Captions and on-screen copy follow it. English is the only tested language so far.
      </span>
    </div>
  );
}

/** "Detected German. " once auto-detection has an answer. */
function detectedLabel(project: Project, transcription?: TranscriptionStatus) {
  if (project.language !== "auto" || !transcription?.language) {
    return "";
  }

  return `Detected ${languageName(transcription.language)}. `;
}
