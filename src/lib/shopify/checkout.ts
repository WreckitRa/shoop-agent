import { getShoppingAgentProfileUrl } from "@/lib/env";
import { logCheckoutBuyerIp } from "@/lib/shopify/checkout-buyer-ip-debug";
import { getMcpEndpoint } from "@/lib/shopify/mcp-endpoint";
import {
  extractCheckoutFromMcpStructuredContent,
  type JsonRpcResponse,
  parseToolStructuredContent,
  readMerchantUcpMcpResponse,
} from "@/lib/shopify/mcp-parse";
import { mcpToolsCallId } from "@/lib/shopify/mcp-request-id";
import { getCart, type Cart } from "@/lib/shopify/cart";
import { ucpBearerAndBuyerIpHeaders } from "@/lib/shopify/ucp-mcp-headers";

export type CheckoutEntity = {
  id: string;
  status?: string;
  currency?: string;
  context?: Record<string, unknown>;
  line_items: Array<{
    quantity: number;
    item: { id: string; title?: string; price?: number };
    totals?: Array<{ type: string; amount: number }>;
  }>;
  totals?: Array<{ type: string; amount: number; display_text?: string }>;
  continue_url?: string;
  buyer?: { email?: string };
  /**
   * `update_checkout` is PUT semantics — re-send fulfillment (and payment when present) or the server may drop them.
   * @see docs/shopify-ucp-tutorial/carts-checkout/checkout-mcp.md
   */
  fulfillment?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  order?: { id: string; permalink_url?: string };
  messages?: unknown[];
};

function shoppingMeta() {
  return { "ucp-agent": { profile: getShoppingAgentProfileUrl() } };
}

function normalizeCheckoutPayload(raw: unknown): CheckoutEntity {
  if (raw && typeof raw === "object" && "id" in raw) {
    return raw as CheckoutEntity;
  }
  throw new Error(`Unexpected checkout payload: ${JSON.stringify(raw)}`);
}

/** Some merchant MCP stacks require `checkout` in OpenRPC even when `cart_id` is sent; mirror cart contents. */
function checkoutPayloadFromCart(cart: Cart): { currency: string; line_items: Array<{ quantity: number; item: { id: string } }> } {
  const currency = cart.currency?.trim() || "USD";
  const line_items = cart.line_items.map((li) => {
    const id = li.item?.id;
    if (!id) {
      throw new Error("Cart line item is missing item.id; cannot create checkout.");
    }
    return { quantity: li.quantity, item: { id } };
  });
  if (line_items.length === 0) {
    throw new Error("Cart has no line items; cannot create checkout.");
  }
  return { currency, line_items };
}

export type CreateCheckoutOptions = {
  /** Pre-fill buyer on conversion; cart contents still win for line_items per UCP rules. */
  buyerEmail?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  /** When set, skips the extra get_cart MCP round-trip before create_checkout. */
  cart?: Cart;
};

function shouldRetryCreateCheckoutAfterError(message: string): boolean {
  const m = message.toLowerCase();
  if (/invalid_cart_id|cart_not_found/.test(m)) return false;
  return /checkout|required|missing|argument|param|schema|openrpc|invalid/i.test(m);
}

async function postCreateCheckout(
  accessToken: string,
  mcpEndpoint: string,
  buyerIp: string,
  arguments_: Record<string, unknown>,
): Promise<CheckoutEntity> {
  const hdrs = ucpBearerAndBuyerIpHeaders(accessToken, buyerIp);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: mcpToolsCallId(),
      params: {
        name: "create_checkout",
        arguments: arguments_,
      },
    }),
  });
  const data = (await readMerchantUcpMcpResponse(res, mcpEndpoint)) as JsonRpcResponse<CheckoutEntity>;
  const structured = data.result?.structuredContent;
  if (structured !== undefined) {
    const extracted = extractCheckoutFromMcpStructuredContent(structured);
    if (extracted) {
      return normalizeCheckoutPayload(extracted);
    }
  }
  return normalizeCheckoutPayload(parseToolStructuredContent(data));
}

export async function createCheckout(
  accessToken: string,
  cartId: string,
  checkoutUrl: string,
  buyerIp: string,
  options: CreateCheckoutOptions = {},
): Promise<CheckoutEntity> {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const cart = options.cart ?? (await getCart(cartId, checkoutUrl));
  const mirrored = checkoutPayloadFromCart(cart);
  const checkoutArgs: Record<string, unknown> = {
    ...mirrored,
    ...(options.buyerEmail?.trim() ? { buyer: { email: options.buyerEmail.trim() } } : {}),
    ...(options.shippingAddress
      ? {
          fulfillment: {
            methods: [
              {
                type: "shipping",
                destinations: [
                  {
                    ...(options.shippingAddress.firstName?.trim()
                      ? { first_name: options.shippingAddress.firstName.trim() }
                      : {}),
                    ...(options.shippingAddress.lastName?.trim()
                      ? { last_name: options.shippingAddress.lastName.trim() }
                      : {}),
                    ...(options.shippingAddress.phoneNumber?.trim()
                      ? { phone_number: options.shippingAddress.phoneNumber.trim() }
                      : {}),
                    ...(options.shippingAddress.streetAddress?.trim()
                      ? { street_address: options.shippingAddress.streetAddress.trim() }
                      : {}),
                    ...(options.shippingAddress.addressLocality?.trim()
                      ? { address_locality: options.shippingAddress.addressLocality.trim() }
                      : {}),
                    ...(options.shippingAddress.addressRegion?.trim()
                      ? { address_region: options.shippingAddress.addressRegion.trim() }
                      : {}),
                    ...(options.shippingAddress.postalCode?.trim()
                      ? { postal_code: options.shippingAddress.postalCode.trim() }
                      : {}),
                    ...(options.shippingAddress.addressCountry?.trim()
                      ? { address_country: options.shippingAddress.addressCountry.trim() }
                      : {}),
                  },
                ],
              },
            ],
          },
        }
      : {}),
  };
  const meta = shoppingMeta();

  const hdrsPreview = ucpBearerAndBuyerIpHeaders(accessToken, buyerIp);
  logCheckoutBuyerIp("create_checkout → outbound JSON-RPC", {
    mcpEndpoint,
    buyerIp,
    headerKeys: Object.keys(hdrsPreview),
    storefrontBuyerIpHeaderLen: hdrsPreview["Shopify-Storefront-Buyer-IP"]?.length ?? 0,
    shopifyBuyerIpHeaderLen: hdrsPreview["Shopify-Buyer-IP"]?.length ?? 0,
    note: "Trying minimal create_checkout payloads first, then mirrored checkout if merchant requires it.",
  });

  const attempts: Record<string, unknown>[] = [];
  if (options.buyerEmail?.trim()) {
    attempts.push({
      cart_id: cartId,
      checkout: checkoutArgs,
      meta,
    });
  }
  attempts.push({ cart_id: cartId, meta });
  attempts.push({
    cart_id: cartId,
    checkout: checkoutArgs,
    meta,
  });

  let lastError: Error | undefined;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await postCreateCheckout(accessToken, mcpEndpoint, buyerIp, attempts[i]!);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastError = err;
      const isLast = i === attempts.length - 1;
      if (isLast || !shouldRetryCreateCheckoutAfterError(err.message)) {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("create_checkout failed");
}
