export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** SSE comment line — intermediaries see traffic so they don't drop idle connections. */
export const SSE_HEARTBEAT = ": keepalive\n\n";

/**
 * Coalescing window for text deltas. The first flush fires after 8ms (≈120 FPS cap)
 * to minimize TTFT while still batching rapid bursts. After the first token reaches
 * the client, perception of latency drops dramatically so subsequent flushes are
 * less critical — the char-count cap handles large mid-stream bursts.
 */
export const TEXT_DELTA_FLUSH_MS = 8;
export const TEXT_DELTA_FLUSH_CHARS = 48;

/**
 * Coalesces incoming text fragments into batched SSE `text_delta` events.
 *
 * Anthropic streams tokens close together (often 1–3 chars). One frame per token
 * means hundreds of SSE events + setState calls per reply. We buffer up and flush
 * either on a small timer or when the buffer hits a soft cap, then flush again on
 * stream end / abort. Yields ~5–10× fewer events with no visible difference.
 */
export function createTextDeltaCoalescer(
  push: (chunk: string) => void,
  options?: { flushMs?: number; flushChars?: number },
) {
  const flushMs = options?.flushMs ?? TEXT_DELTA_FLUSH_MS;
  const flushChars = options?.flushChars ?? TEXT_DELTA_FLUSH_CHARS;

  let buf = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (buf.length === 0) return;
    const out = buf;
    buf = "";
    push(formatSse("text_delta", { text: out }));
  }

  function enqueue(text: string) {
    if (!text) return;
    buf += text;
    if (buf.length >= flushChars) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(flush, flushMs);
    }
  }

  function dispose() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    buf = "";
  }

  return { enqueue, flush, dispose };
}
