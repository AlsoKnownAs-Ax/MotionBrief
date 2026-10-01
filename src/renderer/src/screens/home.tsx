import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Kbd, KbdGroup } from "@renderer/components/ui/kbd";
import { orpc } from "@renderer/core/connection";
import { acceleratorFor, acceleratorKeys, SHORTCUTS } from "../../../shared/shortcuts";

const { platform } = window.motionbrief;
const SHORTCUTS_KEYS = acceleratorKeys(acceleratorFor(SHORTCUTS.showShortcuts, platform), platform);

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

function pidLabel(pid?: number) {
  if (pid === undefined) {
    return NO_VALUE;
  }

  return `pid ${pid}`;
}

function heartbeatLabel(seq?: number) {
  if (seq === undefined) {
    return NO_VALUE;
  }

  return `#${seq}`;
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
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-10">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-app-display">MotionBrief</h1>
        <p className="text-app-body text-ink-muted">
          The app shell is running. Home, Projects and generation arrive in later tickets.
        </p>
      </div>

      <section aria-label="Core API" className="w-full max-w-sm rounded-lg bg-surface-1 px-4 py-2">
        <dl className="flex flex-col">
          <Fact label="App version">{info.data?.appVersion ?? NO_VALUE}</Fact>
          <Fact label="Core process">{pidLabel(info.data?.pid)}</Fact>
          <Fact label="Core uptime">{uptimeLabel(info.data?.startedAt, heartbeat.data?.at)}</Fact>
          <Fact label="Heartbeat">{heartbeatLabel(heartbeat.data?.seq)}</Fact>
        </dl>
      </section>

      <p className="flex items-center gap-2 text-app-xs text-ink-muted">
        <KbdGroup>
          {SHORTCUTS_KEYS.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
        Keyboard shortcuts
      </p>
    </main>
  );
}
