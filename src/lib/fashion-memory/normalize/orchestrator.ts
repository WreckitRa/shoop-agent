import { logAiChat } from "@/lib/ai-chat/observability";
import { recordPipelineEvent } from "../observability/trace";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";
import {
  loadColorLabelMap,
  loadSizeLabelMap,
  sizeCacheKey,
  writeColorLabelMap,
  writeSizeLabelMap,
  type ColorCacheRow,
  type SizeCacheRow,
} from "./cache";
import { resolveColorDeterministic } from "./color";
import {
  classifyLabelsWithLlm,
  type ClassifyLabelsResult,
} from "./llm-classify";
import {
  classifyVariantOption,
  garmentToSizeCategory,
} from "./option-classifier";
import { preNormalize } from "./pre-normalize";
import { resolveSizeDeterministic } from "./size";
import {
  COLOR_BUCKETS,
  type ColorBucket,
  type NormalizeMetrics,
  type NormalizedSize,
  type ProductNormalization,
  type SizeCategory,
  type SlotNormalizeInput,
} from "./types";

type ColorResolved = {
  buckets: ColorBucket[];
  status: "resolved" | "unknown";
};

type SizeResolved = {
  size: NormalizedSize | null;
  status: "resolved" | "unknown";
};

type LabelCollection = {
  colors: Set<string>;
  sizes: Map<string, SizeCategory>;
};

function collectLabels(
  slots: SlotNormalizeInput[],
): LabelCollection {
  const colors = new Set<string>();
  const sizes = new Map<string, SizeCategory>();

  for (const slot of slots) {
    const category = garmentToSizeCategory(slot.garment);
    for (const product of slot.products) {
      for (const opt of product.variant_options) {
        const kind = classifyVariantOption(opt.name, opt.value, category);
        if (kind === "color") colors.add(opt.value);
        if (kind === "size") sizes.set(opt.value, category);
      }
    }
  }

  return { colors, sizes };
}

function colorFromCache(row: ColorCacheRow): ColorResolved {
  const buckets = row.canonical.filter((b): b is ColorBucket =>
    (COLOR_BUCKETS as readonly string[]).includes(b),
  );
  if (!buckets.length || (buckets.length === 1 && buckets[0] === "unknown")) {
    return { buckets: buckets.length ? buckets : ["unknown"], status: "unknown" };
  }
  return { buckets, status: "resolved" };
}

function sizeFromCache(row: SizeCacheRow): SizeResolved {
  if (!row.canonical || Object.keys(row.canonical).length === 0) {
    return { size: null, status: "unknown" };
  }
  return { size: row.canonical, status: "resolved" };
}

function annotateProduct(
  product: FashionSlotCatalogProduct,
  category: SizeCategory,
  colorMap: Map<string, ColorResolved>,
  sizeMap: Map<string, SizeResolved>,
): ProductNormalization {
  const colorBuckets = new Set<ColorBucket>();
  let anyColorResolved = false;
  const sizes: ProductNormalization["sizes"] = [];

  for (const opt of product.variant_options) {
    const kind = classifyVariantOption(opt.name, opt.value, category);
    if (kind === "color") {
      const key = preNormalize(opt.value);
      const resolved = colorMap.get(key);
      if (resolved) {
        for (const bucket of resolved.buckets) colorBuckets.add(bucket);
        if (resolved.status === "resolved") anyColorResolved = true;
      }
    } else if (kind === "size") {
      const key = sizeCacheKey(opt.value, category);
      const resolved =
        sizeMap.get(key) ??
        sizeMap.get(sizeCacheKey(opt.value, "general"));
      sizes.push({
        raw: opt.value,
        size: resolved?.size ?? null,
        status: resolved?.status ?? "unknown",
      });
    }
  }

  return {
    colors: {
      buckets: [...colorBuckets],
      status: anyColorResolved ? "resolved" : "unknown",
    },
    sizes,
  };
}

function applyLlmResults(params: {
  llm: ClassifyLabelsResult;
  colorMap: Map<string, ColorResolved>;
  sizeMap: Map<string, SizeResolved>;
  metrics: NormalizeMetrics;
}): { colorWrites: ColorCacheRow[]; sizeWrites: SizeCacheRow[] } {
  const colorWrites: ColorCacheRow[] = [];
  const sizeWrites: SizeCacheRow[] = [];

  for (const row of params.llm.colors) {
    const key = preNormalize(row.raw);
    const buckets = row.buckets as ColorBucket[];
    const status = buckets.length === 1 && buckets[0] === "unknown" ? "unknown" : "resolved";
    params.colorMap.set(key, { buckets, status });
    colorWrites.push({ raw_label: key, canonical: buckets });
    if (status === "resolved") params.metrics.llm_resolved += 1;
    else params.metrics.llm_unknown += 1;
  }

  for (const row of params.llm.sizes) {
    const key = preNormalize(row.raw);
    const category = row.category as SizeCategory;
    const mapKey = sizeCacheKey(row.raw, category);
    const status = row.size ? "resolved" : "unknown";
    params.sizeMap.set(mapKey, { size: row.size, status });
    sizeWrites.push({
      raw_label: key,
      category,
      canonical: row.size,
    });
    if (status === "resolved") params.metrics.llm_resolved += 1;
    else params.metrics.llm_unknown += 1;
  }

  return { colorWrites, sizeWrites };
}

export type NormalizeCacheDeps = {
  loadColorLabelMap: typeof loadColorLabelMap;
  loadSizeLabelMap: typeof loadSizeLabelMap;
  writeColorLabelMap: typeof writeColorLabelMap;
  writeSizeLabelMap: typeof writeSizeLabelMap;
};

export async function normalizeCatalogSearchSlots<T extends SlotNormalizeInput>(
  params: {
    traceId?: string | null;
    slots: T[];
    signal?: AbortSignal;
    classifyLabels?: typeof classifyLabelsWithLlm;
    cache?: Partial<NormalizeCacheDeps>;
  },
): Promise<{ slots: T[]; metrics: NormalizeMetrics }> {
  const started = Date.now();
  const metrics: NormalizeMetrics = {
    labels_total: 0,
    cache_hits: 0,
    deterministic_hits: 0,
    fuzzy_hits: 0,
    llm_resolved: 0,
    llm_unknown: 0,
    ms: 0,
  };

  const collected = collectLabels(params.slots);
  const colorLabels = [...collected.colors];
  const sizeEntries = [...collected.sizes.entries()].map(([raw, category]) => ({
    raw_label: raw,
    category,
  }));

  metrics.labels_total = colorLabels.length + sizeEntries.length;

  const colorMap = new Map<string, ColorResolved>();
  const sizeMap = new Map<string, SizeResolved>();

  let colorCache: Map<string, ColorCacheRow> = new Map();
  let sizeCache: Map<string, SizeCacheRow> = new Map();

  const loadColor = params.cache?.loadColorLabelMap ?? loadColorLabelMap;
  const loadSize = params.cache?.loadSizeLabelMap ?? loadSizeLabelMap;
  const writeColor = params.cache?.writeColorLabelMap ?? writeColorLabelMap;
  const writeSize = params.cache?.writeSizeLabelMap ?? writeSizeLabelMap;

  try {
    [colorCache, sizeCache] = await Promise.all([
      loadColor(colorLabels),
      loadSize(sizeEntries),
    ]);
  } catch (error) {
    logAiChat("warn", "fashion_normalize_cache_load_failed", {
      error: String(error).slice(0, 240),
    });
  }

  const unresolvedColors: string[] = [];
  const unresolvedSizes: Array<{ raw: string; category: SizeCategory }> = [];

  for (const raw of colorLabels) {
    const key = preNormalize(raw);
    const cached = colorCache.get(key);
    if (cached) {
      colorMap.set(key, colorFromCache(cached));
      metrics.cache_hits += 1;
      continue;
    }

    const det = resolveColorDeterministic(raw);
    if (det.resolved) {
      colorMap.set(key, { buckets: det.buckets, status: "resolved" });
      if (det.via === "fuzzy") metrics.fuzzy_hits += 1;
      else metrics.deterministic_hits += 1;
      continue;
    }
    unresolvedColors.push(raw);
  }

  for (const { raw_label: raw, category } of sizeEntries) {
    const key = sizeCacheKey(raw, category);
    const cached =
      sizeCache.get(`${preNormalize(raw)}::${category}`) ??
      sizeCache.get(`${preNormalize(raw)}::general`);
    if (cached) {
      sizeMap.set(key, sizeFromCache(cached));
      metrics.cache_hits += 1;
      continue;
    }

    const det = resolveSizeDeterministic(raw, category);
    if (det.resolved) {
      sizeMap.set(key, { size: det.size, status: "resolved" });
      metrics.deterministic_hits += 1;
      continue;
    }
    unresolvedSizes.push({ raw, category });
  }

  if (unresolvedColors.length || unresolvedSizes.length) {
    const classify = params.classifyLabels ?? classifyLabelsWithLlm;
    const { NORMALIZE_HARD_MS, NORMALIZE_TRIPWIRE_MS } = await import(
      "../pipeline-cutoffs"
    );
    let normalizeTripwire = false;
    const tripwireTimer =
      NORMALIZE_TRIPWIRE_MS > 0
        ? setTimeout(() => {
            normalizeTripwire = true;
            logAiChat("warn", "fashion_normalize_tripwire", {
              traceId: params.traceId,
              tripwire_ms: NORMALIZE_TRIPWIRE_MS,
            });
          }, NORMALIZE_TRIPWIRE_MS)
        : null;

    const llmStarted = Date.now();
    let llm: ClassifyLabelsResult | null = null;
    try {
      // Fail-open must be instantaneous at the hard cutoff — Promise.race so we
      // never bill 2× wall when the SDK abort is slow (incident 0e1c21fa).
      const classifyPromise = classify({
        batch: { colors: unresolvedColors, sizes: unresolvedSizes },
        traceId: params.traceId,
        signal: params.signal,
      }).catch(() => null);

      llm = await Promise.race([
        classifyPromise,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), NORMALIZE_HARD_MS);
        }),
      ]);

      if (llm == null && Date.now() - llmStarted >= NORMALIZE_HARD_MS - 50) {
        logAiChat("warn", "fashion_normalize_hard_cutoff", {
          traceId: params.traceId,
          tripwire_fired: normalizeTripwire,
          hard_ms: NORMALIZE_HARD_MS,
          wall_ms: Date.now() - llmStarted,
        });
      }
    } catch (error) {
      logAiChat("warn", "fashion_normalize_hard_cutoff", {
        traceId: params.traceId,
        tripwire_fired: normalizeTripwire,
        error: String(error).slice(0, 200),
      });
      llm = null;
    } finally {
      if (tripwireTimer) clearTimeout(tripwireTimer);
    }

    if (llm) {
      const { colorWrites, sizeWrites } = applyLlmResults({
        llm,
        colorMap,
        sizeMap,
        metrics,
      });
      try {
        await Promise.all([
          writeColor(colorWrites),
          writeSize(sizeWrites),
        ]);
      } catch (error) {
        logAiChat("warn", "fashion_normalize_cache_write_failed", {
          error: String(error).slice(0, 240),
        });
      }
    } else {
      for (const raw of unresolvedColors) {
        const key = preNormalize(raw);
        colorMap.set(key, { buckets: ["unknown"], status: "unknown" });
        metrics.llm_unknown += 1;
      }
      for (const { raw, category } of unresolvedSizes) {
        sizeMap.set(sizeCacheKey(raw, category), { size: null, status: "unknown" });
        metrics.llm_unknown += 1;
      }
    }
  }

  for (const slot of params.slots) {
    const category = garmentToSizeCategory(slot.garment);
    for (const product of slot.products as FashionSlotCatalogProduct[]) {
      product.normalized = annotateProduct(product, category, colorMap, sizeMap);
    }
  }

  metrics.ms = Date.now() - started;

  recordPipelineEvent({
    traceId: params.traceId,
    stage: "normalize",
    payload: { ...metrics },
  });

  return { slots: params.slots, metrics };
}
