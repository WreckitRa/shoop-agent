import { logAiChat } from "@/lib/ai-chat/observability";
import { prisma } from "@/lib/ai-chat/db";
import type { InputJsonValue } from "@/lib/ai-chat/prisma-types";
import type { CartSession } from "@prisma/client";
import {
  cancelCart,
  createCartFromLineItems,
  getCart,
  pickCartTotalCents,
  updateCart,
  type Cart,
  type CartLineItemInput,
  type CartLocalizationContext,
} from "@/lib/shopify/cart";
import { normalizeShopifyCountryInput } from "@/lib/cart/countries";
import { normalizeRegionInput } from "@/lib/cart/regions";
import { getMerchantCommerceSupportFromCheckoutUrl } from "@/lib/shopify/merchant-support";
import {
  resolveCartLineVariantId,
  variantIdsMatch,
} from "@/lib/cart/variant-id";
import type {
  ActiveCartGroup,
  ActiveCartLine,
  ActiveCartState,
  CartItemMetadata,
  CheckoutAddressInput,
} from "@/lib/cart/types";

export class CartNotFoundError extends Error {
  constructor(message = "Cart not found or expired.") {
    super(message);
    this.name = "CartNotFoundError";
  }
}

function emptyGroup(): ActiveCartGroup {
  return {
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
    checkout: {
      cartSupported: false,
      checkoutSupported: false,
      embeddedAvailable: false,
    },
  };
}

function composeCartState(groups: ActiveCartGroup[]): ActiveCartState {
  const withLines = groups.filter((group) => group.lineItems.length > 0);
  const first = withLines[0] ?? emptyGroup();
  return {
    hasCart: withLines.length > 0,
    groups: withLines,
    totalQuantity: withLines.reduce(
      (sum, group) =>
        sum + group.lineItems.reduce((lineSum, line) => lineSum + line.quantity, 0),
      0,
    ),
    groupCount: withLines.length,
    cartId: first.cartId,
    checkoutUrl: first.checkoutUrl,
    shopDomain: first.shopDomain,
    continueUrl: first.continueUrl,
    currency: first.currency,
    totalCents: first.totalCents,
    lineItems: withLines.flatMap((group) => group.lineItems),
    messages: withLines.flatMap((group) => group.messages),
    expiresAt: first.expiresAt,
    lastSyncedAt: first.lastSyncedAt,
  };
}

function emptyCart(): ActiveCartState {
  return composeCartState([]);
}

/**
 * Serialize cart mutations per user. Concurrent add/update/remove calls used to
 * each read the merchant cart, modify it, and write it back independently — so
 * two quick adds would both start from the same base cart and the second write
 * would clobber the first, making items "randomly disappear". This chains a
 * user's mutations so each one sees the previous one's result.
 */
const userCartLocks = new Map<string, Promise<unknown>>();

function withUserCartLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userCartLocks.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  userCartLocks.set(
    userId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function shopDomainFromCheckoutUrl(checkoutUrl: string): string {
  return new URL(checkoutUrl).hostname.replace(/^www\./, "");
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isMissingCartError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cart not found|not found or expired|cart_not_found|invalid_cart_id|not_found/i.test(message);
}

function isBrokenCheckoutUrlError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return /invalid url/i.test(error.message);
}

function cartFromSessionSnapshot(session: CartSession): Cart {
  const lineItems = Array.isArray(session.lineItems)
    ? (session.lineItems as Cart["line_items"])
    : [];
  const totals = Array.isArray(session.totals)
    ? (session.totals as Cart["totals"])
    : [];
  const messages = Array.isArray(session.messages)
    ? (session.messages as NonNullable<Cart["messages"]>)
    : [];
  return {
    id: session.cartId,
    currency: session.currency ?? undefined,
    line_items: lineItems,
    totals,
    messages,
    expires_at: session.expiresAt?.toISOString(),
    continue_url: session.continueUrl ?? undefined,
  };
}

function groupFromSessionSnapshot(session: CartSession): ActiveCartGroup {
  return normalizeCart(cartFromSessionSnapshot(session), session);
}

function metadataRecord(value: unknown): Record<string, CartItemMetadata> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, CartItemMetadata>;
}

function lineTotalCents(line: Cart["line_items"][number]): number | null {
  const totals = line.totals;
  if (Array.isArray(totals)) {
    for (const want of ["total", "line_total", "subtotal"]) {
      const row = totals.find((t) => (t.type ?? "").toLowerCase() === want);
      if (typeof row?.amount === "number") return Math.round(row.amount);
    }
    for (const row of totals) {
      if (typeof row.amount === "number") return Math.round(row.amount);
    }
  }
  if (typeof line.item?.price === "number") {
    return Math.round(line.item.price * line.quantity);
  }
  return null;
}

function metadataForVariant(
  metadata: Record<string, CartItemMetadata>,
  variantId: string,
): CartItemMetadata | undefined {
  if (metadata[variantId]) return metadata[variantId];
  const key = Object.keys(metadata).find((k) => variantIdsMatch(k, variantId));
  return key ? metadata[key] : undefined;
}

function buildLineItemsFromCart(
  cart: Cart,
  metadata: Record<string, CartItemMetadata>,
  currency: string | null,
  shopDomain: string,
): ActiveCartLine[] {
  const metaKeys = Object.keys(metadata);
  const lines: ActiveCartLine[] = [];

  for (const [index, line] of cart.line_items.entries()) {
    let variantId = resolveCartLineVariantId(line);
    if (!variantId) {
      if (metaKeys.length === 1) {
        variantId = metaKeys[0]!;
      } else if (metaKeys.length === cart.line_items.length) {
        variantId = metaKeys[index];
      } else if (cart.line_items.length === 1) {
        variantId = metaKeys[metaKeys.length - 1];
      }
    }
    if (!variantId) continue;

    const meta = metadataForVariant(metadata, variantId);
    const priceCents =
      typeof line.item?.price === "number"
        ? Math.round(line.item.price)
        : (meta?.priceCents ?? null);
    lines.push({
      variantId,
      quantity: line.quantity,
      title: line.item?.title ?? meta?.title ?? "Cart item",
      imageUrl: meta?.imageUrl ?? null,
      priceCents,
      priceAtAddCents: meta?.priceCents ?? null,
      lineTotalCents: lineTotalCents(line),
      currency: currency ?? meta?.currency ?? null,
      sellerName: meta?.sellerName ?? null,
      sellerDomain: meta?.sellerDomain ?? shopDomain,
      productId: meta?.productId ?? null,
      productUrl: meta?.productUrl ?? null,
    });
  }

  // Fall back to metadata when line_items exist but variant ids couldn't be mapped.
  if (lines.length === 0 && cart.line_items.length > 0 && metaKeys.length > 0) {
    for (const variantId of metaKeys) {
      lines.push(metadataFallbackLine(variantId, metadata, currency, shopDomain));
    }
  }

  // Snapshot has metadata but an empty line_items array (some merchants / MCP
  // responses omit lines even after a successful create). Rebuild display lines
  // so add-to-cart doesn't flash then vanish on the next refresh.
  if (lines.length === 0 && cart.line_items.length === 0 && metaKeys.length > 0 && cart.id) {
    for (const variantId of metaKeys) {
      lines.push(metadataFallbackLine(variantId, metadata, currency, shopDomain));
    }
  }

  return lines;
}

function metadataFallbackLine(
  variantId: string,
  metadata: Record<string, CartItemMetadata>,
  currency: string | null,
  shopDomain: string,
): ActiveCartLine {
  const meta = metadataForVariant(metadata, variantId) ?? metadata[variantId];
  const priceCents = meta?.priceCents ?? null;
  return {
    variantId,
    quantity: 1,
    title: meta?.title ?? "Cart item",
    imageUrl: meta?.imageUrl ?? null,
    priceCents,
    priceAtAddCents: priceCents,
    lineTotalCents: priceCents,
    currency: currency ?? meta?.currency ?? null,
    sellerName: meta?.sellerName ?? null,
    sellerDomain: meta?.sellerDomain ?? shopDomain,
    productId: meta?.productId ?? null,
    productUrl: meta?.productUrl ?? null,
  };
}

function normalizeCart(
  cart: Cart,
  session: {
    checkoutUrl: string;
    shopDomain: string;
    itemMetadata?: unknown;
    lastSyncedAt?: Date | null;
  },
): ActiveCartGroup {
  const metadata = metadataRecord(session.itemMetadata);
  const currency = cart.currency ?? null;
  const lineItems = buildLineItemsFromCart(
    cart,
    metadata,
    currency,
    session.shopDomain,
  );
  return {
    hasCart: lineItems.length > 0,
    cartId: cart.id,
    checkoutUrl: session.checkoutUrl,
    shopDomain: session.shopDomain,
    continueUrl: cart.continue_url ?? null,
    currency,
    totalCents: pickCartTotalCents(cart),
    lineItems,
    messages: cart.messages ?? [],
    expiresAt: cart.expires_at ?? null,
    lastSyncedAt: (session.lastSyncedAt ?? new Date()).toISOString(),
    checkout: {
      cartSupported: true,
      checkoutSupported: false,
      embeddedAvailable: false,
    },
  };
}

function cartLineInputs(
  cart: Cart,
  metadata: Record<string, CartItemMetadata> = {},
): CartLineItemInput[] {
  const metaKeys = Object.keys(metadata);
  return cart.line_items.map((line, index) => {
    let id = resolveCartLineVariantId(line);
    if (!id) {
      if (metaKeys.length === 1) id = metaKeys[0]!;
      else if (metaKeys.length === cart.line_items.length) id = metaKeys[index];
    }
    if (!id) {
      throw new Error("Cart line item is missing item.id; cannot update cart.");
    }
    return { quantity: line.quantity, item: { id } };
  });
}

async function deleteSession(userId: string, shopDomain?: string): Promise<void> {
  await prisma.cartSession.deleteMany({
    where: { userId, ...(shopDomain ? { shopDomain } : {}) },
  });
}

async function composeCartStateAfterMutation(
  userId: string,
  mutatedGroup: ActiveCartGroup,
): Promise<ActiveCartState> {
  const sessions = await prisma.cartSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  const groups: ActiveCartGroup[] = [];
  for (const session of sessions) {
    if (session.shopDomain === mutatedGroup.shopDomain) {
      if (mutatedGroup.lineItems.length > 0) groups.push(mutatedGroup);
      continue;
    }
    const group = groupFromSessionSnapshot(session);
    // Restore checkout capability from cached UCP discovery so other merchants'
    // Buy now buttons don't flash disabled after an unrelated mutation.
    try {
      const support = await getMerchantCommerceSupportFromCheckoutUrl(
        session.checkoutUrl,
      );
      group.checkout = {
        cartSupported: support.cartSupported,
        checkoutSupported: support.checkoutSupported,
        embeddedAvailable: support.checkoutSupported,
      };
    } catch {
      // Keep conservative snapshot defaults if discovery is unavailable.
    }
    groups.push(group);
  }
  return composeCartState(groups);
}

async function persistSnapshot(
  userId: string,
  cart: Cart,
  checkoutUrl: string,
  itemMetadata: Record<string, CartItemMetadata>,
): Promise<ActiveCartGroup> {
  const shopDomain = shopDomainFromCheckoutUrl(checkoutUrl);
  const now = new Date();
  const data = {
    cartId: cart.id,
    checkoutUrl,
    shopDomain,
    currency: cart.currency ?? null,
    continueUrl: cart.continue_url ?? null,
    lineItems: cart.line_items as unknown as InputJsonValue,
    itemMetadata: itemMetadata as InputJsonValue,
    totals: (cart.totals ?? []) as unknown as InputJsonValue,
    messages: (cart.messages ?? []) as unknown as InputJsonValue,
    expiresAt: parseDate(cart.expires_at),
    lastSyncedAt: now,
  };
  const session = await prisma.cartSession.upsert({
    where: { userId_shopDomain: { userId, shopDomain } },
    create: { userId, ...data },
    update: data,
  });
  const group = normalizeCart(cart, session);
  try {
    const support = await getMerchantCommerceSupportFromCheckoutUrl(checkoutUrl);
    group.checkout = {
      cartSupported: support.cartSupported,
      checkoutSupported: support.checkoutSupported,
      embeddedAvailable: support.checkoutSupported,
    };
  } catch {
    // Cart MCP already worked; keep checkout flags conservative if discovery fails.
  }
  return group;
}

async function refreshSession(
  userId: string,
  shopDomain: string,
  options?: { persist?: boolean },
) {
  const session = await prisma.cartSession.findUnique({
    where: { userId_shopDomain: { userId, shopDomain } },
  });
  if (!session) return { session: null, cart: null, group: null };

  try {
    const cart = await getCart(session.cartId, session.checkoutUrl);
    if (options?.persist === false) {
      return {
        session,
        cart,
        group: normalizeCart(cart, session),
      };
    }
    const group = await persistSnapshot(
      userId,
      cart,
      session.checkoutUrl,
      metadataRecord(session.itemMetadata),
    );
    return {
      session: { ...session, lastSyncedAt: new Date(group.lastSyncedAt ?? Date.now()) },
      cart,
      group,
    };
  } catch (error) {
    if (isMissingCartError(error)) {
      await deleteSession(userId, shopDomain);
      return { session: null, cart: null, group: null };
    }
    throw error;
  }
}

/**
 * Reads the cart for display. This is snapshot-first: it serves the DB snapshot
 * written by the last mutation instead of calling `get_cart` over MCP for every
 * merchant on every page load. That round-trip was the main source of cart lag
 * and the flaky "sometimes my items show, sometimes they don't" behavior on
 * refresh (a single slow/failed merchant call would blank or stall the cart).
 *
 * Pricing/availability are refreshed on every mutation and validated again at
 * checkout, so the snapshot is accurate for display. Checkout capability is
 * restored from the cached `/.well-known/ucp` discovery (no `get_cart`).
 */
export async function getActiveCart(userId: string): Promise<ActiveCartState> {
  const sessions = await prisma.cartSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  const now = Date.now();
  const groups = (
    await Promise.all(
      sessions.map(async (session) => {
        // Drop carts the merchant already expired so they can't linger as
        // un-checkout-able ghosts.
        if (session.expiresAt && session.expiresAt.getTime() < now) {
          await deleteSession(userId, session.shopDomain).catch(() => {});
          return null;
        }

        let group: ActiveCartGroup;
        try {
          group = groupFromSessionSnapshot(session);
        } catch (snapshotError) {
          logAiChat("error", "cart_session_snapshot_failed", {
            userId,
            shopDomain: session.shopDomain,
            cartId: session.cartId,
            error: snapshotError,
          });
          return null;
        }
        if (!group.hasCart) return null;

        try {
          const support = await getMerchantCommerceSupportFromCheckoutUrl(
            session.checkoutUrl,
          );
          group.checkout = {
            cartSupported: support.cartSupported,
            checkoutSupported: support.checkoutSupported,
            embeddedAvailable: support.checkoutSupported,
          };
        } catch (error) {
          if (isBrokenCheckoutUrlError(error)) {
            await deleteSession(userId, session.shopDomain).catch(() => {});
            return null;
          }
          // Keep conservative snapshot defaults if discovery is unavailable.
        }
        return group;
      }),
    )
  ).filter((group): group is ActiveCartGroup => group != null);
  return composeCartState(groups);
}

type AddLineToCartInput = {
  variantId: string;
  checkoutUrl: string;
  quantity?: number;
  product?: CartItemMetadata;
  replaceExisting?: boolean;
  buyerIp?: string;
};

export async function addLineToCart(
  userId: string,
  input: AddLineToCartInput,
): Promise<ActiveCartState> {
  return withUserCartLock(userId, () => addLineToCartImpl(userId, input));
}

async function addLineToCartImpl(
  userId: string,
  input: AddLineToCartInput,
): Promise<ActiveCartState> {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const nextShopDomain = shopDomainFromCheckoutUrl(input.checkoutUrl);
  // Work off the persisted snapshot instead of a live `get_cart` round-trip;
  // the snapshot reflects the last mutation's authoritative cart, and the
  // per-user lock guarantees we aren't racing another mutation.
  const session = await prisma.cartSession.findUnique({
    where: { userId_shopDomain: { userId, shopDomain: nextShopDomain } },
  });

  const previousMetadata = session ? metadataRecord(session.itemMetadata) : {};
  const itemMetadata = {
    ...previousMetadata,
    [input.variantId]: {
      ...previousMetadata[input.variantId],
      ...input.product,
      sellerDomain: input.product?.sellerDomain ?? nextShopDomain,
    },
  };

  const cartOptions = { buyerIp: input.buyerIp };

  const createFresh = async () => {
    const cart = await createCartFromLineItems(
      [{ quantity, item: { id: input.variantId } }],
      input.checkoutUrl,
      cartOptions,
    );
    const group = await persistSnapshot(
      userId,
      cart,
      input.checkoutUrl,
      itemMetadata,
    );
    return composeCartStateAfterMutation(userId, group);
  };

  if (!session) {
    return createFresh();
  }

  const snapshotCart = cartFromSessionSnapshot(session);
  const lines = cartLineInputs(snapshotCart, previousMetadata);
  const existing = lines.find((line) =>
    variantIdsMatch(line.item.id, input.variantId),
  );
  if (existing) {
    existing.quantity = input.replaceExisting
      ? quantity
      : existing.quantity + quantity;
  } else {
    lines.push({ quantity, item: { id: input.variantId } });
  }

  try {
    const cart = await updateCart(
      session.cartId,
      { line_items: lines },
      session.checkoutUrl,
      cartOptions,
    );
    const group = await persistSnapshot(
      userId,
      cart,
      session.checkoutUrl,
      itemMetadata,
    );
    return composeCartStateAfterMutation(userId, group);
  } catch (error) {
    // Merchant cart expired/cancelled between mutations — start a fresh one so
    // the add still succeeds instead of erroring out.
    if (isMissingCartError(error)) {
      await deleteSession(userId, nextShopDomain).catch(() => {});
      return createFresh();
    }
    throw error;
  }
}

type CartMutationOptions = { buyerIp?: string; shopDomain?: string };

export async function updateLineQuantity(
  userId: string,
  variantId: string,
  quantity: number,
  options?: CartMutationOptions,
): Promise<ActiveCartState> {
  return withUserCartLock(userId, () =>
    updateLineQuantityImpl(userId, variantId, quantity, options),
  );
}

async function updateLineQuantityImpl(
  userId: string,
  variantId: string,
  quantity: number,
  options?: CartMutationOptions,
): Promise<ActiveCartState> {
  // Find the merchant cart holding this variant straight from the snapshots —
  // no per-merchant `get_cart` scan. A `shopDomain` hint (sent by the client,
  // which already knows which group the line lives in) makes this O(1).
  let sessions = await prisma.cartSession.findMany({
    where: {
      userId,
      ...(options?.shopDomain ? { shopDomain: options.shopDomain } : {}),
    },
  });
  // Fall back to a full scan if the hint matched nothing (e.g. stale client).
  if (sessions.length === 0 && options?.shopDomain) {
    sessions = await prisma.cartSession.findMany({ where: { userId } });
  }

  let target: CartSession | null = null;
  for (const session of sessions) {
    const snapshotCart = cartFromSessionSnapshot(session);
    const hit = snapshotCart.line_items.some((line) => {
      const id = resolveCartLineVariantId(line);
      return id != null && variantIdsMatch(id, variantId);
    });
    if (hit) {
      target = session;
      break;
    }
  }
  if (!target) throw new CartNotFoundError();

  const snapshotCart = cartFromSessionSnapshot(target);
  const metadata = metadataRecord(target.itemMetadata);
  const nextQuantity = Math.max(0, Math.floor(quantity));
  const lines = cartLineInputs(snapshotCart, metadata)
    .map((line) =>
      variantIdsMatch(line.item.id, variantId)
        ? { ...line, quantity: nextQuantity }
        : line,
    )
    .filter((line) => line.quantity > 0);

  if (lines.length === 0) {
    return clearCartGroupImpl(userId, target.shopDomain);
  }

  try {
    const cart = await updateCart(
      target.cartId,
      { line_items: lines },
      target.checkoutUrl,
      { buyerIp: options?.buyerIp },
    );
    const group = await persistSnapshot(
      userId,
      cart,
      target.checkoutUrl,
      metadata,
    );
    return composeCartStateAfterMutation(userId, group);
  } catch (error) {
    // Merchant cart no longer exists — clear the stale snapshot so the UI stops
    // showing a line that can't be modified.
    if (isMissingCartError(error)) {
      await deleteSession(userId, target.shopDomain).catch(() => {});
      return getActiveCart(userId);
    }
    throw error;
  }
}

export async function removeLineFromCart(
  userId: string,
  variantId: string,
  options?: { shopDomain?: string },
): Promise<ActiveCartState> {
  return withUserCartLock(userId, () =>
    updateLineQuantityImpl(userId, variantId, 0, options),
  );
}

export async function clearActiveCart(userId: string): Promise<ActiveCartState> {
  return withUserCartLock(userId, () => clearActiveCartImpl(userId));
}

async function clearActiveCartImpl(userId: string): Promise<ActiveCartState> {
  const sessions = await prisma.cartSession.findMany({ where: { userId } });
  for (const session of sessions) {
    await clearCartGroupImpl(userId, session.shopDomain);
  }
  return emptyCart();
}

export async function clearCartGroup(
  userId: string,
  shopDomain: string,
): Promise<ActiveCartState> {
  return withUserCartLock(userId, () => clearCartGroupImpl(userId, shopDomain));
}

async function clearCartGroupImpl(
  userId: string,
  shopDomain: string,
): Promise<ActiveCartState> {
  const session = await prisma.cartSession.findUnique({
    where: { userId_shopDomain: { userId, shopDomain } },
  });
  if (!session) return getActiveCart(userId);
  try {
    await cancelCart(session.cartId, session.checkoutUrl);
  } catch {
    // Local cart state should still clear if the merchant cart already expired
    // or the cancel call is unavailable.
  } finally {
    await deleteSession(userId, shopDomain);
  }
  return getActiveCart(userId);
}

function cartLocalizationContextFromAddress(
  address: CheckoutAddressInput,
): CartLocalizationContext | null {
  const addressCountry = address.addressCountry?.trim()
    ? normalizeShopifyCountryInput(address.addressCountry)
    : undefined;
  const addressRegion = address.addressRegion?.trim()
    ? normalizeRegionInput(addressCountry, address.addressRegion)
    : undefined;
  const postalCode = address.postalCode?.trim() || undefined;
  if (!addressCountry && !addressRegion && !postalCode) return null;
  return {
    ...(addressCountry ? { address_country: addressCountry } : {}),
    ...(addressRegion ? { address_region: addressRegion } : {}),
    ...(postalCode ? { postal_code: postalCode } : {}),
  };
}

/** Re-price cart lines using checkout address instead of geo-IP. @see cart-mcp.md context */
export async function localizeCartGroup(
  userId: string,
  shopDomain: string,
  address: CheckoutAddressInput,
  options?: { buyerIp?: string },
): Promise<ActiveCartState> {
  return withUserCartLock(userId, () =>
    localizeCartGroupImpl(userId, shopDomain, address, options),
  );
}

async function localizeCartGroupImpl(
  userId: string,
  shopDomain: string,
  address: CheckoutAddressInput,
  options?: { buyerIp?: string },
): Promise<ActiveCartState> {
  const context = cartLocalizationContextFromAddress(address);
  if (!context?.address_country) {
    return getActiveCart(userId);
  }

  const refreshed = await refreshSession(userId, shopDomain, { persist: false });
  if (!refreshed.session || !refreshed.cart) {
    throw new CartNotFoundError();
  }

  const metadata = metadataRecord(refreshed.session.itemMetadata);
  const lines = cartLineInputs(refreshed.cart, metadata);

  const cart = await updateCart(
    refreshed.cart.id,
    {
      line_items: lines,
      context,
      ...(refreshed.cart.buyer ? { buyer: refreshed.cart.buyer } : {}),
    },
    refreshed.session.checkoutUrl,
    { buyerIp: options?.buyerIp },
  );
  const group = await persistSnapshot(
    userId,
    cart,
    refreshed.session.checkoutUrl,
    metadata,
  );
  return composeCartStateAfterMutation(userId, group);
}

export async function getCartGroup(
  userId: string,
  shopDomain: string,
): Promise<{ session: { cartId: string; checkoutUrl: string; shopDomain: string } | null; group: ActiveCartGroup | null }> {
  const refreshed = await refreshSession(userId, shopDomain);
  return {
    session: refreshed.session
      ? {
          cartId: refreshed.session.cartId,
          checkoutUrl: refreshed.session.checkoutUrl,
          shopDomain: refreshed.session.shopDomain,
        }
      : null,
    group: refreshed.group,
  };
}

/** DB snapshot for checkout — avoids get_cart MCP before create_checkout. */
export async function getCartGroupForCheckout(
  userId: string,
  shopDomain: string,
): Promise<{
  session: { cartId: string; checkoutUrl: string; shopDomain: string } | null;
  group: ActiveCartGroup | null;
  cart: Cart | null;
}> {
  const session = await prisma.cartSession.findUnique({
    where: { userId_shopDomain: { userId, shopDomain } },
  });
  if (!session) return { session: null, group: null, cart: null };

  const group = groupFromSessionSnapshot(session);
  const cart = cartFromSessionSnapshot(session);

  if (!group.checkout.checkoutSupported) {
    try {
      const support = await getMerchantCommerceSupportFromCheckoutUrl(session.checkoutUrl);
      group.checkout = {
        cartSupported: support.cartSupported,
        checkoutSupported: support.checkoutSupported,
        embeddedAvailable: support.checkoutSupported,
      };
    } catch {
      // Keep conservative defaults from snapshot.
    }
  }

  return {
    session: {
      cartId: session.cartId,
      checkoutUrl: session.checkoutUrl,
      shopDomain: session.shopDomain,
    },
    group,
    cart,
  };
}
