import { useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import type { ListedPreset } from "../../../contract";
import { presetErrorMessage } from "./labels";
import { PresetSample } from "./preset-sample";
import { useDuplicatePreset, usePresetEditor, usePresets, useRemovePreset } from "./presets";

/** Settings → Style Presets: the bundled ones to duplicate, and the creator's own to edit or delete. */
export function PresetSettings() {
  const { data: presets = [] } = usePresets();
  const duplicate = useDuplicatePreset();
  const remove = useRemovePreset();
  const error = duplicate.error ?? remove.error;

  return (
    <section aria-labelledby="settings-presets" className="flex flex-col gap-1">
      <h3 id="settings-presets" className="text-app-sm font-medium">
        Style Presets
      </h3>
      <ul className="flex flex-col">
        {presets.map((preset) => (
          <PresetRow key={preset.id} preset={preset} onDuplicate={() => duplicate.mutate(preset.id)} onRemove={() => remove.mutate(preset.id)} isBusy={duplicate.isPending || remove.isPending} />
        ))}
      </ul>
      <p className="text-app-xs text-ink-muted">
        {error ? presetErrorMessage(error) : "Duplicate a Preset to make your own. Videos keep the look they were made with."}
      </p>
    </section>
  );
}

type PresetRowProps = { preset: ListedPreset; onDuplicate: () => void; onRemove: () => void; isBusy: boolean };

function PresetRow({ preset, onDuplicate, onRemove, isBusy }: PresetRowProps) {
  const edit = usePresetEditor((state) => state.edit);
  const [isConfirming, setIsConfirming] = useState(false);

  if (isConfirming) {
    return (
      <li className="flex min-h-14 items-center gap-3 border-b border-hairline-soft last:border-0">
        <span className="flex-1 text-app-sm">Delete “{preset.name}”? Videos made with it keep their look.</span>
        <Button variant="ghost" size="sm" onClick={() => setIsConfirming(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={isBusy} onClick={onRemove}>
          Delete
        </Button>
      </li>
    );
  }

  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-hairline-soft last:border-0">
      <PresetSample preset={preset} className="w-16 shrink-0 rounded-sm" />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-app-sm">{preset.name}</span>
        {preset.readOnly ? <Badge>Bundled</Badge> : null}
      </span>
      <Button variant="ghost" size="sm" disabled={isBusy} onClick={onDuplicate}>
        Duplicate
      </Button>
      {preset.readOnly ? null : (
        <>
          <Button variant="ghost" size="sm" onClick={() => edit(preset.id)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsConfirming(true)}>
            Delete
          </Button>
        </>
      )}
    </li>
  );
}
