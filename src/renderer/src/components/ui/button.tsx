import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@renderer/lib/utils";

/** DESIGN.md app-button-*: every button is a pill; one primary (orange) per view. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill font-medium whitespace-nowrap transition-[background-color,color,filter,transform] duration-150 active:not-disabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:not-disabled:brightness-108",
        secondary: "bg-ink text-canvas hover:not-disabled:bg-[#e6e6e6]",
        tertiary: "bg-surface-2 text-ink hover:not-disabled:bg-surface-3",
        ghost: "bg-transparent text-ink-muted hover:not-disabled:bg-surface-2 hover:not-disabled:text-ink",
      },
      size: {
        default: "h-control px-[15px] text-app-body",
        sm: "h-control-sm px-[11px] text-app-sm",
        icon: "size-control",
        "icon-sm": "size-control-sm",
      },
    },
    defaultVariants: {
      variant: "tertiary",
      size: "default",
    },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    return <Slot.Root data-slot="button" className={classes} {...props} />;
  }

  return <button data-slot="button" type="button" className={classes} {...props} />;
}

export { Button, buttonVariants };
