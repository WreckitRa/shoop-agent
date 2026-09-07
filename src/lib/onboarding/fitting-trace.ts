import { AsyncLocalStorage } from "node:async_hooks";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  FITTING_TRACE_HEADER,
  isFittingTraceId,
  sanitizeFittingTraceValue,
} from "./fitting-trace-shared";

export { FITTING_TRACE_HEADER, isFittingTraceId } from "./fitting-trace-shared";

const MAX_EVENT_BYTES = 120_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type FittingTraceStore = { traceId: string };

const als = new AsyncLocalStorage<FittingTraceStore>();

export function fittingTraceDir(): string {
  return path.join(process.cwd(), "tmp", "fitting-traces");
}

export function fittingTraceFile(traceId: string): string {
  return path.join(fittingTraceDir(), `${traceId}.jsonl`);
}

export function activeFittingTraceId(): string | null {
  return als.getStore()?.traceId ?? null;
}

export function fittingTraceIdFromHeader(value: string | null): string | null {
  const id = value?.trim() ?? "";
  return isFittingTraceId(id) ? id : null;
}

export function fittingTraceIdFromRequest(req: Request): string | null {
  return fittingTraceIdFromHeader(req.headers.get(FITTING_TRACE_HEADER));
}

export function enterFittingTrace(traceId: string | null): string | null {
  if (!traceId || !isFittingTraceId(traceId)) return null;
  als.enterWith({ traceId });
  return traceId;
}

export function runWithFittingTrace<T>(
  traceId: string | null,
  fn: () => T,
): T {
  if (!traceId || !isFittingTraceId(traceId)) return fn();
  return als.run({ traceId }, fn);
}

/** Keep ALS alive across `after()` — capture id from the request, not the current store. */
export function bindFittingTraceFromRequest<T>(
  req: Request,
  fn: () => T,
): () => T {
  const traceId = fittingTraceIdFromRequest(req);
  return () => runWithFittingTrace(traceId, fn);
}

/** Bind at the first synchronous line of a route, before any await. */
export function enterFittingTraceFromRequest(req: Request): string | null {
  return enterFittingTrace(fittingTraceIdFromRequest(req));
}

export function logFitting(
  event: string,
  payload: Record<string, unknown> = {},
): void {
  const traceId = activeFittingTraceId();
  if (!traceId || !shouldWriteFittingTrace()) return;
  const name = event.trim();
  if (!name) return;
  appendFittingTraceEvent(traceId, {
    t: new Date().toISOString(),
    event: name.slice(0, 120),
    ...asRecord(sanitizeFittingTraceValue(payload)),
  });
}

export function readFittingTrace(traceId: string): {
  id: string;
  file: string;
  events: Record<string, unknown>[];
} | null {
  if (!isFittingTraceId(traceId)) return null;
  const file = fittingTraceFile(traceId);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const events: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      events.push({ event: "parse_error", line: line.slice(0, 200) });
    }
  }
  return { id: traceId, file, events };
}

export function readLatestFittingTraceId(): string | null {
  try {
    const id = readFileSync(path.join(fittingTraceDir(), "LATEST"), "utf8").trim();
    return isFittingTraceId(id) ? id : null;
  } catch {
    return null;
  }
}

function shouldWriteFittingTrace(): boolean {
  if (process.env.NODE_ENV === "test" && process.env.FITTING_TRACE !== "1") {
    return false;
  }
  return true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function appendFittingTraceEvent(
  traceId: string,
  event: Record<string, unknown>,
): void {
  const dir = fittingTraceDir();
  mkdirSync(dir, { recursive: true });
  const file = fittingTraceFile(traceId);
  let line = JSON.stringify(event);
  if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
    line = JSON.stringify({
      t: event.t,
      event: event.event,
      truncated: true,
      bytes: Buffer.byteLength(line),
    });
  }
  try {
    if (statSync(file).size >= MAX_FILE_BYTES) return;
  } catch {
    /* new file */
  }
  appendFileSync(file, `${line}\n`);
  writeFileSync(path.join(dir, "LATEST"), `${traceId}\n`);
}
