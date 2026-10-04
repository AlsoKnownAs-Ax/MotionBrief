import { CheckIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

type StepMarkProps = {
  number: number;
  done?: boolean;
  size?: "default" | "sm";
};

/** The step's number, or a check once it is done. */
export function StepMark({ number, done = false, size = "default" }: StepMarkProps) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-ink",
        size === "sm" && "size-[22px] text-[11px]",
        size === "default" && "size-7 text-app-sm",
        done && "bg-status-success-tint text-status-success",
      )}
    >
      {done ? <CheckIcon aria-label="Done" className="size-[15px]" /> : number}
    </span>
  );
}
