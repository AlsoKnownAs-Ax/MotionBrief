import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BlendIcon,
  MoveRightIcon,
  ScissorsIcon,
  VideoIcon,
  ZoomInIcon,
  type LucideIcon,
} from "lucide-react";
import type { Format, SceneStatus, SceneType, TimelineScene, TransitionType } from "../../../contract";

export const SCENE_TYPE_LABELS = {
  hook: "Hook",
  "key-term": "Key term",
  "architecture-diagram": "Diagram",
  flow: "Flow",
  code: "Code",
  comparison: "Comparison",
  list: "List",
  "stat-chart": "Stat",
  outro: "Outro",
} satisfies Record<SceneType, string>;

export const TRANSITIONS = {
  cut: { label: "Cut", icon: ScissorsIcon },
  crossfade: { label: "Crossfade", icon: BlendIcon },
  "push-left": { label: "Push left", icon: ArrowLeftIcon },
  "push-right": { label: "Push right", icon: ArrowRightIcon },
  "push-up": { label: "Push up", icon: ArrowUpIcon },
  "push-down": { label: "Push down", icon: ArrowDownIcon },
  "zoom-through": { label: "Zoom through", icon: ZoomInIcon },
  "carry-over": { label: "Carry-over", icon: MoveRightIcon },
  camera: { label: "Camera move", icon: VideoIcon },
} satisfies Record<TransitionType, { label: string; icon: LucideIcon }>;

/**
 * How a Scene's status reads: a badge for anything but a Scene playing its own code. While a generation
 * works on a Scene, it plays as the Storyboard animatic.
 */
export const SCENE_STATUS = {
  ready: { label: "Ready", badge: undefined, badgeLabel: undefined },
  flagged: { label: "Review note", badge: "flagged", badgeLabel: "Review note" },
  fallback: { label: "Fallback Scene", badge: "fallback", badgeLabel: "Fallback" },
  queued: { label: "Storyboard animatic, waiting to be written", badge: "working", badgeLabel: "Queued" },
  writing: { label: "Storyboard animatic, being written", badge: "working", badgeLabel: "Writing" },
  checking: { label: "Storyboard animatic, being checked", badge: "working", badgeLabel: "Checking" },
} satisfies Record<SceneStatus, { label: string; badge?: "flagged" | "fallback" | "working"; badgeLabel?: string }>;

export const FORMAT_LABELS = { horizontal: "16:9", vertical: "9:16" } satisfies Record<Format, string>;

/** A Scene's description, followed by its review note when it has one. */
export function withNote(text: string, scene: TimelineScene, separator = ": "): string {
  if (!scene.note) {
    return text;
  }

  return `${text}${separator}${scene.note}`;
}

export function sceneName(scene: TimelineScene): string {
  return `Scene ${scene.number}`;
}
