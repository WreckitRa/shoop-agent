import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ColorCacheRow, SizeCacheRow } from "./cache";
import { preNormalize } from "./pre-normalize";
import { normalizeCatalogSearchSlots } from "./orchestrator";
import type { ClassifyLabelsResult } from "./llm-classify";
import type { FashionSlotCatalogProduct } from "../catalog-search/types";

function makeProduct(
  variant_options: Array<{ name: string; value: string }>,
): FashionSlotCatalogProduct {
  return {
    product_id: "p1",
    title: "Test",
    variant_options,
    raw: { id: "p1", title: "Test" },
  } as FashionSlotCatalogProduct;
}

describe("normalizeCatalogSearchSlots integration", () => {
  it("cache miss → LLM → map write → second run zero LLM calls", async () => {
    const colorStore = new Map<string, ColorCacheRow>();
    const sizeStore = new Map<string, SizeCacheRow>();
    let llmCalls = 0;

    const cache = {
      loadColorLabelMap: async (labels: string[]) => {
        const out = new Map<string, ColorCacheRow>();
        for (const raw of labels) {
          const key = preNormalize(raw);
          const row = colorStore.get(key);
          if (row) out.set(key, row);
        }
        return out;
      },
      loadSizeLabelMap: async (
        entries: Array<{ raw_label: string; category: string }>,
      ) => {
        const out = new Map<string, SizeCacheRow>();
        for (const e of entries) {
          const key = `${preNormalize(e.raw_label)}::${e.category}`;
          const row = sizeStore.get(key);
          if (row) out.set(key, row);
        }
        return out;
      },
      writeColorLabelMap: async (rows: ColorCacheRow[]) => {
        for (const row of rows) colorStore.set(row.raw_label, row);
      },
      writeSizeLabelMap: async (rows: SizeCacheRow[]) => {
        for (const row of rows) {
          sizeStore.set(`${row.raw_label}::${row.category}`, row);
        }
      },
    };

    const classifyLabels = async (): Promise<ClassifyLabelsResult> => {
      llmCalls += 1;
      return {
        colors: [{ raw: "qzxv", buckets: ["unknown"] }],
        sizes: [
          {
            raw: "Taille 2",
            category: "tops",
            size: { numeric: 2, numeric_system: "eu", alpha: "S" },
          },
        ],
      };
    };

    const slots = [
      {
        slot_id: "s1",
        garment: "shirt",
        products: [
          makeProduct([
            { name: "Color", value: "Noir/Black" },
            { name: "Color", value: "qzxv" },
            { name: "Size", value: "m-38" },
            { name: "Size", value: "Taille 2" },
          ]),
        ],
      },
    ];

    const first = await normalizeCatalogSearchSlots({
      traceId: null,
      slots,
      classifyLabels,
      cache,
    });

    assert.equal(llmCalls, 1);
    assert.equal(first.metrics.deterministic_hits, 2);
    assert.equal(first.metrics.cache_hits, 0);
    assert.equal(first.metrics.llm_unknown, 1);
    assert.equal(first.metrics.llm_resolved, 1);
    assert.equal(colorStore.size, 1);
    assert.equal(sizeStore.size, 1);

    const product = first.slots[0]!.products[0]!;
    assert.ok(product.normalized?.colors.buckets.includes("black"));
    assert.equal(product.normalized?.colors.status, "resolved");
    assert.ok(product.normalized?.colors.buckets.includes("unknown"));
    assert.equal(product.normalized?.sizes.length, 2);
    const m38 = product.normalized?.sizes.find((s) => s.raw === "m-38");
    assert.equal(m38?.status, "resolved");
    assert.equal(m38?.size?.alpha, "M");
    assert.equal(m38?.size?.numeric, 38);
    assert.equal(m38?.size?.numeric_system, "ambiguous");

    const second = await normalizeCatalogSearchSlots({
      traceId: null,
      slots: [
        {
          slot_id: "s1",
          garment: "shirt",
          products: [
            makeProduct([
              { name: "Color", value: "Noir/Black" },
              { name: "Color", value: "qzxv" },
              { name: "Size", value: "m-38" },
              { name: "Size", value: "Taille 2" },
            ]),
          ],
        },
      ],
      classifyLabels,
      cache,
    });

    assert.equal(llmCalls, 1);
    assert.equal(second.metrics.cache_hits, 2);
    assert.ok(second.metrics.deterministic_hits >= 1);
  });
});
