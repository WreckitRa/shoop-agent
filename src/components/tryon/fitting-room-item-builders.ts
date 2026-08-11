import type { RenderPick } from "@/lib/fashion-memory/types/render-contract";
import type { ProductCard } from "@/lib/ai-chat/types";
import type { ActiveCartLine } from "@/lib/cart/types";
import {
  buildFittingRoomItemId,
  type FittingRoomItem,
} from "@/lib/tryon/fitting-room-types";

type SearchPickLike = Pick<
  RenderPick,
  | "ref"
  | "title"
  | "imageUrl"
  | "displayPrice"
  | "id"
  | "preferredOptions"
  | "featuredVariant"
  | "tryon"
  | "badges"
> & {
  garment?: string;
};

export function fittingRoomItemFromSearchPick(params: {
  pick: SearchPickLike;
  searchId: string;
}): FittingRoomItem {
  const { pick, searchId } = params;
  // Prefer catalog product identity — search refs die when message meta isn't
  // persisted yet or when layering looks across turns.
  const provenance =
    pick.id ?
      {
        kind: "product" as const,
        productId: pick.id,
        variantId: pick.featuredVariant?.id,
        preferredOptions: pick.preferredOptions,
      }
    : { kind: "search" as const, searchId, ref: pick.ref };
  return {
    id: buildFittingRoomItemId(provenance),
    title: pick.title,
    imageUrl: pick.imageUrl,
    price: pick.displayPrice,
    productId: pick.id,
    preferredOptions: pick.preferredOptions,
    featuredVariant: pick.featuredVariant,
    provenance,
    garment: pick.garment,
    // Optimistic until attach-render fills tryon — missing must not hide the CTA.
    tryonSupported:
      pick.tryon == null ? true : pick.tryon.available === true,
    badges: pick.badges,
    messageSearchId: searchId,
  };
}

export function fittingRoomItemFromProductCard(
  product: ProductCard,
  opts?: {
    variantId?: string;
    preferredOptions?: Array<{ name: string; label: string }>;
    tryonSupported?: boolean;
  },
): FittingRoomItem {
  const provenance = {
    kind: "product" as const,
    productId: product.id,
    variantId: opts?.variantId ?? product.featuredVariant?.id,
    preferredOptions: opts?.preferredOptions ?? product.preferredOptions,
  };
  return {
    id: buildFittingRoomItemId(provenance),
    title: product.title,
    imageUrl: product.imageUrl,
    price: product.displayPrice ?? product.featuredVariant?.price,
    productId: product.id,
    preferredOptions: provenance.preferredOptions,
    featuredVariant: product.featuredVariant,
    provenance,
    tryonSupported: opts?.tryonSupported ?? true,
  };
}

export function fittingRoomItemFromCartLine(
  line: ActiveCartLine,
): FittingRoomItem | null {
  if (!line.productId) return null;
  const provenance = {
    kind: "product" as const,
    productId: line.productId,
    variantId: line.variantId,
  };
  return {
    id: buildFittingRoomItemId(provenance),
    title: line.title,
    imageUrl: line.imageUrl ?? undefined,
    price:
      line.priceCents != null && line.currency
        ? { amount: line.priceCents, currency: line.currency }
        : undefined,
    productId: line.productId,
    provenance,
    tryonSupported: true,
  };
}

export function fittingRoomItemFromPdp(params: {
  productId: string;
  title: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  variantId?: string;
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: FittingRoomItem["featuredVariant"];
  tryonSupported?: boolean;
}): FittingRoomItem {
  const provenance = {
    kind: "product" as const,
    productId: params.productId,
    variantId: params.variantId,
    preferredOptions: params.preferredOptions,
  };
  return {
    id: buildFittingRoomItemId(provenance),
    title: params.title,
    imageUrl: params.imageUrl,
    price: params.price,
    productId: params.productId,
    preferredOptions: params.preferredOptions,
    featuredVariant: params.featuredVariant,
    provenance,
    tryonSupported: params.tryonSupported ?? true,
  };
}
