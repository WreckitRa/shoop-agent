---
title: Carts and checkout for agents
description: >-
  Build carts, create checkout sessions, and refer buyers to the merchant
  storefront in agentic commerce applications.
source_url:
  html: "https://shopify.dev/docs/agents/carts-and-checkout"
  md: "https://shopify.dev/docs/agents/carts-and-checkout.md"
---

# Carts and checkout for agents

Carts and checkout in [Universal Commerce Protocol (UCP)](https://ucp.dev) let your agent move buyers from product selection to purchase. Build a cart to iterate on line items and totals while the buyer is still shopping. When they're ready to buy, follow the cart's `continue_url` to hand off to the merchant's checkout, or create a checkout session when finalized values are critical to the buyer's experience.

The merchant always remains the merchant of record. When eligible, your agent can complete the checkout directly. When a purchase requires [escalation or review](https://ucp.dev/2026-04-08/specification/checkout/#status-values), redirect the buyer to the merchant's prefilled checkout for completion.

**Caution:**

Tool use is subject to access and rate limiting that scale with how your agent identifies itself. See [Auth and rate limiting](https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting) for traffic tiers and what each can do.

---

## How it works

After product discovery, your agent can move buyers toward purchase using one of the following approaches:

- **[Cart MCP](#cart-mcp)**: Build and iterate on a cart before the buyer commits to purchase. Cart tools accept unauthenticated requests, which lets your agent estimate totals and share a cart with the buyer before collecting credentials.
- **[Checkout MCP](#checkout-mcp)**: Create and manage a checkout session, optionally converting a cart into a checkout. Checkout tools require [authentication](https://shopify.dev/docs/agents/get-started/authentication) or a signed request.
- **[Cart permalinks](#cart-permalinks)**: URLs that take buyers directly to a merchant's checkout with pre-selected items. The Catalog returns a `checkout_url` for each variant that you can use directly in your agent for simpler flows.

### End-to-end flow

A typical purchase flow combines Cart MCP and Checkout MCP:

![Carts and checkout flow: authenticate, use the Catalog MCP, optionally create a cart, convert to checkout with create_checkout(cart_id), update checkout, and complete on storefront.](https://shopify.dev/assets/assets/images/agents/carts-checkout-flow-light-DrY7D64H.png)

1. Your agent authenticates itself and gets an access token.
2. A buyer discovers products using the Catalog MCP, with results optionally scoped to a custom catalog.
3. (Optional) Build a cart with [`create_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#create_cart), iterating on line items and context until the buyer is ready to purchase.
4. Call [`create_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#create_checkout) with the selected line items, or pass `cart_id` to convert an existing cart into a checkout.
5. Call [`update_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#update_checkout) as needed to resolve missing data or add more line items.
6. Direct the buyer to the `continue_url` in the response to finish checkout on the merchant's storefront.

---

## Cart MCP

[Cart MCP](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp) implements UCP's [cart capability](https://ucp.dev/2026-04-08/specification/cart/). A cart holds line items, localization context, and buyer information. Use carts to iterate on line items across multiple conversations, show estimated totals before the buyer commits, or hand off a cart to the buyer via `continue_url` without starting a checkout session. Carts are designed for long-running, exploratory sessions.

Cart tools accept unauthenticated requests, so your agent can call them while the buyer is still browsing:

| Tool                                                                                     | Description                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`create_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#create_cart) | Start a new cart with line items and optional context. |
| [`get_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#get_cart)       | Fetch the current cart state and totals.               |
| [`update_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#update_cart) | Replace the cart's contents.                           |
| [`cancel_cart`](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp#cancel_cart) | Delete the cart. No further action can be taken.       |

**Caution:**

`update_cart` uses PUT semantics. This differs from Storefront API and AJAX cart mutations, which patch individual fields. Each `update_cart` request replaces the cart's full state with the payload you send. Omit a field and it's removed from the cart.

---

## Checkout MCP

[Checkout MCP](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp) implements UCP's [checkout capability](https://ucp.dev/2026-04-08/specification/checkout/). A checkout session represents an active purchase. Use checkout tools once the buyer is ready to buy to resolve fulfillment or buyer details and then refer them to the merchant's storefront.

Checkout tools require [authentication](https://shopify.dev/docs/agents/get-started/authentication) or a signed request:

| Tool                                                                                                     | Description                                                                |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`create_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#create_checkout)     | Start a new checkout session, optionally from an existing cart.            |
| [`get_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#get_checkout)           | Fetch the current checkout state.                                          |
| [`update_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#update_checkout)     | Update items, fulfillment options, or buyer information.                   |
| [`complete_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#complete_checkout) | Finalize the checkout after the buyer completes payment on the storefront. |
| [`cancel_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#cancel_checkout)     | Cancel an in-progress checkout session.                                    |

Every checkout response includes a `status` and a `messages` array. Non-terminal states (`incomplete`, `requires_escalation`, `ready_for_complete`) also include a `continue_url` that hands the buyer off to the merchant's storefront. See [Checkout status](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#checkout-status) for the full lifecycle and response shape.

### Convert a cart into a checkout

When the buyer is ready to purchase, convert a cart from [Cart MCP](#cart-mcp) into a checkout by passing the cart's `id` as `cart_id` on [`create_checkout`](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#create_checkout). The merchant uses the cart's line items, context, and buyer when creating the checkout, and ignores any overlapping fields in the checkout payload. Conversion is idempotent: calling `create_checkout` with the same `cart_id` twice returns the same incomplete checkout.

See [Convert a cart into a checkout](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp#convert-a-cart-into-a-checkout) for the full rules.

---

## Cart permalinks

Cart permalinks are URLs that take buyers directly to a merchant's checkout with pre-selected items. Use permalinks for simpler flows where you redirect buyers without managing a cart or checkout session programmatically.

### Get a permalink from the Global Catalog

The [Global Catalog](https://shopify.dev/docs/agents/catalog/global-catalog) returns a `checkout_url` for each variant when you call [`get_product`](https://shopify.dev/docs/agents/catalog/global-catalog#get_product):

```json
{
  "product": {
    "title": "Organic Cotton Crewneck Sweater",
    "variants": [
      {
        "id": "gid://shopify/ProductVariant/11111111111",
        "checkout_url": "https://ecowear-example.myshopify.com/cart/11111111111:1?payment=shop_pay"
      }
    ]
  }
}
```

### Customize the permalink

You can append query parameters to prefill buyer information, apply discounts, add custom tracking data, or attribute marketing campaigns. See [supported checkout parameters](https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks#supported-checkout-parameters) for the full list:

```text
https://ecowear-example.myshopify.com/cart/c/abc123?key=xyz789&utm_source=xyz_source
```

### Handle multiple merchants

The Global Catalog can return products from multiple merchants in a single search. Cart permalinks are scoped to a single merchant, so when buyers select variants from different merchants, group them by shop domain and create a separate checkout URL for each:

```javascript
const variantsByMerchant = {};
selectedVariants.forEach((variant) => {
  const shopDomain = variant.seller.domain;
  if (!variantsByMerchant[shopDomain]) {
    variantsByMerchant[shopDomain] = [];
  }
  variantsByMerchant[shopDomain].push(variant);
});

Object.entries(variantsByMerchant).forEach(([shopDomain, variants]) => {
  const variantIds = variants
    .map((v) => {
      const id = v.id.split("/").pop();
      return `${id}:1`;
    })
    .join(",");

  const checkoutUrl = `https://${shopDomain}/cart/${variantIds}`;
  console.log(`Checkout for ${shopDomain}: ${checkoutUrl}`);
});
```

---

## Next steps

[Cart MCP reference\
\
](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp)

[Reference for UCP-compliant cart tools on Shopify.](https://shopify.dev/docs/agents/carts-and-checkout/cart-mcp)

[Checkout MCP reference\
\
](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp)

[Reference for UCP-compliant checkout tools on Shopify.](https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp)

[Build a cart with Cart MCP\
\
](https://shopify.dev/docs/agents/get-started/build-a-cart)

[Walk through building a cart before the buyer commits to purchase.](https://shopify.dev/docs/agents/get-started/build-a-cart)

[Finish checkout with Checkout MCP\
\
](https://shopify.dev/docs/agents/get-started/checkout)

[Walk through the checkout flow end-to-end, with an optional cart conversion step.](https://shopify.dev/docs/agents/get-started/checkout)

---
