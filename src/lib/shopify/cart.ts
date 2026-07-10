import { randomUUID } from "node:crypto";

import {
  getShoppingAgentProfileCandidates,
  getShoppingAgentProfileUrl,
  isShoppingProfileMalformedError,
} from "@/lib/env";
import { getMcpEndpoint } from "@/lib/shopify/mcp-endpoint";
import {
  JsonRpcResponse,
  parseToolStructuredContent,
  readMerchantUcpMcpResponse,
} from "@/lib/shopify/mcp-parse";
import { mcpToolsCallId } from "@/lib/shopify/mcp-request-id";
import { withMcpRetry } from "@/lib/shopify/mcp-retry";

export type CartLineItemInput = {
  quantity: number;
  item: { id: string };
};

/** Localization hints for `create_cart` / `update_cart` (not authoritative shipping — collect address via Checkout MCP). */
export type CartLocalizationContext = {
  address_country?: string;
  address_region?: string;
  postal_code?: string;
};

export type Cart = {
  id: string;
  currency?: string;
  context?: CartLocalizationContext;
  buyer?: Record<string, unknown>;
  line_items: Array<{
    id: string;
    quantity: number;
    item: { id: string; title?: string; price?: number };
    totals?: Array<{ type: string; amount: number }>;
  }>;
  totals?: Array<{ type: string; amount: number; display_text?: string }>;
  continue_url?: string;
  expires_at?: string;
  messages?: Array<{
    code?: string;
    type?: string;
    severity?: string;
    content?: string;
    available_quantity?: number;
  }>;
};

function amountToCents(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Cart MCP totals vary by merchant (`total`, `estimated_total`, line-only amounts, etc.).
 */
export function pickCartTotalCents(cart: Cart): number | null {
  const totals = cart.totals;
  if (Array.isArray(totals) && totals.length > 0) {
    const preferredTypes = ["total", "estimated_total", "combined_total", "cart_total", "subtotal"];
    for (const want of preferredTypes) {
      const row = totals.find((t) => typeof t.type === "string" && t.type.toLowerCase() === want);
      const cents = row ? amountToCents(row.amount) : undefined;
      if (cents != null && cents > 0) return Math.round(cents);
    }
    for (const t of totals) {
      const ty = (t.type ?? "").toLowerCase();
      if (/(total|subtotal|due|estimated)/.test(ty)) {
        const cents = amountToCents(t.amount);
        if (cents != null && cents > 0) return Math.round(cents);
      }
    }
    let max = 0;
    for (const t of totals) {
      const cents = amountToCents(t.amount);
      if (cents != null && cents > max) max = Math.round(cents);
    }
    if (max > 0) return max;
  }

  let sum = 0;
  let any = false;
  for (const li of cart.line_items) {
    let lineContribution = 0;
    let lineOk = false;
    const lt = li.totals;
    if (Array.isArray(lt) && lt.length > 0) {
      for (const want of ["total", "line_total", "subtotal"]) {
        const row = lt.find((x) => (x.type ?? "").toLowerCase() === want);
        const cents = row ? amountToCents(row.amount) : undefined;
        if (cents != null && cents > 0) {
          lineContribution = Math.round(cents);
          lineOk = true;
          break;
        }
      }
      if (!lineOk) {
        for (const x of lt) {
          const cents = amountToCents(x.amount);
          if (cents != null && cents > 0) {
            lineContribution = Math.round(cents);
            lineOk = true;
            break;
          }
        }
      }
    }
    if (!lineOk) {
      const unit = amountToCents(li.item?.price);
      if (unit != null && unit > 0) {
        lineContribution = Math.round(unit * li.quantity);
        lineOk = true;
      }
    }
    if (lineOk) {
      sum += lineContribution;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Business outcomes that mean there is no cart payload to parse (see get_cart / update_cart UCP envelopes). */
const CART_TERMINAL_CODES = new Set(["not_found", "cart_not_found", "invalid_cart_id"]);

type CartBizMessage = { code?: string; type?: string; severity?: string; content?: string };

function cartBusinessMessages(parsed: unknown): CartBizMessage[] | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const p = parsed as Record<string, unknown>;
  const inner = p.cart;
  if (inner && typeof inner === "object" && "messages" in inner) {
    return (inner as { messages?: CartBizMessage[] }).messages;
  }
  if ("messages" in p) {
    return p.messages as CartBizMessage[];
  }
  return undefined;
}

function throwIfCartStructuredContentIsError(parsed: unknown): void {
  const messages = cartBusinessMessages(parsed);
  if (!messages?.length) return;

  const bad = messages.find((m) => {
    const code = m.code;
    if (code && CART_TERMINAL_CODES.has(code)) return true;
    return m.type === "error" && m.severity === "unrecoverable";
  });
  if (!bad) return;

  const code = bad.code;
  const content = bad.content;
  throw new Error(
    content ??
      (code && CART_TERMINAL_CODES.has(code)
        ? "Cart not found or expired. Create a new cart from your selected variant."
        : `Cart MCP error${code ? ` (${code})` : ""}`),
  );
}

/** MCP may return `{ cart }`, or (less commonly) the cart as the structuredContent root. */
export function extractCartFromMcpResult(parsed: unknown): Cart {
  throwIfCartStructuredContentIsError(parsed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid cart MCP payload: ${JSON.stringify(parsed)}`);
  }
  const p = parsed as Record<string, unknown>;
  const maybeCart = p.cart;
  if (maybeCart && typeof maybeCart === "object") {
    const c = maybeCart as Cart;
    if (typeof c.id === "string" && Array.isArray(c.line_items)) return c;
  }
  if (typeof p.id === "string" && Array.isArray(p.line_items)) {
    return p as Cart;
  }
  throw new Error(`Unexpected cart MCP shape (expected cart with id and line_items): ${JSON.stringify(parsed)}`);
}

function shoppingMeta(profileUrl?: string) {
  return {
    "ucp-agent": { profile: profileUrl ?? getShoppingAgentProfileUrl() },
  };
}

async function callCartMcp(
  checkoutUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  profileUrl: string,
  options?: { buyerIp?: string },
): Promise<Cart> {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const ip = options?.buyerIp?.trim();
  if (ip) {
    headers["Shopify-Buyer-IP"] = ip;
    headers["Shopify-Storefront-Buyer-IP"] = ip;
  }

  const res = await withMcpRetry(() =>
    fetch(mcpEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        id: mcpToolsCallId(),
        params: {
          name: toolName,
          arguments: { ...args, meta: shoppingMeta(profileUrl) },
        },
      }),
    }),
  );
  const data = (await readMerchantUcpMcpResponse(res, mcpEndpoint)) as JsonRpcResponse<unknown>;
  return extractCartFromMcpResult(parseToolStructuredContent(data));
}

type CartMcpOptions = {
  buyerIp?: string;
};

async function callCartMcpWithProfileFallback(
  checkoutUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: CartMcpOptions,
): Promise<Cart> {
  const candidates = getShoppingAgentProfileCandidates();
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const profileUrl = candidates[i]!;
    try {
      return await callCartMcp(checkoutUrl, toolName, args, profileUrl, options);
    } catch (error) {
      lastError = error;
      const recoverable = isShoppingProfileMalformedError(error);
      const hasNext = i < candidates.length - 1;
      if (!recoverable || !hasNext) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Cart MCP failed: no agent profile URL configured.");
}

export async function createCartFromLineItems(
  lineItems: CartLineItemInput[],
  checkoutUrl: string,
  options?: { context?: CartLocalizationContext; buyerIp?: string },
): Promise<Cart> {
  const cartBody: Record<string, unknown> = {
    line_items: lineItems,
  };
  const ctx = options?.context;
  if (ctx && (ctx.address_country || ctx.address_region || ctx.postal_code)) {
    cartBody.context = {
      ...(ctx.address_country ? { address_country: ctx.address_country } : {}),
      ...(ctx.address_region ? { address_region: ctx.address_region } : {}),
      ...(ctx.postal_code ? { postal_code: ctx.postal_code } : {}),
    };
  }
  return callCartMcpWithProfileFallback(
    checkoutUrl,
    "create_cart",
    { cart: cartBody },
    { buyerIp: options?.buyerIp },
  );
}

export async function getCart(
  cartId: string,
  checkoutUrl: string,
  options?: CartMcpOptions,
): Promise<Cart> {
  return callCartMcpWithProfileFallback(checkoutUrl, "get_cart", { id: cartId }, options);
}

export async function updateCart(
  cartId: string,
  cartPayload: { line_items: CartLineItemInput[]; context?: CartLocalizationContext; buyer?: Record<string, unknown> },
  checkoutUrl: string,
  options?: CartMcpOptions,
): Promise<Cart> {
  return callCartMcpWithProfileFallback(
    checkoutUrl,
    "update_cart",
    { id: cartId, cart: cartPayload },
    options,
  );
}

export async function cancelCart(cartId: string, checkoutUrl: string): Promise<void> {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: mcpToolsCallId(),
      params: {
        name: "cancel_cart",
        arguments: {
          id: cartId,
          meta: {
            ...shoppingMeta(),
            "idempotency-key": randomUUID(),
          },
        },
      },
    }),
  });
  const data = (await readMerchantUcpMcpResponse(res, mcpEndpoint)) as JsonRpcResponse<unknown>;
  parseToolStructuredContent(data);
}
