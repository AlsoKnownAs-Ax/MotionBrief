import { safe } from "@orpc/client";
import type { ComponentProps, MouseEvent } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { core, useCoreConnection, type ConnectionStatus } from "@renderer/core/connection";

type StatusBadge = Pick<ComponentProps<typeof Badge>, "status" | "pulse"> & { label: string };

const STATUS_BADGE = {
  connecting: { status: "working", label: "Connecting to core", pulse: true },
  connected: { status: "success", label: "Core running", pulse: false },
  reconnecting: { status: "flagged", label: "Core restarting", pulse: true },
} satisfies Record<ConnectionStatus, StatusBadge>;

async function copyDiagnostics() {
  const { data: info, error } = await safe(core.system.info());

  if (error) {
    return;
  }

  await navigator.clipboard.writeText(`MotionBrief ${info.appVersion}, core pid ${info.pid}`);
}

async function showMenu(event: MouseEvent) {
  event.preventDefault();
  const choice = await window.motionbrief.showContextMenu([{ id: "copy-diagnostics", label: "Copy Diagnostics" }]);

  if (choice === "copy-diagnostics") {
    await copyDiagnostics();
  }
}

/** The connection to the core process, as a title-bar badge. */
export function CoreStatus() {
  const status = useCoreConnection((state) => state.status);
  const badge = STATUS_BADGE[status];

  return (
    <Badge role="status" status={badge.status} pulse={badge.pulse} className="no-drag-region" onContextMenu={showMenu}>
      {badge.label}
    </Badge>
  );
}
