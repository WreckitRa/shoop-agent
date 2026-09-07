import { pLimit } from "./limit";

/** Leave 1 of FASHN's 6 concurrency slots for interactive try-on. */
const FASHN_LOOKS_CONCURRENCY = 5;
const RUNS_PER_MINUTE = 45;
const WINDOW_MS = 60_000;

const limit = pLimit(FASHN_LOOKS_CONCURRENCY);
const runTimes: number[] = [];

function pruneRunTimes(now: number) {
  while (runTimes.length && now - runTimes[0]! >= WINDOW_MS) runTimes.shift();
}

async function waitForRunSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    pruneRunTimes(now);
    if (runTimes.length < RUNS_PER_MINUTE) {
      runTimes.push(now);
      return;
    }
    const wait = WINDOW_MS - (now - runTimes[0]!) + 20;
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function withFashnQueue<T>(fn: () => Promise<T>): Promise<T> {
  return limit(async () => {
    await waitForRunSlot();
    return fn();
  });
}

/** Test helper — not used in production. */
export function fashnQueuePressure(): { queuedRuns: number } {
  pruneRunTimes(Date.now());
  return { queuedRuns: runTimes.length };
}
