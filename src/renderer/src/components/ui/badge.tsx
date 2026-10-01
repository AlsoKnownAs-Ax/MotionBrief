import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/** DESIGN.md app-badge-*: status reads from a tinted ground and colored text, never fill alone. */
const badgeVariants = cva(
  "inline-flex h-badge max-w-full shrink-0 items-center gap-[5px] overflow-hidden rounded-sm px-[7px] text-app-xs font-medium whitespace-nowrap",
  {
    variants: {
      status: {
        neutral: "bg-surface-2 text-ink-muted",
        working: "bg-status-working/16 text-status-working-ink",
        flagged: "bg-status-flagged/12 text-status-flagged",
        fallback: "bg-status-fallback/14 text-status-fallback-ink",
        success: "bg-status-success/12 text-status-success",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  },
);

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Pulses the dot, for work in progress. */
    pulse?: boolean;
  };

function Badge({ className, status, pulse = false, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ status, className }))} {...props}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full bg-current", pulse && "animate-pulse")} />
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
