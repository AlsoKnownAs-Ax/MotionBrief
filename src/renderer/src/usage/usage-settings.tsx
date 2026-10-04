import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useClaudeStatus } from "@renderer/claude/connection";
import { Input } from "@renderer/components/ui/input";
import { core, orpc, queryClient } from "@renderer/core/connection";
import { Select } from "@renderer/style/controls";
import { MODEL_CHOICES, type Settings, type SettingsChanges } from "../../../contract";
import { dollars, ROLE_LABELS, ROLES } from "./labels";

const MODEL_OPTIONS = MODEL_CHOICES.map(({ id, label }) => ({ value: id as string, label }));

function useSettings() {
  const { data: settings } = useQuery(orpc.settings.get.queryOptions());
  const update = useMutation({
    mutationFn: (changes: SettingsChanges) => core.settings.update(changes),
    onSuccess: (saved) => {
      queryClient.setQueryData(orpc.settings.get.queryKey(), saved);
      // Whether Generate needs approving follows the approval setting.
      void queryClient.invalidateQueries({ queryKey: orpc.video.estimate.key() });
    },
  });

  return { settings, update };
}

/** The model each agent role runs on; a change applies from the next run. */
export function ModelSettings() {
  const { settings, update } = useSettings();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-app-sm font-medium">
        Models
      </h3>
      <dl className="flex flex-col">
        {ROLES.map((role) => (
          <Field key={role} label={ROLE_LABELS[role]}>
            {(id) => (
              <Select
                id={id}
                className="w-36"
                value={settings?.models[role] ?? ""}
                options={MODEL_OPTIONS}
                onChange={(model) => update.mutate({ models: { [role]: model } })}
              />
            )}
          </Field>
        ))}
      </dl>
      <p className="text-app-xs text-ink-muted">Retry runs on the Scene code model. A run already going keeps the models it started with.</p>
      {update.error ? (
        <p role="alert" className="text-app-xs text-status-fallback-ink">
          Couldn't save the settings: {update.error.message}
        </p>
      ) : null}
    </section>
  );
}

/** API key only: approval before a run that costs money, and a cap on what one run may cost. */
export function CostSettings() {
  const { data: connection } = useClaudeStatus();
  const { settings, update } = useSettings();
  const headingId = useId();

  if (connection?.method !== "api-key" || !settings) {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3 id={headingId} className="text-app-sm font-medium">
        Cost
      </h3>
      <dl className="flex flex-col">
        <Field label="Approve cost before running">
          {(id) => (
            <input
              id={id}
              type="checkbox"
              checked={settings.approveCost}
              onChange={(event) => update.mutate({ approveCost: event.target.checked })}
              className="size-4 accent-[var(--brand)]"
            />
          )}
        </Field>
        <Field label="Stop a run above">
          {(id) => <CapInput key={settings.costCapUsd ?? "none"} id={id} settings={settings} onSave={(costCapUsd) => update.mutate({ costCapUsd })} />}
        </Field>
      </dl>
      <p className="text-app-xs text-ink-muted">
        The cap adds up every agent a run starts at once. Reaching it stops the run as Stop does: finished Scenes are kept. Leave it empty for no cap.
      </p>
    </section>
  );
}

/** Dollars, saved on Enter or when it loses focus; empty removes the cap. */
function CapInput({ id, settings, onSave }: { id: string; settings: Settings; onSave: (costCapUsd: number | null) => void }) {
  const saved = settings.costCapUsd === undefined ? "" : settings.costCapUsd.toFixed(2);
  const [text, setText] = useState(saved);
  const amount = Number(text);
  const isValid = text.trim() === "" || (Number.isFinite(amount) && amount > 0);

  function save(event?: FormEvent) {
    event?.preventDefault();

    if (!isValid || text === saved) {
      return;
    }

    onSave(text.trim() === "" ? null : amount);
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <span aria-hidden="true" className="text-app-sm text-ink-muted">
        $
      </span>
      <Input
        id={id}
        inputMode="decimal"
        placeholder="No cap"
        value={text}
        aria-invalid={!isValid}
        aria-describedby={isValid ? undefined : `${id}-error`}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => save()}
        className="h-control-sm w-24 text-app-sm tabular-nums"
      />
      {isValid ? null : (
        <span id={`${id}-error`} role="alert" className="text-app-xs text-status-fallback-ink">
          Use an amount above {dollars(0)}
        </span>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();

  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-hairline-soft last:border-0">
      <dt className="flex-1 text-app-sm">
        <label htmlFor={id}>{label}</label>
      </dt>
      <dd className="flex items-center gap-1">{children(id)}</dd>
    </div>
  );
}
