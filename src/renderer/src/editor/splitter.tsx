import type { KeyboardEvent, PointerEvent } from "react";
import { cn } from "@renderer/lib/utils";

/** How far an arrow key moves a divider. */
const KEY_STEP = 16;

type SplitterProps = {
  /** `x` sizes a width with a vertical divider; `y` sizes a height with a horizontal one. */
  axis: "x" | "y";
  label: string;
  value: number;
  min: number;
  max: number;
  /** The pane sits after the divider (right of it, or below it): dragging towards the start grows it. */
  growsTowardsStart?: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
};

/**
 * A divider between two panes: drag it, move it with the arrow keys once focused (Home and End go
 * to the limits), or double-click it to reset the pane's size.
 */
export function Splitter({ axis, label, value, min, max, growsTowardsStart = false, onChange, onReset }: SplitterProps) {
  const clamp = (next: number) => Math.round(Math.max(min, Math.min(max, next)));
  const direction = growsTowardsStart ? -1 : 1;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const handle = event.currentTarget;
    const start = axis === "x" ? event.clientX : event.clientY;
    const startValue = value;

    handle.setPointerCapture(event.pointerId);
    document.body.dataset.resizing = axis;
    handle.onpointermove = (move) => {
      const position = axis === "x" ? move.clientX : move.clientY;
      onChange(clamp(startValue + direction * (position - start)));
    };
    handle.onpointerup = () => {
      handle.onpointermove = null;
      handle.onpointerup = null;
      delete document.body.dataset.resizing;
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const [back, forward] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const steps: Record<string, number> = { [back]: -direction * KEY_STEP, [forward]: direction * KEY_STEP };

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onChange(event.key === "Home" ? min : max);
      return;
    }

    const step = steps[event.key];

    if (step !== undefined) {
      event.preventDefault();
      onChange(clamp(value + step));
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize. Double-click to reset."
      className={cn(
        "group relative z-10 shrink-0 touch-none outline-none",
        axis === "x" ? "-mx-1 w-[9px] cursor-col-resize" : "-my-1 h-[9px] cursor-row-resize",
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute bg-hairline-soft transition-colors group-hover:bg-ink-muted/50 group-focus-visible:bg-primary group-active:bg-primary",
          axis === "x" ? "inset-y-0 left-1 w-px" : "inset-x-0 top-1 h-px",
        )}
      />
    </div>
  );
}
