import { cn } from "@renderer/lib/utils";
import type { StylePreset } from "../../../contract";
import { usePresetSample } from "./presets";

/**
 * A Preset shown as the bundled frame draws it: a still of a small diagram in its Palette, typography and
 * treatments. Until the still is ready, or if the frame's browser is missing, a drawing in its Palette stands in.
 */
export function PresetSample({ preset, className }: { preset: StylePreset; className?: string }) {
  const { data, isPlaceholderData } = usePresetSample(preset);

  return (
    <div className={cn("relative aspect-video w-full overflow-hidden rounded-md", className)}>
      {data ? (
        <img
          src={data.image}
          alt=""
          aria-hidden="true"
          className={cn("size-full object-cover transition-opacity duration-200", isPlaceholderData && "opacity-60")}
        />
      ) : (
        <PresetArt preset={preset} />
      )}
    </div>
  );
}

/** A small drawing in the Preset's Palette: two boxes joined by a connector, on its background. */
function PresetArt({ preset }: { preset: StylePreset }) {
  const { colors } = preset.palette;

  return (
    <svg aria-hidden="true" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="size-full">
      <rect width="160" height="90" fill={colors.bg} />
      <rect x="14" y="29" width="46" height="32" rx="6" fill={colors.surface} stroke={colors.line} strokeWidth="1.5" />
      <rect x="100" y="29" width="46" height="32" rx="6" fill={colors.surface} stroke={colors.line} strokeWidth="1.5" />
      <path d="M60 45 H100" stroke={colors.accent} strokeWidth="2.5" />
      <circle cx="100" cy="45" r="3.5" fill={colors.accent} />
      <rect x="22" y="40" width="30" height="4" rx="2" fill={colors.ink} />
      <rect x="22" y="48" width="20" height="3" rx="1.5" fill={colors.accent2} />
      <rect x="108" y="40" width="30" height="4" rx="2" fill={colors.ink} />
    </svg>
  );
}
