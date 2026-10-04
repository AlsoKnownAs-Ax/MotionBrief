import { HistoryIcon, MessageSquareIcon, PaletteIcon, type LucideIcon } from "lucide-react";
import { Tabs } from "radix-ui";
import type { ReactNode } from "react";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "style", label: "Style" },
  { id: "versions", label: "Versions" },
] as const;

/** The right panel: Chat, Style and Versions. */
export function SidePanel({ width }: { width: number }) {
  return (
    <Tabs.Root defaultValue="chat" className="flex min-h-0 shrink-0 flex-col gap-3 p-3" style={{ width }}>
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
        <EmptyState icon={MessageSquareIcon} title="No messages yet">
          Revisions to this video, and what the agent says about them, show here.
        </EmptyState>
      </Tabs.Content>
      <Tabs.Content value="style" className="flex min-h-0 flex-1 outline-none">
        <EmptyState icon={PaletteIcon} title="Blueprint">
          This video&rsquo;s Style Preset. Palette and typography changes show here.
        </EmptyState>
      </Tabs.Content>
      <Tabs.Content value="versions" className="flex min-h-0 flex-1 outline-none">
        <EmptyState icon={HistoryIcon} title="No Versions yet">
          Each generation, Revision and style change saves a Version you can restore.
        </EmptyState>
      </Tabs.Content>
    </Tabs.Root>
  );
}

function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="m-auto flex max-w-[260px] flex-col items-center gap-2 px-3 py-6 text-center">
      <Icon className="size-5 text-ink-muted" aria-hidden="true" />
      <p className="text-app-sm font-medium">{title}</p>
      <p className="text-app-xs leading-[1.45] text-ink-muted">{children}</p>
    </div>
  );
}
