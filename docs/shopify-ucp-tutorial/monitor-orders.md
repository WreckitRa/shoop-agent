---
title: Monitor orders after checkout
description: >-
  Learn how to fetch the current state of an order placed through your agent and
  verify order webhook deliveries using the UCP order capability.
source_url:
  html: "https://shopify.dev/docs/agents/get-started/monitor-orders"
  md: "https://shopify.dev/docs/agents/get-started/monitor-orders.md"
---

# Monitor orders after checkout

This guide is the sixth and final part of a six-part tutorial series that describes how to build an agentic commerce application with the Universal Commerce Protocol (UCP) using Shopify's MCP servers. It demonstrates how to fetch an order's current state on demand with the `get_order` MCP tool and how to verify order webhook deliveries pushed to your endpoint by Shopify.

By the end of this tutorial, you'll have extended the demo scripts from the [Finish checkout](https://shopify.dev/docs/agents/get-started/checkout) tutorial to read an order's current state after the buyer completes checkout, render a buyer-facing summary, and verify the HMAC signature on order webhook payloads.

---

## What you'll learn

In this tutorial, you'll learn how to:

- Mint a Global API JWT with the `read_global_api_orders` scope.
- Fetch the current state of an order with `get_order`, including line items, fulfillment events, and post-purchase adjustments.
- Render a concise buyer-facing summary from the UCP-shaped order payload.
- Verify the HMAC signature on an order webhook delivery and respond quickly with a 2xx status.

---

## Requirements

- Complete the [Finish checkout](https://shopify.dev/docs/agents/get-started/checkout) tutorial, including [Step 6: Complete the checkout in your application](https://shopify.dev/docs/agents/get-started/checkout#step-6-alternative-complete-the-checkout-in-your-application). The demo in Step 5 below imports `completeCheckout` from `checkout.js`, which is added in that step.
- Use a Token-tier agent. The Order MCP tools and `read_global_api_orders` scope aren't available to Signed-tier or Anonymous-tier agents. See [Auth and rate limiting](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting) for the full tier matrix.
- (Optional, for the webhooks step) Have your delivery URL configured by Shopify. Webhook subscription isn't self-serve. Contact your Shopify partner manager to register an endpoint for the `orders/create`, `orders/updated`, and `orders/delete` topics.

---

## Step 1: Mint an order-scoped access token

Order MCP requests use a Global API JWT with the `read_global_api_orders` scope. You can reuse the `CLIENT_ID` and `CLIENT_SECRET` you exported in the [Authenticate](https://shopify.dev/docs/agents/get-started/authentication#step-1-generate-api-credentials) tutorial. The `/auth/access_token` endpoint grants whichever scopes your client is configured with, so you don't need to request `read_global_api_orders` explicitly.

Add a `getOrderAccessToken` function to a new `orders.js` file. The shape mirrors the auth helper from the [Authenticate](https://shopify.dev/docs/agents/get-started/authentication) tutorial.

##### orders.js

```javascript
export async function getOrderAccessToken() {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const res = await fetch("https://api.shopify.com/auth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const data = await res.json();
  if (!data.access_token)
    throw new Error(`Token mint failed: ${JSON.stringify(data)}`);
  console.log("\n── Order Token Minted ─────────────────────────────\n");
  console.log(`  Scope:   ${data.scope}`);
  console.log(
    `  Expires: ${new Date(Date.now() + data.expires_in * 1000).toLocaleTimeString()}`,
  );
  return data.access_token;
}
```

##### {} Token request

```bash
curl --request POST \
  --url https://api.shopify.com/auth/access_token \
  --header 'Content-Type: application/json' \
  --data '{
    "client_id": "{your_client_id}",
    "client_secret": "{your_client_secret}",
    "grant_type": "client_credentials"
  }'
```

You can only fetch orders that were placed through your agent. Tokens have a 60-minute TTL, so mint a new one when you need it rather than caching across long-lived sessions.

---

## Step 2: Add the order capability to your agent profile

The profile you hosted in [Define a profile](https://shopify.dev/docs/agents/get-started/profile) declares only `dev.ucp.shopping.cart` and `dev.ucp.shopping.checkout`. To call `get_order`, your profile must also declare `dev.ucp.shopping.order`. Capability negotiation runs before the tool call, so without this entry the order tool isn't available even with a valid bearer token.

Update your hosted profile to add the order capability:

## ucp-demo-agent.json

```json
{
  "ucp": {
    "version": "2026-04-08",
    "capabilities": {
      "dev.ucp.shopping.cart": [{ "version": "2026-04-08" }],
      "dev.ucp.shopping.checkout": [{ "version": "2026-04-08" }],
      "dev.ucp.shopping.order": [{ "version": "2026-04-08" }]
    }
  }
}
```

Re-deploy the file at the same URL you used in earlier tutorials. The merchant fetches the profile on each request, so the new capability is picked up automatically on the next call.

---

## Step 3: Fetch an order with `get_order`

Order MCP shares the merchant's `/api/ucp/mcp` endpoint with Cart MCP and Checkout MCP, so you can reuse the `getMcpEndpoint` helper from `mcp.js` that you added in the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart#step-1-discover-merchant-capabilities) tutorial.

Add a `getOrder` function to `orders.js`. It takes the order GID returned by `complete_checkout` and the merchant's checkout URL (used to discover the MCP endpoint), and returns the full UCP-shaped order payload.

**Caution:**

**Allow propagation time after `complete_checkout`.** After `complete_checkout` returns, allow about 10 seconds before calling `get_order` for the first time. The order needs time to propagate to the order service.

##### orders.js

```javascript
import { getMcpEndpoint } from "./mcp.js";

const AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json";

export async function getOrder(token, orderId, checkoutUrl) {
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
      id: 8,
      params: {
        name: "get_order",
        arguments: {
          id: orderId,
          meta: { "ucp-agent": { profile: AGENT_PROFILE } },
        },
      },
    }),
  });
  const data = await res.json();
  if (data?.result?.isError) {
    const message = data.result.structuredContent?.messages?.[0];
    throw new Error(`get_order error: ${message?.code} (${message?.severity})`);
  }
  if (!data?.result?.structuredContent) {
    throw new Error(`get_order failed: ${JSON.stringify(data)}`);
  }
  return data.result.structuredContent;
}
```

##### {} MCP input reference

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 8,
  "params": {
    "name": "get_order",
    "arguments": {
      "id": "gid://shopify/Order/order_abc123",
      "meta": {
        "ucp-agent": {
          "profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
        }
      }
    }
  }
}
```

The `orderId` argument is the value returned at `result.structuredContent.order.id` in the [`complete_checkout` response](https://shopify.dev/docs/agents/get-started/checkout#step-6-alternative-complete-the-checkout-in-your-application). The demo in [Step 5](#step-5-wire-it-into-the-demo) reads it directly from that response.

Replace `AGENT_PROFILE` with the URL of your updated hosted profile (the one you re-deployed in [Step 2](#step-2-add-the-order-capability-to-your-agent-profile)). The placeholder `valid-with-capabilities.json` is a Shopify-hosted reference profile that declares every capability and is fine to use during local development.

`get_order` returns errors as MCP tool errors, not transport errors. The response sets `result.isError` to `true` and includes a `messages` array on `result.structuredContent`. Always check `messages` before reading order fields. The current error codes are:

- `invalid_order_id` (recoverable): The `id` argument isn't a valid Shopify Order GID. Reformat and retry.
- `order_not_found` (unrecoverable): The order doesn't exist or wasn't placed through your agent. Immediately after `complete_checkout`, this can also surface transiently while the order propagates. Wait a few seconds and retry. The demo in [Step 5](#step-5-wire-it-into-the-demo) uses a 10-second delay for that reason.
- `orders_not_allowed` (unrecoverable): The token is missing the `read_global_api_orders` scope.

---

## Step 4: Render a buyer-facing summary

The order payload follows the [UCP order shape](https://shopify.dev/docs/agents/orders): a top-level envelope plus `totals`, `line_items`, `fulfillment`, and `adjustments`. Add a `displayOrder` helper that renders the fields a buyer typically wants to see in a "Where's my order?" view.

## orders.js

```javascript
export function displayOrder(order) {
  const total = order.totals.find((t) => t.type === "total")?.amount ?? 0;
  console.log("\n── Order Summary ──────────────────────────────────\n");
  console.log(`  ${order.label}`);
  console.log(`  Total:  ${formatMoney(total, order.currency)}`);
  console.log(`  Status page: ${order.permalink_url}\n`);

  console.log("  Items:");
  for (const line of order.line_items) {
    if (line.quantity.total === 0) continue;
    console.log(
      `    · ${line.item.title} (x${line.quantity.total}, ${line.status})`,
    );
  }

  if (order.fulfillment.events.length > 0) {
    console.log("\n  Fulfillment timeline:");
    for (const event of order.fulfillment.events) {
      const when = new Date(event.occurred_at).toLocaleString();
      console.log(`    · ${event.type.padEnd(12)} ${when}`);
    }
  }

  if (order.adjustments.length > 0) {
    console.log("\n  Adjustments:");
    for (const adj of order.adjustments) {
      const amount = adj.totals[0]?.amount ?? 0;
      console.log(
        `    · ${adj.type.padEnd(14)} ${formatMoney(amount, order.currency)}`,
      );
    }
  }
}

function formatMoney(minor, currency) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
  const major = minor / Math.pow(10, fractionDigits);
  return formatter.format(major);
}
```

A few patterns worth noting:

- **Display `label`, not `id`.** The `label` is the buyer-facing identifier (typically `#1042`). Don't render the `gid://shopify/Order/...` ID to buyers.
- **Skip removed line items.** Items removed by an order edit stay in the array with `quantity.total: 0` and `status: "removed"`. Filter them out for a cleaner summary, or render them with strikethrough if your UI tracks edit history.
- **Link to `permalink_url` for the full experience.** Shopify's order status page is the authoritative reference for refunds, returns, and detailed fulfillment information. Your summary should always link out to it.

---

## Step 5: Wire it into the demo

Update `ucp_demo.js` to complete a checkout and then fetch and display the resulting order. This step uses the `completeCheckout` helper added in [Step 6 of the Finish checkout tutorial](https://shopify.dev/docs/agents/get-started/checkout#step-6-alternative-complete-the-checkout-in-your-application), so make sure that export exists in your `checkout.js` before running the demo.

To reach the order summary in this demo, your agent profile must be eligible to call [`complete_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#complete_checkout) and you must supply a valid `payment` object. The payment shape and token-handling requirements are documented in the [Checkout MCP reference](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#complete_checkout). If your agent isn't eligible (or you're testing without payment data), `completeCheckout` returns no order and the demo exits at the escalation branch. The canonical way to observe an order from any flow is the webhook delivery path in [Step 6](#step-6-verify-an-order-webhook-delivery).

## ucp_demo.js

```javascript
import { prompt } from "./utils.js";
import { getAccessToken } from "./auth.js";
import { searchProducts, displayProducts, showCatalog } from "./search.js";
import { selectProduct } from "./product.js";
import { createCart } from "./cart.js";
import {
  createCheckout,
  updateCheckout,
  completeCheckout,
} from "./checkout.js";
import { getOrderAccessToken, getOrder, displayOrder } from "./orders.js";

async function main() {
  const token = await getAccessToken();
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

  const cartId = await createCart(variantId, checkoutUrl);
  const checkoutId = await createCheckout(token, cartId, checkoutUrl);
  const email = await prompt("\n\x1b[1m  Enter your email address:\x1b[0m  ");
  await updateCheckout(token, checkoutId, email, checkoutUrl);

  const payment = null; // Replace with a valid payment object to reach `complete_checkout`.
  const checkout = await completeCheckout(
    token,
    checkoutId,
    checkoutUrl,
    payment,
  );
  if (!checkout?.order?.id) {
    console.log(
      "  No order returned. Hand the buyer off using continue_url and observe the order through the webhook flow in Step 6.",
    );
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const orderToken = await getOrderAccessToken();
  const order = await getOrder(orderToken, checkout.order.id, checkoutUrl);
  displayOrder(order);
}

main().catch((err) => console.error("Request failed:", err));
```

Run the demo with `node ucp_demo.js`. After checkout completes, the script waits 10 seconds for the order to propagate, mints an order-scoped token, and prints a summary that includes the buyer-facing label, line items, fulfillment events, and any adjustments committed so far.

---

## Step 6: Verify an order webhook delivery

Webhooks are the primary update channel for the order capability. Use `get_order` for buyer-initiated views and reconciliation; subscribe to webhooks for proactive lifecycle updates.

When Shopify sends an order webhook to your endpoint, verify the payload using the HMAC value in the `X-Shopify-Hmac-SHA256` header.

Add a `verifyOrderWebhook` function to `orders.js`. It computes the HMAC over the raw request body using your app's shared secret and compares it to the header value with a constant-time check. The shared secret is the same `CLIENT_SECRET` value you exported in the [Authenticate](https://shopify.dev/docs/agents/get-started/authentication#step-1-generate-api-credentials) tutorial. Shopify's Global app model uses one shared secret for both OAuth token minting and webhook HMAC signing.

## orders.js

```javascript
import crypto from "node:crypto";

export function verifyOrderWebhook(rawBody, headers, sharedSecret) {
  const provided = headers["x-shopify-hmac-sha256"];
  if (!provided) return false;
  const computed = crypto
    .createHmac("sha256", sharedSecret)
    .update(rawBody)
    .digest("base64");
  const providedBuf = Buffer.from(provided, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");
  if (providedBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, computedBuf);
}
```

The length check before `timingSafeEqual` is required. In Node, the function throws on buffers of differing lengths, so without it a malformed signature would surface as a 500 error instead of a clean rejection.

Wire the verification into a minimal Express handler that responds with a 2xx status quickly and processes the payload asynchronously. Express isn't part of the project yet, so install it first:

## Terminal

```bash
npm install express
```

Then add the webhook server:

## webhook_server.js

```javascript
import express from "express";
import { verifyOrderWebhook, displayOrder } from "./orders.js";

const SHARED_SECRET = process.env.CLIENT_SECRET;
const app = express();
app.use("/webhooks/orders", express.raw({ type: "application/json" }));

app.post("/webhooks/orders", (req, res) => {
  if (!verifyOrderWebhook(req.body, req.headers, SHARED_SECRET)) {
    return res.status(401).send("Invalid signature");
  }
  res.status(200).end();

  const order = JSON.parse(req.body.toString("utf8"));
  const topic = req.headers["x-shopify-topic"];
  const webhookId = req.headers["x-shopify-webhook-id"];
  console.log(`\n── ${topic} (${webhookId}) ─────────────────────`);
  displayOrder(order);
});

app.listen(3000, () => console.log("Listening for order webhooks on :3000"));
```

The handler reads the raw body (not a parsed JSON object) so the HMAC matches what Shopify signed, returns a 2xx response immediately, and only then processes the payload. A few patterns to follow in production:

- **Deduplicate on `X-Shopify-Webhook-Id`.** This header stays stable across retries of the same event, so you can track the event IDs you've already processed and skip duplicates. See [Ignore duplicate webhooks](https://shopify.dev/docs/apps/build/webhooks/ignore-duplicates).
- **Treat each delivery as the full current state.** Don't merge or replay events from previous deliveries. The latest payload is the source of truth.
- **Move long work out of band.** Acknowledge with 2xx as quickly as possible (well under your endpoint's timeout) and process asynchronously. Shopify retries failed deliveries up to 8 times over 4 hours. See [Webhook best practices](https://shopify.dev/docs/apps/build/webhooks/best-practices) for the full retry policy.

---

## Next steps

- [About orders](https://shopify.dev/docs/agents/orders): Conceptual overview of the order capability, including when to use webhooks vs. `get_order`, the full data model, and known limitations.
- [Order MCP reference](https://shopify.dev/docs/agents/orders/order-mcp): Full reference for `get_order`, including authentication, error codes, and example responses.
- [Order webhooks reference](https://shopify.dev/docs/agents/orders/order-webhooks): Topics, headers, HMAC verification snippets, and the example payload.
- [UCP Order specification](https://ucp.dev/2026-04-08/specification/order/): The canonical specification for the UCP order capability.

---
