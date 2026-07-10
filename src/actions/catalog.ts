"use server";

import { getAuthContext } from "@/lib/auth/session";
import { loadBuyerCatalogContext } from "@/lib/ai-chat/shopping-memory/search-hints";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  buildCatalogCallContext,
  getProduct,
  type CatalogProductDetail,
  type CatalogSearchFilters,
  type SelectedOption,
} from "@/lib/shopify/catalog";

export async function getProductAction(
  productId: string,
  selected: SelectedOption[],
  filtersForContext?: CatalogSearchFilters,
): Promise<{ product: CatalogProductDetail | undefined }> {
  const access_token = await accessTokenForCatalogMcp();

  const filters: CatalogSearchFilters = { ...(filtersForContext ?? {}) };
  let buyerContext = undefined;

  const auth = await getAuthContext();
  if (auth.ok) {
    const buyer = await loadBuyerCatalogContext(auth.userId, "").catch(
      () => null,
    );
    if (buyer?.shipsToCountry && !filters.ships_to) {
      filters.ships_to = { country: buyer.shipsToCountry.toUpperCase() };
    }
    buyerContext = buyer?.context;
  }

  const context = buildCatalogCallContext(filters, buyerContext);

  const result = await getProduct(access_token, productId, selected, {
    context,
    filters: Object.keys(filters).length ? filters : undefined,
  });
  return { product: result.product };
}

export type AttributedContinueUrl = { url: string };

export async function appendUtmToContinueUrlAction(
  continueUrl: string,
): Promise<AttributedContinueUrl> {
  const source = process.env.SHOPIFY_CONTINUE_URL_UTM_SOURCE?.trim();
  const medium = process.env.SHOPIFY_CONTINUE_URL_UTM_MEDIUM?.trim();
  const campaign = process.env.SHOPIFY_CONTINUE_URL_UTM_CAMPAIGN?.trim();
  if (!source && !medium && !campaign) {
    return { url: continueUrl };
  }
  const u = new URL(continueUrl);
  if (source) u.searchParams.set("utm_source", source);
  if (medium) u.searchParams.set("utm_medium", medium);
  if (campaign) u.searchParams.set("utm_campaign", campaign);
  return { url: u.toString() };
}
