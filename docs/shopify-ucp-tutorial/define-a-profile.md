---
title: Define your agent profile
description: Learn how to define a UCP agent profile and host it at a URL for Checkout MCP.
source_url:
  html: "https://shopify.dev/docs/agents/get-started/profile"
  md: "https://shopify.dev/docs/agents/get-started/profile.md"
---

# Define your agent profile

This guide is the second part of a six-part tutorial series that describes how to build an agentic commerce application with the Universal Commerce Protocol (UCP) using Shopify's MCP servers. It demonstrates how to define your agent's capabilities in a profile and host that profile at a URL.

By the end of this tutorial, you'll have an agent profile that declares both cart and checkout capabilities and a profile URL to pass in Cart MCP and Checkout MCP requests.

---

## What you'll learn

In this tutorial, you'll learn to:

- Define your agent's UCP profile with the cart and checkout capabilities.
- Save the profile as `ucp-demo-agent.json` and host it at a URL.

---

## Requirements

- Complete the [Authenticate your agent](https://shopify.dev/docs/agents/get-started/authentication) tutorial.

---

## Step 1: Create the agent profile

Your agent identifies itself to merchants using a [profile](https://shopify.dev/docs/agents/profiles), which is a JSON document that declares the UCP version and capabilities your agent supports. Cart MCP and Checkout MCP require you to send the URL of this profile in every request so the merchant can perform [capability negotiation](https://ucp.dev/2026-04-08/specification/checkout-mcp/#discovery), verifying that your agent supports the relevant capabilities before accepting the call.

Because the upcoming tutorials use Cart MCP to build a cart and Checkout MCP to convert that cart into a checkout, your profile needs to declare both capabilities:

## https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json

```json
{
  "ucp": {
    "version": "2026-04-08",
    "capabilities": {
      "dev.ucp.shopping.cart": [
        {
          "version": "2026-04-08"
        }
      ],
      "dev.ucp.shopping.checkout": [
        {
          "version": "2026-04-08"
        }
      ]
    }
  }
}
```

This profile declares that your agent supports the UCP version `2026-04-08`, the `dev.ucp.shopping.cart` capability, and the `dev.ucp.shopping.checkout` capability. Passing `cart_id` to `create_checkout` to convert a cart into a checkout requires both capabilities to be negotiated, so the profile must include both. You'll use the [URL](https://shopify.dev/ucp/agent-profiles/2026-04-08/cart-and-checkout.json) where this file is hosted as `AGENT_PROFILE` in the [Build a cart](https://shopify.dev/docs/agents/get-started/build-a-cart) and [Finish checkout](https://shopify.dev/docs/agents/get-started/checkout) tutorials.

---

## Step 2: (Optional) Host the profile

Cart MCP and Checkout MCP requests require a link to your agent profile. The merchant fetches that URI to verify your agent's capabilities.

Copy and host the file above at a public URL.

- Use a static host (for example, GitHub raw, or your own domain).
- Serve it from your app (for example, `https://your-app.example/profiles/ucp-demo-agent.json`).

Update `AGENT_PROFILE` in later steps in this tutorial to match your URL. You will see `https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/cart-and-checkout.json` as a placeholder.

---

## Next steps

[Search the Catalog\
\
](https://shopify.dev/docs/agents/get-started/search-catalog)

[Add product search and walk buyers through variant selection.](https://shopify.dev/docs/agents/get-started/search-catalog)

---
