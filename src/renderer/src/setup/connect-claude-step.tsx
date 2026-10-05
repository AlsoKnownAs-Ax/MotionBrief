import { useClaudeStatus } from "@renderer/claude/connection";
import { ConnectClaude } from "@renderer/claude/connect-claude";
import { Button } from "@renderer/components/ui/button";
import { useNavigation } from "@renderer/navigation";
import type { SetupStep } from "@renderer/setup/steps";

function ConnectAction() {
  const openSetup = useNavigation((state) => state.openSetup);

  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-app-xs text-ink-muted">Not connected</span>
      <Button size="sm" onClick={() => openSetup("connect-claude")}>
        Connect
      </Button>
    </div>
  );
}

export function useConnectClaudeStep(): SetupStep {
  const { data: status } = useClaudeStatus();

  return {
    id: "connect-claude",
    title: "Connect Claude",
    label: "Connect Claude",
    description: "The agent runs on your own Claude account. MotionBrief has no servers in between.",
    done: status?.isConnected,
    panel: <ConnectClaude />,
    summary: <ConnectAction />,
  };
}
