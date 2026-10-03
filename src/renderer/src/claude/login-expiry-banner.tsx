import { Button } from "@renderer/components/ui/button";
import { useNavigation } from "@renderer/navigation";
import { expiringInDays, useClaudeStatus } from "./connection";

/** A quiet strip when the Claude login expires within 3 days, so it can be renewed before a run fails. */
export function LoginExpiryBanner() {
  const { data: status } = useClaudeStatus();
  const openSetup = useNavigation((state) => state.openSetup);
  const daysLeft = expiringInDays(status);

  if (daysLeft === undefined) {
    return null;
  }

  return (
    <div role="status" className="flex h-9 shrink-0 items-center gap-3 border-b border-hairline-soft bg-status-flagged-tint px-4 text-app-sm">
      <span className="flex-1 text-status-flagged">{expiryMessage(daysLeft)}</span>
      <Button variant="ghost" size="sm" onClick={() => openSetup("connect-claude")}>
        Renew
      </Button>
    </div>
  );
}

function expiryMessage(daysLeft: number) {
  if (daysLeft < 1) {
    return "Your Claude login expires today. Sign in again to keep generating.";
  }

  if (daysLeft === 1) {
    return "Your Claude login expires in 1 day. Sign in again to keep generating.";
  }

  return `Your Claude login expires in ${daysLeft} days. Sign in again to keep generating.`;
}
