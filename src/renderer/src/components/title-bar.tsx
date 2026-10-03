import { MenuIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { BrandMark } from "@renderer/components/brand-mark";
import { CoreStatus } from "@renderer/components/core-status";
import { Button } from "@renderer/components/ui/button";

const isMac = window.motionbrief.platform === "darwin";

function showAppMenu(event: MouseEvent<HTMLButtonElement>) {
  const { left, bottom } = event.currentTarget.getBoundingClientRect();
  window.motionbrief.showAppMenu({ x: left, y: bottom + 4 });
}

/** macOS: room for the traffic lights. Elsewhere: the app menu, since there is no menu bar. */
function TitleBarStart() {
  if (isMac) {
    return <span className="w-[78px] shrink-0" />;
  }

  return (
    <Button variant="ghost" size="icon-sm" className="no-drag-region ml-2.5" aria-label="Application menu" onClick={showAppMenu}>
      <MenuIcon />
    </Button>
  );
}

/**
 * The app's own title bar. The whole bar drags the window; macOS keeps its traffic lights
 * on the left, Windows its caption buttons on the right (Window Controls Overlay).
 */
export function TitleBar() {
  return (
    <header className="drag-region flex h-title-bar shrink-0 items-center gap-3 border-b border-hairline-soft pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+12px)]">
      <TitleBarStart />
      <span className="flex items-center gap-[9px]">
        <BrandMark />
        <span className="text-app-sm font-semibold tracking-[-0.2px]">MotionBrief</span>
      </span>
      <span className="flex-1" />
      <CoreStatus />
    </header>
  );
}
