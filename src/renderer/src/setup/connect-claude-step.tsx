import { useClaudeStatus } from "@renderer/claude/connection";
import { ConnectClaude } from "@renderer/claude/connect-claude";
import { Button } from "@renderer/components/ui/button";
import { useNavigation } from "@renderer/navigation";
import type { SetupStep } from "@renderer/setup/steps";

function ConnectAction() {
  const openSetup = useNavigation((state) => state.openSetup);

  return (
    <Button size="sm" onClick={() => openSetup("connect-claude")}>
      Connect
    </Button>
  );
}

export function useConnectClaudeStep(): SetupStep {
  const { data: status } = useClaudeStatus();

  return {
    id: "connect-claude",
    title: "Connect Claude",
    description: "The agent runs on your own Claude account. MotionBrief has no servers in between.",
    isDone: status?.isConnected ?? false,
    Panel: ConnectClaude,
    ChecklistAction: ConnectAction,
  };
}
