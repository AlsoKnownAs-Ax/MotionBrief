import { useEffect, useRef } from "react";
import { cn } from "@renderer/lib/utils";

type WordEditorProps = {
  text: string;
  /** The fixed text, or `undefined` when the edit was cancelled. */
  onDone: (text: string | undefined) => void;
  className?: string;
};

/** Edits a Transcript word in place: Enter or leaving the field saves, Escape cancels. */
export function WordEditor({ text, onDone, className }: WordEditorProps) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | undefined) => {
    if (!done.current) {
      done.current = true;
      onDone(value);
    }
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      defaultValue={text}
      aria-label="Fix this word"
      className={cn("shrink-0 rounded-sm border border-primary bg-surface-2 px-1.5 outline-none", className)}
      style={{ width: `${Math.max(6, text.length + 3)}ch` }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        }

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(undefined);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
