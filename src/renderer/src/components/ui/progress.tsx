import { cva, type VariantProps } from "class-variance-authority";
import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/** A thin bar on surface-3. Work in progress is violet (DESIGN.md status-working); anything stopped is muted; amber warns. */
const indicatorVariants = cva("h-full w-full rounded-pill transition-transform duration-300 ease-out-expo", {
  variants: {
    status: {
      working: "bg-status-working",
      neutral: "bg-ink-muted",
      flagged: "bg-status-flagged",
    },
  },
  defaultVariants: {
    status: "working",
  },
});

type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof indicatorVariants> & {
    /** 0 to 100. */
    value: number;
  };

function Progress({ className, value, status, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative h-1 w-full overflow-hidden rounded-pill bg-surface-3", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={indicatorVariants({ status })}
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
