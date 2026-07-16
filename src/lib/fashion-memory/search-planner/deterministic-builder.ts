import {
  ensureDepartmentQueryPrefix,
  resolveSearchDepartment,
  type FashionDepartment,
} from "../department";
import type { FashionSearchBrief } from "../router/types";
import { extractStatedColors } from "../router/brief-fields";
import { COLOR_WORDS } from "./query-rules";
import { containsBannedToken, stripBannedTokens } from "./validator";

const STYLE_DESCRIPTOR_POOL = [
  "slim",
  "minimalist",
  "classic",
  "formal",
  "smart casual",
  "business casual",
  "tailored",
  "relaxed",
  "premium",
  "oxford",
  "button down",
];

const MATERIAL_POOL = [
  "cotton",
  "linen",
  "wool",
  "poplin",
  "merino",
  "denim",
  "leather",
  "silk",
];

const GARMENT_STOP_WORDS = new Set([
  "shirt",
  "shirts",
  "pant",
  "pants",
  "trouser",
  "trousers",
  "shoe",
  "shoes",
  "dress",
  "dresses",
  "top",
  "tops",
  "jacket",
  "blazer",
  "coat",
  "sweater",
  "general",
  "wear",
  "office",
  "work",
]);

function pickMaterial(mustHaves: string[], styleDirection: string): string {
  for (const m of mustHaves) {
    const t = m.toLowerCase().trim();
    const hit = MATERIAL_POOL.find((mat) => t.includes(mat) || mat.includes(t));
    if (hit) return hit;
  }
  const dir = styleDirection.toLowerCase();
  const fromStyle = MATERIAL_POOL.find((mat) => dir.includes(mat));
  return fromStyle ?? "cotton";
}

/** First two usable style descriptors from the slot/brief style_direction. */
export function extractStyleDescriptors(
  styleDirection: string,
  count = 2,
): string[] {
  const normalized = stripBannedTokens(
    styleDirection
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

  const poolHits = STYLE_DESCRIPTOR_POOL.filter((d) => normalized.includes(d));
  const tokens = normalized
    .split(" ")
    .filter(
      (w) =>
        w.length > 2 &&
        !GARMENT_STOP_WORDS.has(w) &&
        !containsBannedToken(w),
    );

  const merged: string[] = [];
  for (const hit of poolHits) {
    if (!merged.includes(hit) && !containsBannedToken(hit)) merged.push(hit);
  }
  for (const token of tokens) {
    if (!merged.includes(token)) merged.push(token);
  }

  while (merged.length < count) {
    const fallback = STYLE_DESCRIPTOR_POOL[merged.length] ?? "classic";
    if (!merged.includes(fallback) && !containsBannedToken(fallback)) {
      merged.push(fallback);
    } else if (!merged.includes("classic")) {
      merged.push("classic");
    } else {
      merged.push("tailored");
    }
  }

  return merged.slice(0, count);
}

function colorFromMustHaves(mustHaves: string[]): string | null {
  for (const m of mustHaves) {
    const t = m.toLowerCase().trim();
    if (COLOR_WORDS.has(t)) return t;
  }
  return null;
}

/**
 * Deterministic fallback when planner variants fail validation twice.
 * Emits 4–5 diverse variants ordered best → worst.
 */
export function buildDeterministicQueryVariants(params: {
  garment: string;
  styleDirection: string;
  mustHaves?: string[];
  includeColor?: boolean;
  department?: FashionDepartment | string | null;
}): string[] {
  const garment = params.garment.trim().toLowerCase();
  const mustHaves = params.mustHaves ?? [];
  const [desc1, desc2] = extractStyleDescriptors(params.styleDirection, 2);
  const material = pickMaterial(mustHaves, params.styleDirection);
  const department = resolveSearchDepartment({
    knowledgeDepartment: params.department,
  });

  const styleRegisterVariant = `${desc1} ${desc2} ${garment}`
    .replace(/\s+/g, " ")
    .trim();

  const editorialVariant = `${desc1} ${garment}`.replace(/\s+/g, " ").trim();

  let materialVariant = `${material} ${garment}`.replace(/\s+/g, " ").trim();

  const premiumVariant = `premium ${material} ${garment}`.replace(/\s+/g, " ").trim();

  const relaxedVariant = `relaxed ${garment}`.replace(/\s+/g, " ").trim();

  if (params.includeColor) {
    const color = colorFromMustHaves(mustHaves);
    if (color) {
      materialVariant = `${color} ${material} ${garment}`.replace(/\s+/g, " ").trim();
    }
  }

  const raw = [
    styleRegisterVariant,
    editorialVariant,
    materialVariant,
    premiumVariant,
    relaxedVariant,
  ];

  const prefixed = raw.map((q) => ensureDepartmentQueryPrefix(q, department));
  const unique: string[] = [];
  for (const q of prefixed) {
    const key = q.toLowerCase();
    if (!unique.some((u) => u.toLowerCase() === key)) unique.push(q);
  }
  while (unique.length < 4) {
    const filler = ensureDepartmentQueryPrefix(
      `${STYLE_DESCRIPTOR_POOL[unique.length % STYLE_DESCRIPTOR_POOL.length]} ${garment}`,
      department,
    );
    if (!unique.some((u) => u.toLowerCase() === filler.toLowerCase())) {
      unique.push(filler);
    } else {
      unique.push(
        ensureDepartmentQueryPrefix(`classic ${garment}`, department),
      );
    }
  }
  return unique.slice(0, 5);
}

export function allowedColorWordsFromBrief(brief: FashionSearchBrief): string[] {
  if (brief.color_direction?.source === "stated") {
    return brief.color_direction.stated_colors ?? extractStatedColors(brief.must_haves);
  }
  const colors = brief.must_haves
    .map((m) => m.toLowerCase().trim())
    .filter((m) => COLOR_WORDS.has(m));
  return [...new Set(colors)];
}
