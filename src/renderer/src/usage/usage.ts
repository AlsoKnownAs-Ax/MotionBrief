import { useEffect, useState } from "react";
import { useClaudeStatus } from "@renderer/claude/connection";
import { core, useCoreConnection } from "@renderer/core/connection";
import type { UsageStatus, VideoRef } from "../../../contract";

/**
 * What runs are using, live: the video's latest run and totals when one is given, today's and the plan's. Listens
 * again when the connection changes (dollars or plan windows) and when the core restarts.
 */
export function useUsage(video: VideoRef | undefined) {
  const [heard, setHeard] = useState<{ key: string; status: UsageStatus }>();
  const { data: connection } = useClaudeStatus();
  const coreStatus = useCoreConnection((state) => state.status);
  const projectId = video?.projectId;
  const format = video?.format;
  const method = connection?.method;
  // A status heard for another video, or before the connection changed, isn't shown.
  const key = `${projectId} ${format} ${method}`;

  useEffect(() => {
    if (coreStatus !== "connected") {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      for await (const status of await core.usage.watch({ video: watchedVideo(projectId, format) }, { signal: controller.signal })) {
        setHeard({ key, status });
      }
    })().catch(() => {
      // The video's Project closed or the core went away; the next open or restart listens again.
    });

    return () => controller.abort();
  }, [projectId, format, key, coreStatus]);

  if (heard?.key !== key) {
    return undefined;
  }

  return heard.status;
}

function watchedVideo(projectId: string | undefined, format: VideoRef["format"] | undefined): VideoRef | undefined {
  if (!projectId || !format) {
    return undefined;
  }

  return { projectId, format };
}
