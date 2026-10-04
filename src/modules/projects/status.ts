/** A value that changes over time, and a stream of it for every window that watches. */
export function createStatusStore<T extends object>(initial: T) {
  let status = initial;
  let changed = Promise.withResolvers<void>();

  function set(next: T) {
    status = next;
    changed.resolve();
    changed = Promise.withResolvers();
  }

  /** Yields the status now and after each change. A watcher that falls behind skips to the latest status. */
  async function* watch(signal?: AbortSignal): AsyncGenerator<T> {
    const stopped = aborted(signal);

    while (!signal?.aborted) {
      // Taken before yielding, so a change made while the watcher is busy isn't missed.
      const next = changed.promise;
      yield status;
      await Promise.race([next, stopped]);
    }
  }

  return { get: () => status, set, update: (patch: Partial<T>) => set({ ...status, ...patch }), watch };
}

function aborted(signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}
