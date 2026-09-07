export const FITTING_TRACE_HEADER = "x-fitting-trace";
export const FITTING_TRACE_STORAGE_KEY = "shoop.fitting.trace.v1";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_STRING = 20_000;
const MAX_DEPTH = 8;
const MAX_ARRAY = 40;
const MAX_KEYS = 60;

export function isFittingTraceId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isFittingTracePublicEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FITTING_TRACE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function sanitizeFittingTraceValue(
  value: unknown,
  depth = 0,
): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[deep]";
  if (typeof value === "string") return sanitizeTraceString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY).map((item) =>
      sanitizeFittingTraceValue(item, depth + 1),
    );
    if (value.length > MAX_ARRAY) {
      sliced.push(`[+${value.length - MAX_ARRAY} more]`);
    }
    return sliced;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_KEYS) {
        out._truncatedKeys = true;
        break;
      }
      n += 1;
      out[key] = sanitizeFittingTraceValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function sanitizeTraceString(value: string): string {
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed)) {
    return `[image ${value.length} chars]`;
  }
  if (/^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i.test(trimmed)) {
    return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
  }
  if (value.length <= MAX_STRING) return value;
  return `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING}]`;
}
