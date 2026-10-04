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

/** How a Scene's status reads: a badge for anything but a Scene playing its own code. */
export const SCENE_STATUS = {
  ready: { label: "Ready", badge: undefined, badgeLabel: undefined },
  fallback: { label: "Fallback Scene", badge: "fallback", badgeLabel: "Fallback" },
} satisfies Record<SceneStatus, { label: string; badge?: "fallback"; badgeLabel?: string }>;

export const FORMAT_LABELS = { horizontal: "16:9", vertical: "9:16" } satisfies Record<Format, string>;

export function sceneName(scene: TimelineScene): string {
  return `Scene ${scene.number}`;
}
