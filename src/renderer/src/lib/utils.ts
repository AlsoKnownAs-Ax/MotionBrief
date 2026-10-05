import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the theme's custom font sizes (globals.css `--text-app-*`), or it
// treats `text-app-sm` as a color and drops it next to `text-ink-muted`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["app-display", "app-title", "app-body", "app-sm", "app-xs"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Roving focus: only the focused item of a group is in the Tab order; arrow keys move between the rest. */
export function rovingTabIndex(isFocused: boolean) {
  if (isFocused) {
    return 0;
  }

  return -1;
}

/** What went wrong, from anything a promise rejects with. */
export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
