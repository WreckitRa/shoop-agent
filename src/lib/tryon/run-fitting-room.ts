import { loadSearchState } from "@/lib/fashion-memory/curation/search-context";
import { ensureSelfPerson } from "@/lib/fashion-memory/people";
import { loadBuyerCatalogContext } from "@/lib/ai-chat/shopping-memory/search-hints";
import { accessTokenForCatalogMcp } from "@/lib/shopify/catalog-auth";
import {
  buildCatalogCallContext,
  collectCatalogImageUrls,
  getProduct,
  type SelectedOption,
} from "@/lib/shopify/catalog";
import { getStoredAvatar } from "./avatar/service";
import { isTryonEnabledForUser } from "./feature-flags";
import { mapSlotToGarmentType, sortRefsForOutfitChain } from "./garment-type";
import { resolvePickFromSearch } from "./run-single";
import { startResolvedOutfitTryon } from "./run-outfit";
import type { FittingRoomItemDescriptor } from "./fitting-room-types";
import { fittingRoomLookId } from "./fitting-room-types";

/** Resolve same-origin static assets so FASHN can fetch them. */
export function toAbsolutePublicUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  const envBase =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = envBase || "http://localhost:3000";
  return `${base}${path}`;
}

export type ResolvedFittingRoomItem = {
  ref: string;
  garment: string;
  imageUrl?: string;
  title?: string;
  displayPrice?: { amount: number; currency: string };
  productId?: string;
  searchId?: string;
  tryonSupported: boolean;
};

export async function resolveFittingRoomItems(params: {
  userId: string;
  descriptors: FittingRoomItemDescriptor[];
}): Promise<ResolvedFittingRoomItem[]> {
  const resolved: ResolvedFittingRoomItem[] = [];
  const searchCache = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof loadSearchState>>>
  >();

  for (const descriptor of params.descriptors) {
    if (descriptor.provenance.kind === "search") {
      const { searchId, ref } = descriptor.provenance;
      let state = searchCache.get(searchId);
      if (!state) {
        state = (await loadSearchState(searchId, params.userId)) ?? undefined;
        if (state) searchCache.set(searchId, state);
      }
      if (!state) throw new Error("Search not found");
      const pick = resolvePickFromSearch(state, ref);
      if (!pick?.imageUrl) throw new Error("Pick not found");
      const garment =
        pick.garment ??
        pick.pick?.garment ??
        pick.title ??
        ref;
      resolved.push({
        ref,
        garment,
        imageUrl: pick.imageUrl,
        title: pick.title,
        displayPrice: pick.displayPrice,
        productId: pick.pick?.id,
        searchId,
        tryonSupported: Boolean(mapSlotToGarmentType(garment, pick.title)),
      });
      continue;
    }

    if (descriptor.provenance.kind === "image") {
      const { imageUrl, title, garment, styleId } = descriptor.provenance;
      if (!imageUrl?.trim()) throw new Error("Image URL required");
      const absolute = toAbsolutePublicUrl(imageUrl.trim());
      const label = (title ?? garment ?? styleId ?? "styled outfit dress look").trim();
      // Full-look style photos: treat as one-piece dress so chain always supports them.
      const garmentLabel =
        garment?.trim() ||
        `${label} dress look`;
      resolved.push({
        ref: `image:${styleId ?? absolute}`,
        garment: garmentLabel.includes("dress")
          ? garmentLabel
          : `${garmentLabel} dress`,
        imageUrl: absolute,
        title: label,
        tryonSupported: true,
      });
      continue;
    }

    const { productId, variantId, preferredOptions } = descriptor.provenance;
    const accessToken = await accessTokenForCatalogMcp();
    const buyer = await loadBuyerCatalogContext(params.userId, "").catch(
      () => null,
    );
    const filters =
      buyer?.shipsToCountry ?
        { ships_to: { country: buyer.shipsToCountry.toUpperCase() } }
      : undefined;
    const context = buildCatalogCallContext(filters ?? {}, buyer?.context);
    const selected: SelectedOption[] = preferredOptions ?? [];
    const result = await getProduct(accessToken, productId, selected, {
      context,
      filters,
    });
    const product = result.product;
    if (!product) throw new Error("Product not found");

    const images = collectCatalogImageUrls(product);
    const imageUrl = images[0];
    const title = product.title ?? "Product";
    const garment = title;
    const variant =
      product.variants?.find((v) => v.id === variantId) ??
      product.variants?.[0];
    const ref = `catalog:${productId}${variant?.id ? `:${variant.id}` : ""}`;

    resolved.push({
      ref,
      garment,
      imageUrl,
      title,
      displayPrice: variant?.price,
      productId,
      tryonSupported: Boolean(mapSlotToGarmentType(garment, title)),
    });
  }

  return resolved;
}

export async function startFittingRoomRender(params: {
  userId: string;
  descriptors: FittingRoomItemDescriptor[];
}): Promise<{
  jobId: string;
  disclaimer: string;
}> {
  if (params.descriptors.length === 0) {
    throw new Error("Select at least one garment to try on.");
  }
  if (params.descriptors.length > 6) {
    throw new Error("Fitting room supports up to six garments at a time.");
  }

  if (!(await isTryonEnabledForUser(params.userId))) {
    throw new Error("Try-on not enabled");
  }

  const self = await ensureSelfPerson(params.userId);
  const avatar = await getStoredAvatar(params.userId, self.id);
  if (!avatar) throw new Error("Avatar required");

  const items = await resolveFittingRoomItems(params);
  const supported = items.filter((item) => item.tryonSupported && item.imageUrl);
  if (!supported.length) {
    throw new Error("No supported garments to try on.");
  }

  const chain = sortRefsForOutfitChain(
    supported.map((item) => ({
      ref: item.ref,
      garment: item.garment,
      title: item.title,
    })),
  );
  if (!chain.length) {
    throw new Error("No supported garments to try on.");
  }

  const activeRefs = chain.map((step) => step.ref);
  const lookId = fittingRoomLookId(activeRefs);
  const primarySearchId =
    items.find((item) => item.searchId)?.searchId ?? "fitting-room";

  return startResolvedOutfitTryon({
    userId: params.userId,
    personId: self.id,
    lookId,
    searchId: primarySearchId,
    items: supported.filter((item) => activeRefs.includes(item.ref)),
  });
}
