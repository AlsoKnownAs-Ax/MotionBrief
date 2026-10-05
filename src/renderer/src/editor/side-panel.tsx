import { Tabs } from "radix-ui";
import { useState } from "react";
import { Chat } from "./chat";
import { useRevision } from "./revision";
import { StyleTab } from "./style-tab";
import { Versions } from "./versions";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "style", label: "Style" },
  { id: "versions", label: "Versions" },
] as const;

/** The right panel: Chat, Style and Versions. */
export function SidePanel({ width }: { width: number }) {
  const [tab, setTab] = useState("chat");
  const chatFocus = useRevision((state) => state.chatFocus);
  const [seenFocus, setSeenFocus] = useState(chatFocus);

  // Revise… brings the chat forward.
  if (chatFocus !== seenFocus) {
    setSeenFocus(chatFocus);
    setTab("chat");
  }

  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 shrink-0 flex-col gap-3 p-3" style={{ width }}>
      <Tabs.List aria-label="Panel" className="flex gap-0.5 rounded-pill border border-hairline-soft bg-surface-1 p-[3px]">
        {TABS.map(({ id, label }) => (
          <Tabs.Trigger
            key={id}
            value={id}
            className="h-[26px] flex-1 rounded-pill text-app-sm font-medium text-ink-muted transition-colors hover:text-ink data-[state=active]:bg-surface-3 data-[state=active]:text-ink"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="chat" className="flex min-h-0 flex-1 outline-none">
        <Chat />
      </Tabs.Content>
      <Tabs.Content value="style" className="flex min-h-0 flex-1 outline-none">
        <StyleTab />
      </Tabs.Content>
      <Tabs.Content value="versions" className="flex min-h-0 flex-1 outline-none">
        <Versions />
      </Tabs.Content>
    </Tabs.Root>
  );
}
