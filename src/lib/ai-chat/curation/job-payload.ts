import { z } from "zod";
import type { CatalogSearchContext } from "@/lib/shopify/catalog";
import type { ShoppingModeMetaV1 } from "../types";
import type { ShopifySearchToolInput } from "../shopify-search-tool";
import { shopifySearchToolInputSchema } from "../shopify-search-tool";
import type { ShopifySearchProductCard } from "../shopify-search-tool";

const cardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
  })
  .passthrough();

export const productCurationJobPayloadSchema = z.object({
  searchInput: shopifySearchToolInputSchema,
  cards: z.array(cardSchema),
  displayLimit: z.number().int().min(1).max(24),
  memoryQueryHint: z.string(),
  preBuiltMemoryXml: z.string().optional(),
  userMessageId: z.string().nullable().optional(),
  buyerContext: z
    .object({
      shipsToCountry: z.string().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  shoppingModeMeta: z
    .object({
      version: z.literal(1),
      mode: z.string(),
      source: z.enum(["user", "auto"]),
      /** Stored as null when auto-detect finds no niche context. */
      reason: z.string().nullish(),
      contextTag: z.string().nullish(),
    })
    .nullable()
    .optional(),
  /** Reserved at enqueue time so detached curator runs still land in PromptRun audit. */
  promptSequence: z.number().int().min(0).optional(),
});

export type ProductCurationJobPayload = {
  searchInput: ShopifySearchToolInput;
  cards: ShopifySearchProductCard[];
  displayLimit: number;
  memoryQueryHint: string;
  preBuiltMemoryXml?: string;
  userMessageId?: string | null;
  buyerContext?: {
    shipsToCountry?: string;
    context?: CatalogSearchContext;
  };
  shoppingModeMeta?: ShoppingModeMetaV1 | null;
  promptSequence?: number;
};

export function parseProductCurationJobPayload(
  raw: unknown,
): ProductCurationJobPayload | null {
  const parsed = productCurationJobPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data as ProductCurationJobPayload;
}
