/**
 * Request-scoped semaphore for get_product. Support slots hydrate in
 * Promise.all — without a shared cap they each open HYDRATION_MAX_CONCURRENCY
 * paths and stampede the catalog (wave-1 massacre → wave-2 recovery).
 */
export type ConcurrencyGate = {
  readonly limit: number;
  run<T>(fn: () => Promise<T>): Promise<T>;
};

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  const cap = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active >= cap) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
  }

  function release(): void {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  }

  return {
    limit: cap,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
