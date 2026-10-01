/** Time as the core sees it. Swapped for a manual clock in tests. */
export type Clock = {
  now: () => number;
  /** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }

      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });

      function done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
    }),
};
