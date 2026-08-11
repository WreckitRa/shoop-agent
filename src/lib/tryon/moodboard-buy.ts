/**
 * Resolve moodboard try-on → cart-ready lines (variant + checkout URL).
 */
import { loadBuyerCatalogContext } from "@/lib/ai-chat/buyer-catalog/search-hints";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  buildCatalogCallContext,
  getProduct,
  isVariantStockPurchasable,
} from "@/lib/shopify/catalog";
import { prisma } from "@/lib/ai-chat/db";
import {
  buyablesFromInputRefs,
  parseCatalogRef,
  type MoodboardBuyable,
} from "@/lib/tryon/moodboard-context";

export type MoodboardCheckoutLine = {
  productId: string;
  title: string;
  imageUrl?: string;
  variantId: string;
  checkoutUrl: string;
  priceCents: number | null;
  currency: string | null;
  shopDomain: string | null;
};

function shopDomainFromCheckoutUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function variantPrice(
  variant: { price?: { amount: number; currency: string } } | undefined,
): { amount: number; currency: string } | undefined {
  return variant?.price;
}

export async function resolveMoodboardCheckoutLines(params: {
  userId: string;
  generationId: string;
}): Promise<{ lines: MoodboardCheckoutLine[]; skipped: number }> {
  const row = await prisma.tryonGeneration.findFirst({
    where: { id: params.generationId, userId: params.userId },
    select: { inputRefs: true, productRef: true },
  });
  if (!row) return { lines: [], skipped: 0 };

  const inputRefs = asRecord(row.inputRefs);
  const buyables: MoodboardBuyable[] = buyablesFromInputRefs(inputRefs);
  if (row.productRef?.includes("catalog:")) {
    for (const part of row.productRef.split("|")) {
      const parsed = parseCatalogRef(part);
      if (
        parsed &&
        !buyables.some((b) => b.productId === parsed.productId)
      ) {
        buyables.push(parsed);
      }
    }
  }

  if (!buyables.length) return { lines: [], skipped: 0 };

  const accessToken = await accessTokenForCatalogMcp();
  const buyer = await loadBuyerCatalogContext(params.userId, "").catch(
    () => null,
  );
  const filters =
    buyer?.shipsToCountry
      ? { ships_to: { country: buyer.shipsToCountry.toUpperCase() } }
      : undefined;
  const context = buildCatalogCallContext(filters ?? {}, buyer?.context);

  const lines: MoodboardCheckoutLine[] = [];
  let skipped = 0;

  for (const buyable of buyables.slice(0, 6)) {
    try {
      const result = await getProduct(accessToken, buyable.productId, [], {
        context,
        filters,
      });
      const product = result.product;
      if (!product) {
        skipped += 1;
        continue;
      }
      const variant =
        (buyable.variantId
          ? product.variants?.find((v) => v.id === buyable.variantId)
          : null) ??
        product.variants?.find((v) => isVariantStockPurchasable(v)) ??
        product.variants?.find((v) => v.id && v.checkout_url) ??
        product.variants?.[0];
      const checkoutUrl = variant?.checkout_url?.trim();
      if (!variant?.id || !checkoutUrl) {
        skipped += 1;
        continue;
      }
      const price = variantPrice(variant) ?? buyable.price;
      lines.push({
        productId: buyable.productId,
        title: buyable.title?.trim() || product.title || "Product",
        imageUrl: buyable.imageUrl,
        variantId: variant.id,
        checkoutUrl,
        priceCents: price?.amount ?? null,
        currency: price?.currency ?? null,
        shopDomain: shopDomainFromCheckoutUrl(checkoutUrl),
      });
    } catch {
      skipped += 1;
    }
  }

  return { lines, skipped };
}
