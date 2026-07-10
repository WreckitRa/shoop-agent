import type { Cart } from "@/lib/shopify/cart";

export type CartItemMetadata = {
  title?: string;
  imageUrl?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  sellerName?: string | null;
  sellerDomain?: string | null;
  productId?: string | null;
  /** Rye-ready storefront URL (product page + `?variant=…`), built at add time. */
  productUrl?: string | null;
};

export type ActiveCartLine = {
  variantId: string;
  quantity: number;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
  lineTotalCents: number | null;
  currency: string | null;
  sellerName: string | null;
  sellerDomain: string | null;
  productId: string | null;
  productUrl: string | null;
};

export type CartCheckoutCapability = {
  cartSupported: boolean;
  checkoutSupported: boolean;
  embeddedAvailable: boolean;
};

export type ActiveCartGroup = {
  hasCart: boolean;
  cartId: string | null;
  checkoutUrl: string | null;
  shopDomain: string | null;
  continueUrl: string | null;
  currency: string | null;
  totalCents: number | null;
  lineItems: ActiveCartLine[];
  messages: NonNullable<Cart["messages"]>;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  checkout: CartCheckoutCapability;
};

export type ActiveCartState = {
  hasCart: boolean;
  groups: ActiveCartGroup[];
  totalQuantity: number;
  groupCount: number;
  /** First group convenience fields for older call sites. */
  cartId: string | null;
  checkoutUrl: string | null;
  shopDomain: string | null;
  continueUrl: string | null;
  currency: string | null;
  totalCents: number | null;
  lineItems: ActiveCartLine[];
  messages: NonNullable<Cart["messages"]>;
  expiresAt: string | null;
  lastSyncedAt: string | null;
};

export type CartApiResponse = { cart: ActiveCartState };

export type CheckoutAddressInput = {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
};

export type SavedAddress = {
  id: string;
  label: string | null;
  buyerEmail: string | null;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
  isDefault: boolean;
};

export type CartGroupCheckoutResponse = {
  shopDomain: string;
  mode: "agentic" | "embedded" | "merchant";
  checkoutId: string | null;
  status: string | null;
  continueUrl: string | null;
  messages: Array<{
    type?: string;
    code?: string;
    content?: string;
    severity?: string;
    path?: string;
  }>;
  title: string;
  detail: string;
};
