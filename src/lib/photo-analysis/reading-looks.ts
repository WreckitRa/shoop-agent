/**
 * Turns a stylist verdict into catalog search queries for the reading card.
 * Pure / client-safe — search I/O lives in run-reading-looks.ts.
 * Palette swatches stay hex/name — they are not catalog queries.
 */

import type { StylistVerdict } from "./verdict";

export type ReadingLookKind = "buy" | "look";

export type ReadingLookQuery = {
  key: string;
  kind: ReadingLookKind;
  query: string;
  lookId?: string;
  lookLabel?: string;
};

export type ReadingLookProduct = {
  id: string;
  title: string;
  imageUrl: string;
  price: { amount: number; currency: string } | null;
};

export type ReadingLookItem = ReadingLookQuery & {
  product: ReadingLookProduct | null;
};

const LOOK_COUNT = 3;
const PIECES_PER_LOOK = 4;
const MAX_QUERIES = LOOK_COUNT * PIECES_PER_LOOK;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asStr).filter(Boolean);
}

function clipQuery(parts: Array<string | null | undefined>, max = 72): string {
  return parts
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, max);
}

function pieceKey(piece: string): string {
  return piece.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Strip colourway suffixes so two washes of the same shirt count as one. */
export function productTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*[-–|/].*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

function pushQuery(
  out: ReadingLookQuery[],
  keys: Set<string>,
  q: ReadingLookQuery,
) {
  const query = q.query.trim();
  if (!query || keys.has(q.key)) return;
  keys.add(q.key);
  out.push({ ...q, query });
}

function buyQueries(verdict: StylistVerdict): ReadingLookQuery[] {
  const out: ReadingLookQuery[] = [];
  const keys = new Set<string>();
  const plan = asRecord(verdict.wardrobe_plan);
  const prios = Array.isArray(plan?.shopping_priorities)
    ? plan.shopping_priorities
    : [];
  for (const raw of prios) {
    const o = asRecord(raw);
    if (!o) continue;
    const item = asStr(o.item);
    if (!item) continue;
    pushQuery(out, keys, {
      key: `buy:${item.toLowerCase()}`,
      kind: "buy",
      query: clipQuery([
        asStrArr(o.preferred_colors)[0],
        item,
        asStr(o.specification),
      ]),
    });
  }
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  for (const raw of actions) {
    const o = asRecord(raw);
    if (asStr(o?.action) !== "add") continue;
    const item = asStr(o?.item_or_category);
    if (!item) continue;
    pushQuery(out, keys, {
      key: `buy:${item.toLowerCase()}`,
      kind: "buy",
      query: clipQuery([item]),
    });
  }
  const playbook = Array.isArray(verdict.garment_playbook)
    ? verdict.garment_playbook
    : [];
  for (const raw of playbook) {
    const o = asRecord(raw);
    if (!o || asStr(o.importance) !== "core") continue;
    const category = asStr(o.category);
    const kw = asStrArr(o.shopping_keywords)[0];
    if (!category && !kw) continue;
    pushQuery(out, keys, {
      key: `buy:${(kw || category).toLowerCase()}`,
      kind: "buy",
      query: clipQuery([asStrArr(o.colors)[0], kw || category]),
    });
  }
  return out;
}

function lookQueries(verdict: StylistVerdict): ReadingLookQuery[] {
  const out: ReadingLookQuery[] = [];
  const keys = new Set<string>();
  const formulas = Array.isArray(verdict.outfit_formulas)
    ? verdict.outfit_formulas
    : [];
  formulas.slice(0, LOOK_COUNT).forEach((raw, i) => {
    const o = asRecord(raw);
    if (!o) return;
    const occasion = asStr(o.occasion) || `Look ${i + 1}`;
    const color = asStrArr(o.color_options)[0];
    const pieces = [
      ...asStrArr(o.formula).slice(0, 3),
      ...asStrArr(o.footwear).slice(0, 1),
    ];
    const usedPiece = new Set<string>();
    let slot = 0;
    for (const piece of pieces) {
      if (slot >= PIECES_PER_LOOK) break;
      const pk = pieceKey(piece);
      if (!pk || usedPiece.has(pk)) continue;
      usedPiece.add(pk);
      pushQuery(out, keys, {
        key: `look:${i}:${slot}`,
        kind: "look",
        lookId: `look-${i}`,
        lookLabel: occasion,
        query: clipQuery([color, piece]),
      });
      slot += 1;
    }
  });
  return out;
}

/** Looks first (full outfits), then leftover buy slots. Colours are not searched. */
export function readingLookQueries(
  verdict: StylistVerdict | null | undefined,
): ReadingLookQuery[] {
  if (!verdict) return [];
  const looks = lookQueries(verdict);
  const room = Math.max(0, MAX_QUERIES - looks.length);
  return room ? [...looks, ...buyQueries(verdict).slice(0, room)] : looks;
}

export function pickLookProduct(
  candidates: ReadingLookProduct[],
  usedIds: Set<string>,
  usedTitlesInLook: Set<string>,
): ReadingLookProduct | null {
  for (const product of candidates) {
    const titleKey = productTitleKey(product.title);
    if (usedIds.has(product.id)) continue;
    if (titleKey && usedTitlesInLook.has(titleKey)) continue;
    return product;
  }
  return null;
}

export function uniqueLookProducts(
  products: ReadingLookProduct[],
): ReadingLookProduct[] {
  const usedIds = new Set<string>();
  const usedTitles = new Set<string>();
  const out: ReadingLookProduct[] = [];
  for (const product of products) {
    const picked = pickLookProduct([product], usedIds, usedTitles);
    if (!picked) continue;
    usedIds.add(picked.id);
    const titleKey = productTitleKey(picked.title);
    if (titleKey) usedTitles.add(titleKey);
    out.push(picked);
  }
  return out;
}

export function productForStep(
  why: string,
  items: ReadingLookItem[],
): ReadingLookProduct | null {
  const hay = why.toLowerCase();
  if (!hay) return null;
  for (const item of items) {
    if (item.kind !== "buy" || !item.product) continue;
    const tokens = item.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3);
    if (tokens.some((t) => hay.includes(t))) return item.product;
  }
  return null;
}
