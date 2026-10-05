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
  const direction = directionOf(growsTowardsStart);
  const { positionOf, back, forward, orientation, handleClass, lineClass } = AXES[axis];

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const handle = event.currentTarget;
    const start = positionOf(event);
    const startValue = value;

    handle.setPointerCapture(event.pointerId);
    document.body.dataset.resizing = axis;
    handle.onpointermove = (move) => {
      onChange(clamp(startValue + direction * (positionOf(move) - start)));
    };
    handle.onpointerup = () => {
      handle.onpointermove = null;
      handle.onpointerup = null;
      delete document.body.dataset.resizing;
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { [back]: -direction * KEY_STEP, [forward]: direction * KEY_STEP };
    const limits: Record<string, number> = { Home: min, End: max };
    const limit = limits[event.key];

    if (limit !== undefined) {
      event.preventDefault();
      onChange(limit);
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
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize. Double-click to reset."
      className={cn("group relative z-10 shrink-0 touch-none outline-none", handleClass)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute bg-hairline-soft transition-colors group-hover:bg-ink-muted/50 group-focus-visible:bg-primary group-active:bg-primary",
          lineClass,
        )}
      />
    </div>
  );
}

type Axis = {
  positionOf: (event: { clientX: number; clientY: number }) => number;
  /** The arrow keys that move the divider towards the start, and towards the end. */
  back: string;
  forward: string;
  /** The divider's own orientation: across the axis it sizes. */
  orientation: "vertical" | "horizontal";
  handleClass: string;
  lineClass: string;
};

const AXES = {
  x: {
    positionOf: ({ clientX }) => clientX,
    back: "ArrowLeft",
    forward: "ArrowRight",
    orientation: "vertical",
    handleClass: "-mx-1 w-[9px] cursor-col-resize",
    lineClass: "inset-y-0 left-1 w-px",
  },
  y: {
    positionOf: ({ clientY }) => clientY,
    back: "ArrowUp",
    forward: "ArrowDown",
    orientation: "horizontal",
    handleClass: "-my-1 h-[9px] cursor-row-resize",
    lineClass: "inset-x-0 top-1 h-px",
  },
} satisfies Record<SplitterProps["axis"], Axis>;

/** Dragging towards the start grows a pane after the divider, and shrinks one before it. */
function directionOf(growsTowardsStart: boolean) {
  if (growsTowardsStart) {
    return -1;
  }

  return 1;
}
