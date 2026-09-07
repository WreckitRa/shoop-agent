/** Tiny p-limit — `p-limit` is not a dependency. */

export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const n = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    queue.shift()?.();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        active += 1;
        fn().then(resolve, reject).finally(next);
      };
      if (active < n) start();
      else queue.push(start);
    });
  };
}

export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
