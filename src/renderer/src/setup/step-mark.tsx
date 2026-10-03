import { CheckIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/** A step's number, or a check once it's done. */
export function StepMark({ number, isDone }: { number: number; isDone: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-app-xs tabular-nums text-ink-muted",
        isDone && "bg-status-success-tint text-status-success",
      )}
    >
      <StepMarkContent number={number} isDone={isDone} />
    </span>
  );
}

function StepMarkContent({ number, isDone }: { number: number; isDone: boolean }) {
  if (isDone) {
    return (
      <>
        <CheckIcon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Done</span>
      </>
    );
  }

  return number;
}
