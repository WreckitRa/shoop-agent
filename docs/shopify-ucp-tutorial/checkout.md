---
title: Finish checkout with Checkout MCP
description: >-
  Learn how to create and manage checkout sessions with Checkout MCP and direct
  buyers to the merchant's storefront to finish their purchase.
source_url:
  html: "https://shopify.dev/docs/agents/get-started/checkout"
  md: "https://shopify.dev/docs/agents/get-started/checkout.md"
---

# Finish checkout with Checkout MCP

This guide is the fifth part of a six-part tutorial series that describes how to build an agentic commerce application with the Universal Commerce Protocol (UCP) using Shopify's MCP servers. It demonstrates how to convert a cart built with Cart MCP into a checkout session, add buyer information, and refer the buyer to a merchant storefront to finish their purchase.

By the end of this tutorial, you'll have extended the demo scripts from the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart) tutorial to create a checkout from the cart and manage it using [Checkout MCP tools](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp).

---

## What you'll learn

In this tutorial, you'll learn how to:

- Convert a cart built with Cart MCP into a checkout session by passing `cart_id` to `create_checkout`
- Add buyer email with `update_checkout` and collect it interactively
- Append UTM attribution to `continue_url` before referring buyers
- Optionally cancel a checkout session when the buyer abandons the flow

---

## Requirements

- Complete the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart) tutorial

---

## Step 1: Reuse the MCP endpoint helper

In the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart#step-1-discover-merchant-capabilities) tutorial, you added a `getMcpEndpoint` helper to `mcp.js` that fetches the merchant's `/.well-known/ucp` document and returns its MCP endpoint. You'll reuse it from `checkout.js`, so there's no new discovery code to add in this tutorial.

Create a `checkout.js` file that imports `getMcpEndpoint` and defines `AGENT_PROFILE`:

## checkout.js

```javascript
import { getMcpEndpoint } from "./mcp.js";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json";
```

Replace `AGENT_PROFILE` with your hosted profile URL from the [Define a profile](https://shopify.dev/docs/agents/get-started/profile#step-2-host-the-profile) step. The profile must declare both the `dev.ucp.shopping.cart` and `dev.ucp.shopping.checkout` capabilities so `create_checkout` accepts a `cart_id`. See [Convert a cart into a checkout](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#convert-a-cart-into-a-checkout).

---

## Step 2: Create a checkout from the cart

Call [`create_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#create_checkout) with the `cart_id` from the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart) tutorial. The server loads the referenced cart and inherits its `line_items`, `context`, and `buyer`. Pass `cart_id` as a top-level argument rather than inside the `checkout` payload; the `checkout` payload is optional when `cart_id` is provided.

Add `createCheckout` to `checkout.js`:

##### checkout.js

```javascript
import { getMcpEndpoint } from "./mcp.js";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json";

export async function createCheckout(token, cartId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 3,
      params: {
        name: "create_checkout",
        arguments: {
          cart_id: cartId,
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
    throw new Error(`create_checkout failed: ${JSON.stringify(data)}`);
  const checkout = data.result.structuredContent ?? data.result.content[0].text;
  const { id, totals } = checkout;
  const total = totals?.find((t) => t.type === "total")?.amount ?? 0;
  console.log("\n── Create Checkout ────────────────────────────────\n");
  console.log(`  ID:     ${id}`);
  console.log(`  Total:  $${(total / 100).toFixed(2)}`);
  return id;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "create_checkout",
    "arguments": {
      "cart_id": "gid://shopify/Cart/<CART_ID>",
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
      "id": "gid://shopify/Checkout/abc123?key=xyz789",
      "status": "requires_escalation",
      "messages": [
        { "type": "error", "severity": "requires_buyer_input" },
        { "type": "info", "severity": "requires_buyer_review" }
      ],
      "currency": "USD",
      "line_items": [
        {
          "id": "gid://shopify/CartLine/li_1?cart=abc123",
          "item": {
            "id": "gid://shopify/ProductVariant/11111111111",
            "title": "Organic Cotton Crewneck Sweater",
            "price": 8900
          },
          "quantity": 1,
          "totals": [
            { "type": "subtotal", "amount": 8900, "display_text": "Subtotal" },
            { "type": "total", "amount": 8900, "display_text": "Total" }
          ]
        }
      ],
      "totals": [
        { "type": "subtotal", "amount": 8900, "display_text": "Subtotal" },
        { "type": "total", "amount": 8900, "display_text": "Total" }
      ],
      "expires_at": "2026-02-20T15:17:07Z",
      "continue_url": "https://ecowear-example.myshopify.com/cart/c/abc123?key=xyz789"
    }
  }
}
```

A checkout's `status` tells you what to do next:

- `incomplete`: Information is still missing. Resolve it with `update_checkout`.
- `ready_for_complete`: The checkout has everything it needs and can be submitted.
- `requires_escalation`: The buyer needs to complete the checkout on the merchant's storefront. Direct them to `continue_url`. Inspect the `messages` array for the reason; each message includes a `severity` (for example, `requires_buyer_input` or `requires_buyer_review`) that describes what the buyer needs to do.

See the [Checkout MCP lifecycle](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#lifecycle) for the full status table.

See [Convert a cart into a checkout](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#convert-a-cart-into-a-checkout) for merge rules (cart contents win), idempotency behavior, and the `invalid_cart_id` and `cart_not_found` business outcomes.

### Alternative: Create a checkout without a cart

If your agent doesn't build a cart first (for example, a buy-it-now flow from a single variant), `create_checkout` also accepts `line_items` directly. Omit `cart_id` and pass a `checkout` payload with `currency` and `line_items`:

## {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "create_checkout",
    "arguments": {
      "checkout": {
        "currency": "USD",
        "line_items": [{ "quantity": 1, "item": { "id": "<VARIANT_ID>" } }]
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

---

## Step 3: Update checkout

After checkout is created, you may optionally want to attach buyer information to that checkout.

The [`update_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#update_checkout) tool can add the buyer's email to the checkout session.

**Caution:**

`update_checkout` uses PUT semantics. Each request replaces the full checkout state with the payload you send, so include every field you want to keep. See the [Checkout MCP reference](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#update_checkout) for details.

Add the `updateCheckout` function to `checkout.js`:

When you convert a cart into a checkout, the checkout inherits the cart's `line_items`, `context`, and any buyer fields. Because `update_checkout` uses PUT semantics, omitting any of those fields would clear them. The helper below fetches the current checkout with `getCheckout`, then forwards `currency`, `context`, and `line_items` unchanged while merging the new email into the existing `buyer` object.

##### checkout.js

```javascript
async function getCheckout(token, checkoutId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 4,
      params: {
        name: "get_checkout",
        arguments: {
          id: checkoutId,
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
    throw new Error(`get_checkout failed: ${JSON.stringify(data)}`);
  return data.result.structuredContent ?? data.result.content[0].text;
}

export async function updateCheckout(token, checkoutId, email, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const current = await getCheckout(token, checkoutId, checkoutUrl);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 5,
      params: {
        name: "update_checkout",
        arguments: {
          id: checkoutId,
          checkout: {
            currency: current.currency,
            context: current.context,
            line_items: current.line_items.map((li) => ({
              quantity: li.quantity,
              item: { id: li.item.id },
            })),
            buyer: { ...(current.buyer ?? {}), email },
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
    throw new Error(`update_checkout failed: ${JSON.stringify(data)}`);
  const checkout = data.result.structuredContent ?? data.result.content[0].text;
  console.log("\n── Update Checkout ────────────────────────────────\n");
  return checkout.continue_url;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 5,
  "params": {
    "name": "update_checkout",
    "arguments": {
      "id": "<CHECKOUT_ID>",
      "checkout": {
        "currency": "USD",
        "context": { "country": "US", "language": "en" },
        "line_items": [{ "quantity": 1, "item": { "id": "<VARIANT_ID>" } }],
        "buyer": { "email": "buyer@example.com" }
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

---

## Step 4: Cancel checkout

When a buyer abandons your agentic experience before completing checkout, you can call the [`cancel_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#cancel_checkout) tool to cancel the active session.

Add a `cancelCheckout` function that calls that tool to `checkout.js`:

##### checkout.js

```javascript
export async function cancelCheckout(token, checkoutId, checkoutUrl) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 6,
      params: {
        name: "cancel_checkout",
        arguments: {
          id: checkoutId,
          meta: {
            "ucp-agent": { profile: AGENT_PROFILE },
            "idempotency-key": crypto.randomUUID(),
          },
        },
      },
    }),
  });
  const data = await res.json();
  if (data?.result?.content?.[0]?.text) {
    data.result.content[0].text = JSON.parse(data.result.content[0].text);
  }
  if (!data.result)
    throw new Error(`cancel_checkout failed: ${JSON.stringify(data)}`);
  const status = data.result.structuredContent?.status;
  if (status !== "canceled") throw new Error(`Unexpected status: ${status}`);
  console.log("\n── Cancel Checkout ────────────────────────────────\n");
  console.log(`  Status: ${status}`);
  console.log("  Checkout has been successfully cancelled.");
  console.log("  Demo complete.\n");
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 6,
  "params": {
    "name": "cancel_checkout",
    "arguments": {
      "id": "<CHECKOUT_ID>",
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

##### {} Response

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "structuredContent": {
      "id": "gid://shopify/Checkout/abc123?key=xyz789",
      "status": "canceled"
    }
  }
}
```

---

## Step 5: Finish checkout

Update `ucp_demo.js` to import `checkout.js` and wire up the cart-to-checkout handoff. The final script will build a cart from the selected variant, convert that cart into a checkout by passing `cart_id` to `create_checkout`, prompt the buyer to add their email, and append attribution to the final checkout URL (`utm_source` and `ucp_demo_app`) so the merchant can recognize your agent's influence on the completed sale.

## ucp_demo.js

```javascript
import { prompt } from "./utils.js";
import { getAccessToken } from "./auth.js";
import { searchProducts, displayProducts, showCatalog } from "./search.js";
import { selectProduct } from "./product.js";
import { createCart, getCart, updateCart } from "./cart.js";
import { createCheckout, updateCheckout, cancelCheckout } from "./checkout.js";

async function main() {
  // 1. Authentication
  const token = await getAccessToken();
  // 2 & 3. Search and select a variant
  let variant = null;
  while (!variant) {
    showCatalog();
    const result = await searchProducts(token, {
      condition: ["secondhand"],
      price: { min: 5000, max: 20000 },
      ships_to: { country: "US" },
    });
    if (!result?.products?.length) return;
    displayProducts(result.products);
    variant = await selectProduct(token, result.products);
  }
  const { variantId, checkout_url: checkoutUrl } = variant;

  // 4. Build a cart
  const cartId = await createCart(variantId, checkoutUrl);

  // 5. Create checkout from the cart
  const checkoutId = await createCheckout(token, cartId, checkoutUrl);

  // 6. Update checkout: add buyer email
  const email = await prompt("\n\x1b[1m  Enter your email address:\x1b[0m  ");
  const continueUrl = await updateCheckout(
    token,
    checkoutId,
    email,
    checkoutUrl,
  );
  const attributedUrl = new URL(continueUrl);
  attributedUrl.searchParams.set("utm_source", "ucp_demo_app");
  console.log(
    `  Refer your buyer to finish checkout at:\n\n  ${attributedUrl}\n`,
  );

  // 7. Cancel checkout
  await prompt(
    "\x1b[1m  Are you finished with the demo? Press Enter to cancel the checkout and exit.\x1b[0m  ",
  );
  await cancelCheckout(token, checkoutId, checkoutUrl);
}

main().catch((err) => console.error("Request failed:", err));
```

Run the full demo with `node ucp_demo.js`. Click the final link to view the checkout URL on the merchant storefront prepared for referral. When finished, press **Enter** to cancel the checkout and exit the demo.

## Output

── 1. Authentication ─────────────────────────

Scopes: read_global_api_catalog_search

Expires: 6:02:46 PM

── 2. Search the Catalog ─────────────────────────

Catalog ID: {your_catalog_id}

Hello! What are you looking for today?

\> I need a crewneck sweater

── Results ────────────────────────────────────────

\[1] Organic Cotton Crewneck Sweater | $89.00 | Size: S, M, L | Color: Oatmeal, Forest Green

\[2] Recycled Wool Blend Crewneck | $115.00 | Size: S, M, L, XL | Color: Charcoal, Navy

\[3] Hemp Cotton Crew Pullover | $72.00 | Size: XS, S, M, L

Lookup details on a result \[1-3]: 1

── 3. Product Details ─────────────────────────────

Organic Cotton Crewneck Sweater - M / Oatmeal

$89.00 · EcoWear

· 100% organic cotton for breathable comfort

· Relaxed fit with ribbed cuffs and hem

· GOTS certified sustainable production

· Pre-washed for softness

· Classic crewneck design

\[s] Select this variant \[number] Pick an option \[b] Back to results

\> s

── Create Cart ────────────────────────────────────

Cart ID: gid://shopify/Cart/cart_abc123

Total: $89.00

── Create Checkout ────────────────────────────────

ID: gid://shopify/Checkout/abc123?key=xyz789

Total: $89.00

── Update Checkout ────────────────────────────────

Enter your email address: buyer\@example.com

Refer your buyer to finish checkout at:

https://ecowear-example.myshopify.com/cart/c/abc123?key=xyz789\&utm\_source=ucp\_demo\_app

Are you finished with the demo? Press Enter to cancel the checkout and exit.

── Cancel Checkout ────────────────────────────────

Status: canceled

Checkout has been successfully cancelled.

Demo complete.

The demo calls `cancelCheckout` at the end to keep the tutorial state clean. In production, only call `cancel_checkout` when a buyer abandons the session.

---

## Step 6: (Alternative) Complete the checkout in your application

The flow above hands the buyer off to the merchant's checkout via `continue_url`, which is the path most agents take. When your agent is eligible to call [`complete_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#complete_checkout) and the checkout reaches `status: ready_for_complete`, you can place the order in your application instead.

Eligible checkouts can still return `requires_escalation` when the merchant requires additional buyer input, such as 3DS challenges, channel opt-in, or other interactive review steps. Plan for this on every path: when a checkout escalates, hand the buyer off to the merchant's checkout via `continue_url`.

Add a `completeCheckout` function to `checkout.js`. It fetches the current checkout, submits payment with `complete_checkout` when `status` is `ready_for_complete`, and otherwise hands the buyer off to `continue_url` so they can resolve missing details on the merchant's storefront. In a production flow, you'd typically resolve recoverable messages with additional `update_checkout` calls before reaching this point:

##### checkout.js

```javascript
export async function completeCheckout(
  token,
  checkoutId,
  checkoutUrl,
  payment,
) {
  const origin = new URL(checkoutUrl).origin;
  const mcpEndpoint = await getMcpEndpoint(origin);
  const current = await getCheckout(token, checkoutId, checkoutUrl);
  if (current.status !== "ready_for_complete") {
    console.log(
      `  Checkout is ${current.status}. Hand off to the buyer at:\n  ${current.continue_url}\n`,
    );
    return null;
  }
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 7,
      params: {
        name: "complete_checkout",
        arguments: {
          id: checkoutId,
          checkout: { payment },
          meta: {
            "ucp-agent": { profile: AGENT_PROFILE },
            "idempotency-key": crypto.randomUUID(),
          },
        },
      },
    }),
  });
  const data = await res.json();
  if (!data.result)
    throw new Error(`complete_checkout failed: ${JSON.stringify(data)}`);
  const checkout = data.result.structuredContent;
  console.log("\n── Complete Checkout ──────────────────────────────\n");
  console.log(`  Status: ${checkout.status}`);
  if (checkout.order) console.log(`  Order:  ${checkout.order.id}`);
  return checkout;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 7,
  "params": {
    "name": "complete_checkout",
    "arguments": {
      "id": "<CHECKOUT_ID>",
      "checkout": {
        "payment": {
          "instruments": [...],
          "selected_instrument_id": "..."
        }
      },
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

##### {} Response

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "structuredContent": {
      "id": "gid://shopify/Checkout/abc123?key=xyz789",
      "status": "completed",
      "order": {
        "id": "gid://shopify/Order/order_abc123",
        "permalink_url": "https://ecowear-example.myshopify.com/orders/order_abc123"
      }
    }
  }
}
```

For payment integration details, see the [Shop Pay payment handler](https://shopify.dev/docs/agents/carts-and-checkout/shop-pay-handler) and the [UCP Payment Handler Guide](https://ucp.dev/2026-04-08/specification/payment-handler-guide/). To embed the checkout UI in your application instead of redirecting to `continue_url`, see [Embedded Checkout Protocol](https://shopify.dev/docs/agents/carts-and-checkout/ecp).

---

## Next steps

- [Monitor orders](https://shopify.dev/docs/agents/get-started/monitor-orders): Continue the tutorial series by fetching the order placed at checkout and receiving order webhook deliveries.
- [About carts and checkout](https://shopify.dev/docs/agents/carts-and-checkout): Learn how carts, checkout, and cart permalinks fit together across the referral path.
- [Checkout MCP reference](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp): Full reference for `create_checkout`, `update_checkout`, `get_checkout`, `complete_checkout`, and `cancel_checkout`.
- [Cart MCP reference](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp): Full reference for `create_cart`, `update_cart`, `get_cart`, and `cancel_cart`.
- [UCP Checkout specification](https://ucp.dev/2026-04-08/specification/checkout/): Explore the full UCP Checkout capability specification.
- [UCP Order specification](https://ucp.dev/2026-04-08/specification/order/): Learn about confirmed transactions and post-purchase events, including line items, fulfillment expectations and events, and adjustments like refunds and returns.

---
