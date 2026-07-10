import { prisma } from "../../db";
import { getProduct, lookupCatalog, type CatalogProductDetail, type CatalogProductSummary } from "@/lib/shopify/catalog";
import { briefFromSearchInput } from "../../shopify-search-tool";
import type { CuratedPick, MessageMetadata, ProductSearchInvocation } from "../../types";
import type { SearchBrief } from "../types";
import type { FindSimilarPayload, SimilarSearchContext } from "./types";
import { normalizeFindSimilarSeeds } from "./types";
import { candidatePriceCents } from "../pool";
import { findSimilarSearchQuery } from "./action";
import {
  buildFindSimilarExcludedKeys,
  relaxBriefForFindSimilar,
} from "./relax-brief";

function pickFromInvocation(
  inv: ProductSearchInvocation,
  productId: string,
): CuratedPick | null {
  const curated = inv.curatedPicks?.find((p) => p.id === productId);
  if (curated) return curated;
  const card = inv.products.find((p) => p.id === productId);
  if (!card) return null;
  return {
    ...card,
    slot: "gallery",
    reason: "",
    verdict: "buy",
    insight: {
      retailerCheckNote: "",
      fitReasons: ["", "", ""],
      checkedItems: [],
      pickStory: "",
      changeMindItems: [],
    },
  };
}

function briefFromInvocation(
  inv: ProductSearchInvocation,
  currency: string,
): SearchBrief {
  return briefFromSearchInput(
    {
      query: inv.query,
      intent: inv.intent,
      filters: inv.filters
        ? {
            price_min_cents: inv.filters.price_min_cents,
            price_max_cents: inv.filters.price_max_cents,
            condition: inv.filters.condition as
              | ("new" | "secondhand" | "refurbished")[]
              | undefined,
            ships_to_country: inv.filters.ships_to_country,
          }
        : undefined,
      archetype: inv.archetype,
      direction_label: inv.directionLabel,
    },
    { defaultCurrency: currency },
  );
}

export type LoadedFindSimilarContext = {
  similar: SimilarSearchContext;
  brief: SearchBrief;
  pick: CuratedPick;
  seedCatalog?: CatalogProductSummary;
  seedCatalogDetail?: CatalogProductDetail;
};

export async function loadFindSimilarContext(params: {
  conversationId: string;
  payload: FindSimilarPayload;
  accessToken: string;
  currency: string;
  hypothesis: import("./types").TasteHypothesis | null;
  bouncedSameSeed?: boolean;
}): Promise<LoadedFindSimilarContext | null> {
  const row = await prisma.message.findUnique({
    where: { id: params.payload.sourceMessageId },
    select: { id: true, conversationId: true, metadata: true },
  });
  if (!row || row.conversationId !== params.conversationId) return null;

  const [primarySeed] = normalizeFindSimilarSeeds(params.payload);
  if (!primarySeed) return null;

  const meta = row.metadata as MessageMetadata | null;
  const searches = meta?.productSearch?.searches ?? [];
  let invocation: ProductSearchInvocation | null = null;
  let seed: CuratedPick | null = null;

  for (const inv of searches) {
    const hit = pickFromInvocation(inv, primarySeed.productId);
    if (hit) {
      invocation = inv;
      seed = hit;
      break;
    }
  }
  if (!seed || !invocation) return null;

  const siblings =
    invocation.curatedPicks?.filter((p) => p.id !== seed!.id) ?? [];

  let seedCatalog: CatalogProductSummary | undefined;
  let seedCatalogDetail: CatalogProductDetail | undefined;
  try {
    const got = await getProduct(params.accessToken, seed.id, [], {
      signal: undefined,
    });
    seedCatalogDetail = got.product;
    seedCatalog = got.product;
  } catch {
    try {
      const looked = await lookupCatalog(params.accessToken, [seed.id]);
      seedCatalog = looked.products?.[0];
    } catch {
      seedCatalog = undefined;
    }
  }

  const seedPriceCents =
    (seedCatalogDetail ? candidatePriceCents(seedCatalogDetail) : null) ??
    seed.displayPrice?.amount ??
    seed.priceRange?.min?.amount ??
    (seedCatalog ? candidatePriceCents(seedCatalog) : null);

  const similar: SimilarSearchContext = {
    seedProductId: seed.id,
    seedTitle: seed.title,
    seedUpid: params.payload.upid ?? primarySeed.upid ?? seed.upid,
    seedImageUrl: seed.imageUrl,
    seedPriceCents,
    seedDescription:
      seedCatalogDetail?.description?.text?.slice(0, 1200) ??
      (() => {
        const raw = seedCatalog as Record<string, unknown> | undefined;
        const d = raw?.description;
        return typeof d === "string" ? d : undefined;
      })(),
    seedOptions: seed.options,
    seedVendor:
      typeof (seedCatalog as Record<string, unknown> | undefined)?.vendor ===
      "string"
        ? String((seedCatalog as Record<string, unknown>).vendor)
        : undefined,
    siblingPicks: siblings,
    sourceMessageId: row.id,
    hypothesis: params.hypothesis,
    bouncedSameSeed: params.bouncedSameSeed,
  };

  const brief = relaxBriefForFindSimilar(
    briefFromInvocation(invocation, params.currency),
    seedPriceCents,
  );
  brief.similarToProductIds = [seed.id];
  brief.query = findSimilarSearchQuery(seed.title);

  return { similar, brief, pick: seed, seedCatalog, seedCatalogDetail };
}
