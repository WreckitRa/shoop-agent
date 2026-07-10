/** Fan-out helper: one parent listener, many forked child signals for parallel I/O. */
export type AbortScope = {
  fork(): AbortSignal;
};

export function createAbortScope(parent?: AbortSignal): AbortScope {
  const children = new Set<AbortController>();

  const abortChildren = (reason?: unknown) => {
    for (const c of children) {
      if (!c.signal.aborted) c.abort(reason);
    }
    children.clear();
  };

  if (parent) {
    if (parent.aborted) {
      abortChildren(parent.reason);
    } else {
      parent.addEventListener("abort", () => abortChildren(parent.reason), {
        once: true,
      });
    }
  }

  return {
    fork(): AbortSignal {
      if (parent?.aborted) {
        return AbortSignal.abort(parent.reason);
      }
      const ctrl = new AbortController();
      children.add(ctrl);
      return ctrl.signal;
    },
  };
}

/** Merge a forked op signal with a per-call timeout (no extra parent listeners). */
export function abortSignalWithTimeout(
  opSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return opSignal ? AbortSignal.any([opSignal, timeout]) : timeout;
}
