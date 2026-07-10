/**
 * Normalizes LLM JSON outputs (markdown fences, null-heavy payloads).
 */

export function stripJsonFence(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\n?```\s*$/, "");
  }
  return t.trim();
}

/** Models often return `"key": null`; Zod `.optional()` rejects null. Drop null entries recursively. */
export function stripNullFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNullFields);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNullFields(v);
    }
    return out;
  }
  return value;
}

export type ParseLlmJsonResult = {
  value: unknown;
  salvaged: boolean;
};

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Close any unclosed `[` / `{` outside of JSON strings. */
export function closeOpenJsonContainers(text: string): string {
  const stack: ("[" | "{")[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[") stack.push("[");
    else if (c === "{") stack.push("{");
    else if (c === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
    } else if (c === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
    }
  }

  let out = text;
  if (inString) {
    const lastComma = out.lastIndexOf(",");
    out = lastComma > 0 ? out.slice(0, lastComma).trimEnd() : out.trimEnd();
    if (out.endsWith('"')) out = out.slice(0, -1).trimEnd();
    if (out.endsWith(":")) {
      const keyComma = out.lastIndexOf(",");
      out = keyComma > 0 ? out.slice(0, keyComma).trimEnd() : out;
    }
  }

  while (stack.length) {
    const open = stack.pop();
    out += open === "[" ? "]" : "}";
  }
  return out;
}

function dropTrailingTopLevelKey(text: string, key: string): string | null {
  const idx = text.indexOf(key);
  if (idx <= 0) return null;
  let trimmed = text.slice(0, idx).trimEnd();
  if (trimmed.endsWith(",")) trimmed = trimmed.slice(0, -1).trimEnd();
  return trimmed;
}

function salvageTruncatedJsonObject(text: string): string | null {
  for (const key of ['"profileUpdates"', '"activeIntent"']) {
    const trimmed = dropTrailingTopLevelKey(text, key);
    if (!trimmed) continue;
    const closed = closeOpenJsonContainers(trimmed);
    if (tryParseJson(closed) !== null) return closed;
  }

  let candidate = text.trimEnd();
  for (let i = 0; i < 64; i++) {
    candidate = closeOpenJsonContainers(candidate);
    if (tryParseJson(candidate) !== null) return candidate;
    const lastComma = candidate.lastIndexOf(",");
    if (lastComma <= 0) break;
    candidate = candidate.slice(0, lastComma).trimEnd();
  }

  return null;
}

/** Parse LLM JSON; when truncated (e.g. max_tokens), salvage partial payloads when possible. */
export function parseLlmJsonObject(raw: string): ParseLlmJsonResult | null {
  const text = stripJsonFence(raw);
  if (!text) return null;

  const direct = tryParseJson(text);
  if (direct !== null) return { value: direct, salvaged: false };

  const salvagedText = salvageTruncatedJsonObject(text);
  if (!salvagedText) return null;

  const salvaged = tryParseJson(salvagedText);
  if (salvaged === null) return null;
  return { value: salvaged, salvaged: true };
}
