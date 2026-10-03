import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/** DESIGN.md app-input: 36px, rounded.app-md, one surface step above what it sits on; focus is the orange ring. */
function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-input w-full min-w-0 rounded-md bg-surface-2 px-3 text-app-body text-ink placeholder:text-ink-muted outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--brand)] focus-visible:outline-none disabled:opacity-40 aria-invalid:shadow-[0_0_0_1px_var(--status-fallback)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
