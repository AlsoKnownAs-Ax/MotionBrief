import { RadioGroup } from "radix-ui";
import { useId, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import type { Option } from "./labels";

/** A titled group of pickers in the Preset editor. */
export function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-hairline-soft pb-5 last:border-0">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-app-sm font-medium">
          {title}
        </h3>
        {help ? <p className="text-app-xs text-ink-muted">{help}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled row: the label on the left, its picker on the right. */
export function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();

  return (
    <div className="flex min-h-9 items-center gap-3">
      <label htmlFor={id} id={`${id}-label`} className="w-28 shrink-0 text-app-sm text-ink-muted">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children(id)}</div>
    </div>
  );
}

/** One of a few choices as a pill toggle, like the Format choice in New Project. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void }) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      orientation="horizontal"
      className="flex flex-1 gap-1 rounded-pill bg-surface-2 p-1"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className="flex h-[26px] flex-1 items-center justify-center rounded-pill px-2 text-app-xs whitespace-nowrap text-ink-muted outline-none transition-colors hover:text-ink focus-visible:shadow-[0_0_0_1px_var(--brand)] data-[state=checked]:bg-surface-3 data-[state=checked]:text-ink"
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

const SELECT_CLASSES =
  "h-control-sm w-full rounded-md bg-surface-2 px-2.5 text-app-sm text-ink outline-none focus-visible:shadow-[0_0_0_1px_var(--brand)] disabled:opacity-40";

export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={String(value)}
      onChange={(event) => onChange(options.find((option) => String(option.value) === event.target.value)?.value ?? value)}
      className={cn(SELECT_CLASSES, className)}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A whole-number slider with its value beside it. */
export function Slider({ id, value, min, max, unit, onChange }: { id: string; value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-[var(--brand)]"
      />
      <span className="w-12 text-right text-app-xs text-ink-muted tabular-nums">
        {value}
        {unit}
      </span>
    </>
  );
}
