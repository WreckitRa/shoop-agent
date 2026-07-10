import { fashionMemoryDb } from "../db";
import { preNormalize } from "./pre-normalize";
import type { ColorBucket, NormalizedSize, SizeCategory } from "./types";

function cacheUnavailable(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("supabase")
  );
}

async function safeCacheLoad<T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (cacheUnavailable(error)) return fallback;
    throw error;
  }
}

export type ColorCacheRow = {
  raw_label: string;
  canonical: ColorBucket[];
};

export type SizeCacheRow = {
  raw_label: string;
  category: SizeCategory;
  canonical: NormalizedSize | null;
};

export async function loadColorLabelMap(
  rawLabels: string[],
): Promise<Map<string, ColorCacheRow>> {
  return safeCacheLoad(async () => {
    const keys = [...new Set(rawLabels.map(preNormalize).filter(Boolean))];
    const out = new Map<string, ColorCacheRow>();
    if (!keys.length) return out;

    const { data, error } = await fashionMemoryDb()
      .from("color_label_map")
      .select("raw_label, canonical")
      .in("raw_label", keys);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      out.set(row.raw_label, {
        raw_label: row.raw_label,
        canonical: (row.canonical ?? []) as ColorBucket[],
      });
    }
    return out;
  }, new Map());
}

export async function loadSizeLabelMap(
  entries: Array<{ raw_label: string; category: SizeCategory }>,
): Promise<Map<string, SizeCacheRow>> {
  return safeCacheLoad(async () => {
    const out = new Map<string, SizeCacheRow>();
    if (!entries.length) return out;

    const keys = [...new Set(entries.map((e) => preNormalize(e.raw_label)).filter(Boolean))];
    const categories = [...new Set(entries.map((e) => e.category))];

    const { data, error } = await fashionMemoryDb()
      .from("size_label_map")
      .select("raw_label, category, canonical")
      .in("raw_label", keys)
      .in("category", categories);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const key = `${row.raw_label}::${row.category}`;
      out.set(key, {
        raw_label: row.raw_label,
        category: row.category as SizeCategory,
        canonical: row.canonical as NormalizedSize | null,
      });
    }

    const missing = entries.filter((e) => {
      const k = `${preNormalize(e.raw_label)}::${e.category}`;
      return !out.has(k);
    });
    if (missing.length) {
      const generalKeys = [...new Set(missing.map((m) => preNormalize(m.raw_label)))];
      const { data: generalData } = await fashionMemoryDb()
        .from("size_label_map")
        .select("raw_label, category, canonical")
        .in("raw_label", generalKeys)
        .eq("category", "general");
      for (const row of generalData ?? []) {
        const key = `${row.raw_label}::general`;
        if (!out.has(key)) {
          out.set(key, {
            raw_label: row.raw_label,
            category: "general",
            canonical: row.canonical as NormalizedSize | null,
          });
        }
      }
    }

    return out;
  }, new Map());
}

export async function writeColorLabelMap(rows: ColorCacheRow[]): Promise<void> {
  if (!rows.length) return;
  // Postgres upsert can't touch the same conflict target twice in one batch.
  const byKey = new Map<string, ColorCacheRow>();
  for (const row of rows) byKey.set(row.raw_label, row);
  const { error } = await fashionMemoryDb()
    .from("color_label_map")
    .upsert(
      [...byKey.values()].map((row) => ({
        raw_label: row.raw_label,
        canonical: row.canonical,
        source: "llm",
      })),
      { onConflict: "raw_label" },
    );
  if (error) throw new Error(error.message);
}

export async function writeSizeLabelMap(rows: SizeCacheRow[]): Promise<void> {
  if (!rows.length) return;
  // Dedupe by the (raw_label, category) conflict key to avoid
  // "ON CONFLICT DO UPDATE cannot affect row a second time".
  const byKey = new Map<string, SizeCacheRow>();
  for (const row of rows) byKey.set(`${row.raw_label}::${row.category}`, row);
  const { error } = await fashionMemoryDb()
    .from("size_label_map")
    .upsert(
      [...byKey.values()].map((row) => ({
        raw_label: row.raw_label,
        category: row.category,
        canonical: row.canonical ?? {},
        source: "llm",
      })),
      { onConflict: "raw_label,category" },
    );
  if (error) throw new Error(error.message);
}

export function sizeCacheKey(rawLabel: string, category: SizeCategory): string {
  return `${preNormalize(rawLabel)}::${category}`;
}
