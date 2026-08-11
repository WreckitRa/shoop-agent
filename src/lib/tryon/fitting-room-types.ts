import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";

export const MAX_FITTING_ROOM_ITEMS = 6;

export type FittingRoomProvenance =
  | { kind: "search"; searchId: string; ref: string }
  | {
      kind: "product";
      productId: string;
      variantId?: string;
      preferredOptions?: Array<{ name: string; label: string }>;
    }
  /** Direct garment/look image (e.g. onboarding style photo) — not Shopify. */
  | {
      kind: "image";
      imageUrl: string;
      title?: string;
      garment?: string;
      styleId?: string;
    };

export type FittingRoomItem = {
  id: string;
  title: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  productId?: string;
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: {
    id: string;
    price?: { amount: number; currency: string };
    checkoutUrl?: string;
    options?: Array<{ name: string; label: string }>;
  };
  provenance: FittingRoomProvenance;
  garment?: string;
  tryonSupported: boolean;
  badges?: RenderPickBadge[];
  /** Message search id when opening inline product from search-backed items. */
  messageSearchId?: string;
};

export type FittingRoomItemDescriptor = {
  provenance: FittingRoomProvenance;
};

export function buildFittingRoomItemId(provenance: FittingRoomProvenance): string {
  if (provenance.kind === "search") {
    return `search:${provenance.searchId}:${provenance.ref}`;
  }
  if (provenance.kind === "image") {
    const sid = provenance.styleId?.trim() || provenance.imageUrl.slice(0, 80);
    return `image:${sid}`;
  }
  const variant = provenance.variantId ? `:${provenance.variantId}` : "";
  const options =
    provenance.preferredOptions?.length ?
      `:${provenance.preferredOptions.map((o) => `${o.name}=${o.label}`).join(",")}`
    : "";
  return `product:${provenance.productId}${variant}${options}`;
}

/**
 * Provenance used when dressing the twin.
 *
 * Search refs are tied to assistant-message metadata that may not be in the DB
 * yet (SSE rack) or may have been GC'd — re-resolving them when layering a new
 * find onto an already-worn piece fails with "find isn't available anymore".
 * Prefer the garment image (or product id) already on the item.
 */
export function durableFittingRoomProvenance(
  item: Pick<
    FittingRoomItem,
    | "provenance"
    | "productId"
    | "preferredOptions"
    | "featuredVariant"
    | "imageUrl"
    | "title"
    | "garment"
  >,
): FittingRoomProvenance {
  if (item.provenance.kind !== "search") return item.provenance;

  const imageUrl = item.imageUrl?.trim();
  if (imageUrl) {
    return {
      kind: "image",
      imageUrl,
      title: item.title,
      garment: item.garment ?? item.title,
    };
  }

  const productId = item.productId?.trim();
  if (productId) {
    return {
      kind: "product",
      productId,
      variantId: item.featuredVariant?.id,
      preferredOptions: item.preferredOptions,
    };
  }

  return item.provenance;
}

export function fittingRoomLookId(activeIds: string[]): string {
  return `fitting-room:${[...activeIds].sort().join("|")}`;
}

/** @deprecated Use FittingRoomItem — kept for drawer product links during migration. */
export type TryOnDrawerItem = {
  ref: string;
  title: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  productId?: string;
  preferredOptions?: Array<{ name: string; label: string }>;
  featuredVariant?: FittingRoomItem["featuredVariant"];
};
