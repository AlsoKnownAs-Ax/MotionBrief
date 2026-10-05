import { XIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { Button } from "@renderer/components/ui/button";

type Toast = {
  id: number;
  text: string;
  /** One action, such as Undo. */
  action?: { label: string; run: () => void };
};

/** How long a toast stays; one with an action stays as long as the action can still be taken. */
export const TOAST_MS = 6_000;

type Toasts = {
  toast?: Toast;
  show: (toast: Omit<Toast, "id">) => void;
  dismiss: (id?: number) => void;
};

let nextId = 0;

/** One toast at a time, per window: a new one replaces the last. */
export const useToast = create<Toasts>((set, get) => ({
  show: (toast) => {
    nextId += 1;
    set({ toast: { ...toast, id: nextId } });
  },
  dismiss: (id) => {
    if (id === undefined || get().toast?.id === id) {
      set({ toast: undefined });
    }
  },
}));

/** Shows the current toast at the bottom of the window. */
export function Toaster() {
  const toast = useToast((state) => state.toast);
  const dismiss = useToast((state) => state.dismiss);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS);

    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed bottom-8 left-1/2 z-40 flex max-w-[min(560px,calc(100%-2rem))] -translate-x-1/2 animate-in items-center gap-2 rounded-lg border border-hairline bg-surface-2 py-1.5 pr-1.5 pl-4 text-app-sm shadow-[0_14px_36px_rgb(0_0_0/0.55)] duration-200 ease-out-expo fade-in-0 slide-in-from-bottom-2"
    >
      <span className="min-w-0 flex-1">{toast.text}</span>
      {toast.action ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-ink"
          onClick={() => {
            toast.action?.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        <XIcon />
      </Button>
    </div>
  );
}
