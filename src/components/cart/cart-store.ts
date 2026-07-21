"use client";

import { create } from "zustand";
import type {
  ActiveCartGroup,
  ActiveCartLine,
  ActiveCartState,
  CartGroupCheckoutResponse,
  CartApiResponse,
  CheckoutAddressInput,
  CartItemMetadata,
} from "@/lib/cart/types";
import { guestFetch } from "@/lib/client/guest-fetch";
import { variantIdsMatch } from "@/lib/cart/variant-id";
import { useChatStore } from "@/components/chat/chat-store";

type AddItemInput = {
  variantId: string;
  checkoutUrl: string;
  quantity?: number;
  replaceExisting?: boolean;
  product?: CartItemMetadata;
};

type CheckoutGroupInput = {
  shopDomain: string;
  mode: "agentic" | "embedded" | "merchant";
  buyerEmail?: string;
  shippingAddress?: CheckoutAddressInput;
};

type LocalizeGroupInput = {
  shopDomain: string;
  shippingAddress: CheckoutAddressInput;
};

type CartStore = {
  cart: ActiveCartState | null;
  loading: boolean;
  mutating: boolean;
  drawerOpen: boolean;
  error: string | null;
  checkoutResults: Record<string, CartGroupCheckoutResponse>;
  setDrawerOpen: (open: boolean) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  addItem: (input: AddItemInput) => Promise<boolean>;
  updateQuantity: (variantId: string, quantity: number) => Promise<boolean>;
  removeItem: (variantId: string) => Promise<boolean>;
  clearCart: () => Promise<boolean>;
  localizeGroup: (input: LocalizeGroupInput) => Promise<boolean>;
  checkoutGroup: (input: CheckoutGroupInput) => Promise<CartGroupCheckoutResponse | null>;
};

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? fallback);
  }
  return body as T;
}

const emptyCart: ActiveCartState = {
  hasCart: false,
  cartId: null,
  checkoutUrl: null,
  shopDomain: null,
  continueUrl: null,
  currency: null,
  totalCents: null,
  lineItems: [],
  messages: [],
  expiresAt: null,
  lastSyncedAt: null,
  groups: [],
  totalQuantity: 0,
  groupCount: 0,
};

function syncSidebarForCartDrawer(open: boolean) {
  if (!open) return;
  const chat = useChatStore.getState();
  chat.setSidebarOpen(false);
  chat.setSidebarCollapsed(true);
  // Lazy import to avoid circular init with tryon drawer
  void import("@/components/tryon/tryon-drawer-store").then(
    ({ useTryOnDrawerStore }) => {
      if (useTryOnDrawerStore.getState().open) {
        useTryOnDrawerStore.getState().close();
      }
    },
  );
}

function normalizeShop(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function shopDomainFromCheckoutUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shopDomainForVariant(
  cart: ActiveCartState | null,
  variantId: string,
): string | null {
  for (const group of cart?.groups ?? []) {
    if (group.lineItems.some((line) => variantIdsMatch(line.variantId, variantId))) {
      return group.shopDomain;
    }
  }
  return null;
}

function recomputeGroup(group: ActiveCartGroup): ActiveCartGroup {
  const lineItems = group.lineItems.map((line) => ({
    ...line,
    lineTotalCents:
      line.priceCents != null ? line.priceCents * line.quantity : line.lineTotalCents,
  }));
  const allPriced = lineItems.length > 0 && lineItems.every((l) => l.lineTotalCents != null);
  return {
    ...group,
    lineItems,
    totalCents: allPriced
      ? lineItems.reduce((sum, l) => sum + (l.lineTotalCents ?? 0), 0)
      : group.totalCents,
  };
}

/** Mirror of the server's composeCartState so optimistic edits stay consistent. */
function recomposeCart(groups: ActiveCartGroup[]): ActiveCartState {
  const withLines = groups.filter((group) => group.lineItems.length > 0);
  const first = withLines[0] ?? null;
  return {
    hasCart: withLines.length > 0,
    groups: withLines,
    totalQuantity: withLines.reduce(
      (sum, group) =>
        sum + group.lineItems.reduce((lineSum, line) => lineSum + line.quantity, 0),
      0,
    ),
    groupCount: withLines.length,
    cartId: first?.cartId ?? null,
    checkoutUrl: first?.checkoutUrl ?? null,
    shopDomain: first?.shopDomain ?? null,
    continueUrl: first?.continueUrl ?? null,
    currency: first?.currency ?? null,
    totalCents: first?.totalCents ?? null,
    lineItems: withLines.flatMap((group) => group.lineItems),
    messages: withLines.flatMap((group) => group.messages),
    expiresAt: first?.expiresAt ?? null,
    lastSyncedAt: first?.lastSyncedAt ?? null,
  };
}

function applyOptimisticQuantity(
  cart: ActiveCartState | null,
  variantId: string,
  quantity: number,
): ActiveCartState {
  const next = Math.max(0, Math.floor(quantity));
  const groups = (cart?.groups ?? []).map((group) => {
    if (!group.lineItems.some((l) => variantIdsMatch(l.variantId, variantId))) {
      return group;
    }
    const lineItems = group.lineItems
      .map((line) =>
        variantIdsMatch(line.variantId, variantId)
          ? { ...line, quantity: next }
          : line,
      )
      .filter((line) => line.quantity > 0);
    return recomputeGroup({ ...group, lineItems });
  });
  return recomposeCart(groups);
}

function applyOptimisticAdd(
  cart: ActiveCartState | null,
  input: AddItemInput,
): ActiveCartState {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const shopDomain =
    input.product?.sellerDomain?.trim() ||
    shopDomainFromCheckoutUrl(input.checkoutUrl);
  const groups = [...(cart?.groups ?? [])];
  const newLine: ActiveCartLine = {
    variantId: input.variantId,
    quantity,
    title: input.product?.title ?? "Cart item",
    imageUrl: input.product?.imageUrl ?? null,
    priceCents: input.product?.priceCents ?? null,
    priceAtAddCents: input.product?.priceCents ?? null,
    lineTotalCents:
      input.product?.priceCents != null
        ? input.product.priceCents * quantity
        : null,
    currency: input.product?.currency ?? null,
    sellerName: input.product?.sellerName ?? null,
    sellerDomain: shopDomain,
    productId: input.product?.productId ?? null,
    productUrl: input.product?.productUrl ?? null,
  };

  const index = groups.findIndex(
    (group) => normalizeShop(group.shopDomain) === normalizeShop(shopDomain),
  );
  if (index >= 0) {
    const group = groups[index]!;
    const existing = group.lineItems.find((line) =>
      variantIdsMatch(line.variantId, input.variantId),
    );
    const lineItems = existing
      ? group.lineItems.map((line) =>
          variantIdsMatch(line.variantId, input.variantId)
            ? {
                ...line,
                quantity: input.replaceExisting
                  ? quantity
                  : line.quantity + quantity,
              }
            : line,
        )
      : [...group.lineItems, newLine];
    groups[index] = recomputeGroup({ ...group, lineItems });
  } else {
    groups.unshift(
      recomputeGroup({
        hasCart: true,
        cartId: null,
        checkoutUrl: input.checkoutUrl,
        shopDomain,
        continueUrl: null,
        currency: input.product?.currency ?? null,
        totalCents: null,
        lineItems: [newLine],
        messages: [],
        expiresAt: null,
        lastSyncedAt: null,
        // Optimistic — corrected by the server response. Assume checkout is
        // available so the Buy now button doesn't flash disabled.
        checkout: {
          cartSupported: true,
          checkoutSupported: true,
          embeddedAvailable: true,
        },
      }),
    );
  }
  return recomposeCart(groups);
}

// Sequence guard: only the most recently issued mutation's server response is
// authoritative, so out-of-order responses can't resurrect stale cart state.
let mutationSeq = 0;
let pendingMutations = 0;
// Refresh generation — stale GET /api/cart responses must not clobber a cart
// that was updated while the refresh was in flight.
let refreshGeneration = 0;

export const useCartStore = create<CartStore>((set, get) => ({
  cart: null,
  loading: false,
  mutating: false,
  drawerOpen: false,
  error: null,
  checkoutResults: {},

  setDrawerOpen: (drawerOpen) => {
    syncSidebarForCartDrawer(drawerOpen);
    set({ drawerOpen });
  },
  clearError: () => set({ error: null }),

  refresh: async () => {
    const gen = ++refreshGeneration;
    const mutationAtStart = mutationSeq;
    const pendingAtStart = pendingMutations;
    set({ loading: true, error: null });
    try {
      const data = await readJson<CartApiResponse>(
        await guestFetch("/api/cart", { cache: "no-store" }),
        "Could not load cart.",
      );
      // Discard stale reads: if any mutation ran while this refresh was in flight
      // (including one that started just before us), the GET snapshot may predate it.
      if (
        refreshGeneration === gen &&
        pendingMutations === 0 &&
        mutationSeq === mutationAtStart &&
        pendingAtStart === 0
      ) {
        set({ cart: data.cart, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (error) {
      if (refreshGeneration === gen) {
        set({
          error:
            error instanceof Error ? error.message : "Could not load cart.",
          loading: false,
        });
      }
    }
  },

  addItem: async (input) => {
    const previous = get().cart;
    const seq = ++mutationSeq;
    pendingMutations += 1;
    set({ cart: applyOptimisticAdd(previous, input), mutating: true, error: null });
    get().setDrawerOpen(true);
    try {
      const data = await readJson<CartApiResponse>(
        await guestFetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
        "Could not add item to cart.",
      );
      if (mutationSeq === seq) set({ cart: data.cart });
      return true;
    } catch (error) {
      if (mutationSeq === seq) {
        set({
          cart: previous,
          error:
            error instanceof Error
              ? error.message
              : "Could not add item to cart.",
        });
      }
      return false;
    } finally {
      pendingMutations -= 1;
      if (pendingMutations === 0) set({ mutating: false });
    }
  },

  updateQuantity: async (variantId, quantity) => {
    const previous = get().cart;
    const shop = shopDomainForVariant(previous, variantId);
    const seq = ++mutationSeq;
    pendingMutations += 1;
    set({
      cart: applyOptimisticQuantity(previous, variantId, quantity),
      mutating: true,
      error: null,
    });
    try {
      const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";
      const data = await readJson<CartApiResponse>(
        await guestFetch(
          `/api/cart/items/${encodeURIComponent(variantId)}${query}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity }),
          },
        ),
        "Could not update cart item.",
      );
      if (mutationSeq === seq) set({ cart: data.cart });
      return true;
    } catch (error) {
      if (mutationSeq === seq) {
        set({
          cart: previous,
          error:
            error instanceof Error
              ? error.message
              : "Could not update cart item.",
        });
      }
      return false;
    } finally {
      pendingMutations -= 1;
      if (pendingMutations === 0) set({ mutating: false });
    }
  },

  removeItem: async (variantId) => {
    const previous = get().cart;
    const shop = shopDomainForVariant(previous, variantId);
    const seq = ++mutationSeq;
    pendingMutations += 1;
    set({
      cart: applyOptimisticQuantity(previous, variantId, 0),
      mutating: true,
      error: null,
    });
    try {
      const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";
      const data = await readJson<CartApiResponse>(
        await guestFetch(
          `/api/cart/items/${encodeURIComponent(variantId)}${query}`,
          { method: "DELETE" },
        ),
        "Could not remove cart item.",
      );
      if (mutationSeq === seq) set({ cart: data.cart });
      return true;
    } catch (error) {
      if (mutationSeq === seq) {
        set({
          cart: previous,
          error:
            error instanceof Error
              ? error.message
              : "Could not remove cart item.",
        });
      }
      return false;
    } finally {
      pendingMutations -= 1;
      if (pendingMutations === 0) set({ mutating: false });
    }
  },

  clearCart: async () => {
    set({ mutating: true, error: null });
    try {
      const data = await readJson<CartApiResponse>(
        await guestFetch("/api/cart", { method: "DELETE" }),
        "Could not clear cart.",
      );
      set({ cart: data.cart ?? emptyCart, mutating: false });
      return true;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Could not clear cart.",
        mutating: false,
      });
      return false;
    }
  },

  localizeGroup: async (input) => {
    try {
      const data = await readJson<CartApiResponse>(
        await guestFetch(
          `/api/cart/groups/${encodeURIComponent(input.shopDomain)}/localize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shippingAddress: input.shippingAddress }),
          },
        ),
        "Could not update cart pricing.",
      );
      set({ cart: data.cart });
      return true;
    } catch {
      return false;
    }
  },

  checkoutGroup: async (input) => {
    set({ mutating: true, error: null });
    try {
      const data = await readJson<{ checkout: CartGroupCheckoutResponse }>(
        await guestFetch(
          `/api/cart/groups/${encodeURIComponent(input.shopDomain)}/checkout`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: input.mode,
              buyerEmail: input.buyerEmail,
              shippingAddress: input.shippingAddress,
            }),
          },
        ),
        "Could not start checkout.",
      );
      set((state) => ({
        mutating: false,
        checkoutResults: {
          ...state.checkoutResults,
          [input.shopDomain]: data.checkout,
        },
      }));
      return data.checkout;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Could not start checkout.",
        mutating: false,
      });
      return null;
    }
  },
}));

export function cartItemCount(cart: ActiveCartState | null): number {
  return cart?.totalQuantity ?? 0;
}
