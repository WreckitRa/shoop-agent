---
title: Build a cart with Cart MCP
description: >-
  Learn how to build a cart with Cart MCP so your agent can estimate totals and
  iterate on line items before the buyer commits to purchase.
source_url:
  html: "https://shopify.dev/docs/agents/get-started/build-a-cart"
  md: "https://shopify.dev/docs/agents/get-started/build-a-cart.md"
---

# Build a cart with Cart MCP

This guide is the fourth part of a six-part tutorial series on building agentic commerce with the Universal Commerce Protocol (UCP) and Shopify's MCP servers. It shows how to use [Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp) to build carts that estimate totals and let buyers iterate on line items before committing to purchase.

By the end of this tutorial, you'll have a `cart_id` you can convert into a checkout in the [Finish checkout](https://shopify.dev/docs/agents/get-started/checkout) tutorial.

---

## What you'll learn

In this tutorial, you'll learn how to:

- Discover the merchant's Cart MCP endpoint from `/.well-known/ucp`.
- Build a cart with `create_cart` and retrieve an estimated total.
- Refresh a cart's state with `get_cart`.
- Replace a cart's contents with `update_cart`, using PUT semantics.
- Optionally cancel a cart with `cancel_cart`.
- Return a `cart_id` you can use later to convert the cart into a checkout.

---

## Requirements

- Complete the [Authenticate your agent](https://shopify.dev/docs/agents/get-started/authentication), [Define a profile](https://shopify.dev/docs/agents/get-started/profile), and [Search the catalog](https://shopify.dev/docs/agents/get-started/search-catalog) tutorials.

---

## Step 1: Discover merchant capabilities

Before calling Cart MCP, you need the merchant's MCP endpoint.

Merchants that support UCP expose a [business profile](https://ucp.dev/2026-04-08/specification/overview/) at `/.well-known/ucp` on their storefront origin. That document describes their UCP version, services (including the MCP endpoint), and negotiated capabilities. The following example shows the shape of a well-known document with the cart capability:

## {shop}.example.com/.well-known/ucp

```json
{
  "ucp": {
    "version": "2026-04-08",
    "supported_versions": {
      "2026-04-08": "https://{shop}.example.com/.well-known/ucp"
    },
    "services": {
      "dev.ucp.shopping": [
        {
          "version": "2026-04-08",
          "spec": "https://ucp.dev/2026-04-08/specification/overview/",
          "transport": "mcp",
          "endpoint": "https://{shop}.example.com/api/ucp/mcp",
          "schema": "https://ucp.dev/services/shopping/openrpc.json"
        }
      ]
    },
    "capabilities": {
      "dev.ucp.shopping.cart": [
        {
          "version": "2026-04-08",
          "spec": "https://ucp.dev/2026-04-08/specification/cart"
        }
      ]
    }
  }
}
```

You can use this document to confirm the merchant supports carts before calling `create_cart`.

Create an `mcp.js` file with a helper function that fetches this document and returns the MCP endpoint for a given merchant origin. You'll reuse this helper from `cart.js` in the next step, and from `checkout.js` and `orders.js` in later tutorials, so it lives in its own file.

## mcp.js

```javascript
export async function getMcpEndpoint(merchantOrigin) {
  try {
    const res = await fetch(`${merchantOrigin}/.well-known/ucp`);
    if (!res.ok) throw new Error(res.status);
    const ucp = await res.json();
    const shopping = ucp?.ucp?.services?.["dev.ucp.shopping"];
    const mcp =
      Array.isArray(shopping) && shopping.find((s) => s.transport === "mcp");
    if (mcp?.endpoint) return mcp.endpoint;
  } catch (_) {}
  return `${merchantOrigin}/api/ucp/mcp`;
}
```

---

## Step 2: Create a cart

Call [`create_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#create_cart) with the selected variant. The response includes a `cart` object with the merchant-assigned `id`, validated line items, estimated totals, and a `continue_url` that the buyer can use to pick up the cart on the merchant's storefront.

Create a `cart.js` file that imports `getMcpEndpoint` and defines `AGENT_PROFILE`, then add a `createCart` function to it:

##### cart.js

```javascript
import { getMcpEndpoint } from "./mcp.js";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json";

export async function createCart(variantId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 3,
      params: {
        name: "create_cart",
        arguments: {
          cart: {
            line_items: [{ quantity: 1, item: { id: variantId } }],
          },
          meta: { "ucp-agent": { profile: AGENT_PROFILE } },
        },
      },
    }),
  });
  const data = await res.json();
  if (data?.result?.content?.[0]?.text) {
    data.result.content[0].text = JSON.parse(data.result.content[0].text);
  }
  if (!data.result)
    throw new Error(`create_cart failed: ${JSON.stringify(data)}`);
  const cart =
    data.result.structuredContent?.cart ?? data.result.content[0].text.cart;
  const total = cart.totals?.find((t) => t.type === "total")?.amount ?? 0;
  console.log("\n── Create Cart ────────────────────────────────────\n");
  console.log(`  Cart ID:  ${cart.id}`);
  console.log(`  Total:    $${(total / 100).toFixed(2)}`);
  return cart.id;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "create_cart",
    "arguments": {
      "cart": {
        "line_items": [
          {
            "quantity": 1,
            "item": {
              "id": "<VARIANT_ID>"
            }
          }
        ]
      },
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json"
        }
      }
    }
  }
}
```

##### {} Response

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "structuredContent": {
      "cart": {
        "ucp": { "version": "2026-04-08" },
        "id": "gid://shopify/Cart/cart_abc123",
        "currency": "USD",
        "line_items": [
          {
            "id": "gid://shopify/CartLine/li_1?cart=cart_abc123",
            "item": {
              "id": "gid://shopify/ProductVariant/11111111111",
              "title": "Organic Cotton Crewneck Sweater",
              "price": 8900
            },
            "quantity": 1,
            "totals": [
              {
                "type": "subtotal",
                "amount": 8900,
                "display_text": "Subtotal"
              },
              { "type": "total", "amount": 8900, "display_text": "Total" }
            ]
          }
        ],
        "totals": [
          { "type": "subtotal", "amount": 8900, "display_text": "Subtotal" },
          { "type": "total", "amount": 8900, "display_text": "Total" }
        ],
        "continue_url": "https://ecowear-example.myshopify.com/cart/c/cart_abc123",
        "expires_at": "2026-05-08T15:17:07Z"
      }
    }
  }
}
```

Replace `AGENT_PROFILE` with your hosted profile URL from the [Define a profile](https://shopify.dev/docs/agents/get-started/profile#step-2-host-the-profile) step.

`createCart` returns the cart's `id`. Store it so you can call the other cart tools on the same cart, and pass it as `cart_id` to `create_checkout` when the buyer is ready to purchase.

---

## Step 3: Get the cart

Call [`get_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#get_cart) to refresh a cart's state. Use this when the buyer returns to the conversation and you want to show the current cart contents, or after a context change (like shipping country) where you want the latest estimated totals.

If the cart doesn't exist or has expired, the response is a successful JSON-RPC `result` whose `messages` array contains an `unrecoverable` error with code `not_found`.

Add `getCart` to `cart.js`:

##### cart.js

```javascript
export async function getCart(cartId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 4,
      params: {
        name: "get_cart",
        arguments: {
          id: cartId,
          meta: { "ucp-agent": { profile: AGENT_PROFILE } },
        },
      },
    }),
  });
  const data = await res.json();
  if (!data.result) throw new Error(`get_cart failed: ${JSON.stringify(data)}`);
  const cart = data.result.structuredContent?.cart;
  const notFound = cart?.messages?.find((m) => m.code === "not_found");
  if (notFound) throw new Error("Cart not found or expired");
  const total = cart.totals?.find((t) => t.type === "total")?.amount ?? 0;
  console.log("\n── Get Cart ───────────────────────────────────────\n");
  console.log(`  Cart ID:  ${cart.id}`);
  console.log(`  Items:    ${cart.line_items.length}`);
  console.log(`  Total:    $${(total / 100).toFixed(2)}`);
  return cart;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 4,
  "params": {
    "name": "get_cart",
    "arguments": {
      "id": "<CART_ID>",
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json"
        }
      }
    }
  }
}
```

##### {} Response

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "structuredContent": {
      "cart": {
        "id": "gid://shopify/Cart/cart_abc123",
        "line_items": [
          {
            "id": "gid://shopify/CartLine/li_1?cart=cart_abc123",
            "quantity": 1,
            "totals": [
              { "type": "total", "amount": 8900, "display_text": "Total" }
            ]
          }
        ],
        "totals": [
          { "type": "total", "amount": 8900, "display_text": "Total" }
        ],
        "continue_url": "https://ecowear-example.myshopify.com/cart/c/cart_abc123"
      }
    }
  }
}
```

The cart ID is passed at the top level of `arguments` (as `id`), not inside a `cart` object. UCP separates resource identification from payload so the server can validate requests correctly.

---

## Step 4: Update the cart

Call [`update_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#update_cart) to change the contents of a cart, for example, when the buyer adjusts a quantity, adds another product, or provides a shipping country.

Because [updates replace state](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#update_cart), build the full desired `cart` payload before sending it. A common pattern is to fetch the current cart with `getCart`, apply your change locally, then pass the result to `updateCart`.

Add `updateCart` to `cart.js`:

##### cart.js

```javascript
export async function updateCart(cartId, cart, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 5,
      params: {
        name: "update_cart",
        arguments: {
          id: cartId,
          cart,
          meta: { "ucp-agent": { profile: AGENT_PROFILE } },
        },
      },
    }),
  });
  const data = await res.json();
  if (!data.result)
    throw new Error(`update_cart failed: ${JSON.stringify(data)}`);
  const updated = data.result.structuredContent?.cart;
  const total = updated.totals?.find((t) => t.type === "total")?.amount ?? 0;
  console.log("\n── Update Cart ────────────────────────────────────\n");
  console.log(`  Items:  ${updated.line_items.length}`);
  console.log(`  Total:  $${(total / 100).toFixed(2)}`);
  return updated;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 5,
  "params": {
    "name": "update_cart",
    "arguments": {
      "id": "<CART_ID>",
      "cart": {
        "line_items": [{ "quantity": 2, "item": { "id": "<VARIANT_ID>" } }],
        "context": {
          "address_country": "US",
          "address_region": "CA",
          "postal_code": "94105"
        }
      },
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json"
        }
      }
    }
  }
}
```

##### {} Response

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "structuredContent": {
      "cart": {
        "id": "gid://shopify/Cart/cart_abc123",
        "line_items": [
          {
            "id": "gid://shopify/CartLine/li_1?cart=cart_abc123",
            "quantity": 2,
            "totals": [
              { "type": "total", "amount": 17800, "display_text": "Total" }
            ]
          }
        ],
        "totals": [
          { "type": "total", "amount": 17800, "display_text": "Total" }
        ],
        "continue_url": "https://ecowear-example.myshopify.com/cart/c/cart_abc123"
      }
    }
  }
}
```

For example, to double the quantity of the item in the cart:

```javascript
const current = await getCart(cartId, checkoutUrl);
const nextLineItems = current.line_items.map((li) => ({
  quantity: li.quantity * 2,
  item: { id: li.item.id },
}));

await updateCart(cartId, { line_items: nextLineItems }, checkoutUrl);
```

---

## Step 5: (Optional) Cancel the cart

When a buyer abandons the conversation or you want to clean up a stale cart before starting a new one, call [`cancel_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#cancel_cart). `cancel_cart` requires an `idempotency-key` in `meta` so retries are safe.

Canceling a cart removes it from storage. Subsequent calls to `get_cart` with the same ID return a `not_found` business outcome.

Add `cancelCart` to `cart.js`:

##### cart.js

```javascript
import { randomUUID } from "node:crypto";

export async function cancelCart(cartId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 6,
      params: {
        name: "cancel_cart",
        arguments: {
          id: cartId,
          meta: {
            "ucp-agent": { profile: AGENT_PROFILE },
            "idempotency-key": randomUUID(),
          },
        },
      },
    }),
  });
  const data = await res.json();
  if (!data.result)
    throw new Error(`cancel_cart failed: ${JSON.stringify(data)}`);
  console.log("\n── Cancel Cart ────────────────────────────────────\n");
  console.log(`  Cart ${cartId} canceled.`);
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 6,
  "params": {
    "name": "cancel_cart",
    "arguments": {
      "id": "<CART_ID>",
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json"
        },
        "idempotency-key": "<UUID>"
      }
    }
  }
}
```

Reuse the same `idempotency-key` when retrying a cancel after a network failure. The server returns the same outcome without canceling twice.

---

## Next steps

[Finish checkout with Checkout MCP\
\
](https://shopify.dev/docs/agents/get-started/checkout)

[Convert your cart into a checkout and refer buyers to the merchant storefront.](https://shopify.dev/docs/agents/get-started/checkout)

---
