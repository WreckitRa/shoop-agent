import type { RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";

export const MAX_FITTING_ROOM_ITEMS = 6;

export type FittingRoomProvenance =
  | { kind: "search"; searchId: string; ref: string }
  | {
      kind: "product";
      productId: string;
      variantId?: string;
      preferredOptions?: Array<{ name: string; label: string }>;
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
  const variant = provenance.variantId ? `:${provenance.variantId}` : "";
  const options =
    provenance.preferredOptions?.length ?
      `:${provenance.preferredOptions.map((o) => `${o.name}=${o.label}`).join(",")}`
    : "";
  return `product:${provenance.productId}${variant}${options}`;
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
