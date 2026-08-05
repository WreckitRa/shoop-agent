/**
 * ML-inferred catalog attributes (Material, Style, Occasion, …).
 * Variable accuracy — often absent from a given listing.
 */

export type CatalogInferredAttribute = {
  name: string;
  value: string;
};

function pushAttr(
  out: CatalogInferredAttribute[],
  name: string,
  value: unknown,
): void {
  if (typeof value !== "string") return;
  const v = value.trim();
  const n = name.trim();
  if (!v || !n) return;
  out.push({ name: n, value: v });
}

function parseAttributeEntry(entry: unknown): CatalogInferredAttribute | null {
  if (typeof entry === "string") {
    const s = entry.trim();
    if (!s) return null;
    const colon = s.indexOf(":");
    if (colon > 0) {
      return {
        name: s.slice(0, colon).trim(),
        value: s.slice(colon + 1).trim(),
      };
    }
    return { name: "attribute", value: s };
  }
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const value =
    typeof o.value === "string"
      ? o.value
      : typeof o.label === "string"
        ? o.label
        : typeof o.text === "string"
          ? o.text
          : null;
  const name =
    typeof o.name === "string"
      ? o.name
      : typeof o.key === "string"
        ? o.key
        : typeof o.type === "string"
          ? o.type
          : "attribute";
  if (!value?.trim()) return null;
  return { name: name.trim(), value: value.trim() };
}

/** Best-effort read of `metadata.attributes` (and legacy `attributes`) from catalog payloads. */
export function extractCatalogAttributes(raw: unknown): CatalogInferredAttribute[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const out: CatalogInferredAttribute[] = [];

  const metadata = o.metadata as Record<string, unknown> | undefined;
  const rawAttrs = o.attributes ?? metadata?.attributes;
  if (Array.isArray(rawAttrs)) {
    for (const entry of rawAttrs) {
      const parsed = parseAttributeEntry(entry);
      if (parsed) out.push(parsed);
    }
  } else if (rawAttrs && typeof rawAttrs === "object" && !Array.isArray(rawAttrs)) {
    for (const [k, v] of Object.entries(rawAttrs as Record<string, unknown>)) {
      if (typeof v === "string") pushAttr(out, k, v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") pushAttr(out, k, item);
        }
      }
    }
  }

  for (const key of ["tech_specs", "top_features", "unique_selling_points"] as const) {
    const block = metadata?.[key];
    if (Array.isArray(block)) {
      for (const entry of block) {
        const parsed = parseAttributeEntry(entry);
        if (parsed) out.push(parsed);
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.name.toLowerCase()}::${a.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function formatCatalogAttributesForPrompt(
  attrs: CatalogInferredAttribute[] | undefined,
): string | null {
  if (!attrs?.length) return null;
  return attrs.map((a) => `${a.name}: ${a.value}`).join("; ");
}

/** Tokens usable when checking whether a reason cites real product facts. */
export function productFactTokens(input: {
  title: string;
  attributes?: CatalogInferredAttribute[];
  options?: Array<{ name: string; values: Array<{ label: string }> }>;
}): string[] {
  const tokens = new Set<string>();
  const add = (s: string) => {
    for (const w of s.toLowerCase().split(/\W+/)) {
      if (w.length >= 3) tokens.add(w);
    }
  };
  add(input.title);
  for (const a of input.attributes ?? []) {
    add(a.name);
    add(a.value);
  }
  for (const opt of input.options ?? []) {
    add(opt.name);
    for (const v of opt.values ?? []) add(v.label);
  }
  return [...tokens];
}
