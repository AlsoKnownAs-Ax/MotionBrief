import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ShortcutKeys } from "@renderer/components/shortcut-keys";
import { orpc } from "@renderer/core/connection";
import { SetupChecklist } from "@renderer/setup/checklist";
import { SHORTCUTS } from "../../../shared/shortcuts";

const NO_VALUE = "–";

function uptimeLabel(startedAt?: number, now?: number) {
  if (startedAt === undefined || now === undefined) {
    return NO_VALUE;
  }

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

/** `format(value)`, or a dash while the value hasn't arrived. */
function labelOrDash<T>(value: T | undefined, format: (value: T) => string) {
  if (value === undefined) {
    return NO_VALUE;
  }

  return format(value);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-6 border-b border-hairline-soft last:border-0">
      <dt className="text-app-sm text-ink-muted">{label}</dt>
      <dd className="text-app-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Placeholder Home: proves the window reaches the core API, including a live stream. */
export function Home() {
  const info = useQuery(orpc.system.info.queryOptions());
  const heartbeat = useQuery(orpc.system.heartbeat.experimental_liveOptions());

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-10">
      <SetupChecklist />

      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-app-display">MotionBrief</h1>
        <p className="text-app-body text-ink-muted">The app is running. Projects and generation come next.</p>
      </div>

      <section aria-label="Core" className="w-full max-w-sm rounded-lg bg-surface-1 px-3 py-1">
        <dl className="flex flex-col">
          <Fact label="App version">{labelOrDash(info.data?.appVersion, (version) => version)}</Fact>
          <Fact label="Core process">{labelOrDash(info.data?.pid, (pid) => `pid ${pid}`)}</Fact>
          <Fact label="Core uptime">{uptimeLabel(info.data?.startedAt, heartbeat.data?.at)}</Fact>
          <Fact label="Heartbeat">{labelOrDash(heartbeat.data?.seq, (seq) => `#${seq}`)}</Fact>
        </dl>
      </section>

      <p className="flex items-center gap-2 text-app-xs text-ink-muted">
        <ShortcutKeys shortcut={SHORTCUTS.showShortcuts} />
        Keyboard shortcuts
      </p>
    </main>
  );
}
