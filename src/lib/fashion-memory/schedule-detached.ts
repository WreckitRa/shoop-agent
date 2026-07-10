/** Run work off the request/stream hot path (Node). */
export function scheduleDetachedWork(work: () => void): void {
  setImmediate(work);
}

/** Run work when the browser is idle (client). Falls back to next macrotask. */
export function scheduleIdleWork(work: () => void, timeoutMs = 5_000): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(work, { timeout: timeoutMs });
    return;
  }
  setTimeout(work, 0);
}
