---
title: Shop Pay payment handler specification
description: >-
  Technical specification for integrating Shop Pay as a UCP payment handler for
  merchant stores and agents.
source_url:
  html: "https://shopify.dev/docs/agents/carts-and-checkout/shop-pay-handler"
  md: "https://shopify.dev/docs/agents/carts-and-checkout/shop-pay-handler.md"
---

# Shop Pay payment handler specification

The `dev.shopify.shop_pay` handler enables merchants to offer Shop Pay as an accelerated checkout option through UCP-compatible agents. [Shop Pay](https://www.shopify.com/shop-pay) is Shopify's native payment solution that provides a streamlined checkout experience by securely storing buyer payment and shipping information.

This handler enables a delegated payment flow where agents can securely generate a Shop Token for a buyer's selected payment instrument in Shop Pay. Merchants can then process these tokens, and agents can leverage the same Shop Pay integration across all participating merchants.

---

## Key benefits

- **Accelerated checkout**: Buyers with Shop Pay accounts can complete purchases faster using their saved payment and shipping details.
- **Delegated payments**: Agents can orchestrate Shop Pay payments without directly handling sensitive payment credentials.
- **Standardized integration**: A single Shop Pay integration works across all UCP-compatible merchants.

---

## Merchant integration

Merchants enable Shop Pay through UCP by advertising the handler in their payment configuration and processing Shop Pay tokens when buyers complete checkout.

### Requirements

Requirements depend on whether you're a Shopify merchant or integrating as an external merchant:

If you're a Shopify merchant, Shopify automatically advertises all UCP payment handlers on your behalf, including Shop Pay.

If you're an external merchant, you must register for Shop Pay to obtain your `shop_id` before advertising Shop Pay through UCP.

### Handler configuration

Merchants advertise Shop Pay support by including the handler in their payment handlers array. The handler uses a minimal configuration containing only the merchant's Shop Pay identifier today.

#### Configuration schema

| Field              | Type   | Description                                |
| ------------------ | ------ | ------------------------------------------ |
| `shop_id` required | String | The merchant's unique Shop Pay identifier. |

The following example shows how merchants declare the Shop Pay handler in their payment configuration:

```json
{
  "ucp": {
    "payment_handlers": {
      "dev.shopify.shop_pay": [
        {
          "id": "shop_pay",
          "version": "2026-01-23",
          "spec": "https://shopify.dev/ucp/shop-pay-handler/2026-01-23/spec.md",
          "schema": "https://shopify.dev/ucp/shop-pay-handler/2026-01-23/schema.json",
          "config": {
            "shop_id": "shopify-559128571"
          }
        }
      ]
    }
  }
}
```

### Payment instrument support

By advertising the Shop Pay handler, merchants indicate they can accept and process Shop Pay payment instruments. Merchants must be able to handle payment objects conforming to the Shop Pay instrument schema.

#### Instrument schema

Shop Pay instruments extend the base UCP payment instrument with Shop Pay-specific fields and credential types.

| Field                       | Type   | Description                                                     |
| --------------------------- | ------ | --------------------------------------------------------------- |
| `id` required               | String | Unique identifier for this payment instrument.                  |
| `handler_id` required       | String | Must match the handler's `id` (for example, `shop_pay`).        |
| `type` required             | String | Must be `shop_pay`.                                             |
| `credential` required       | Object | The Shop Pay credential containing the token.                   |
| `credential.type` required  | String | Must be `shop_token`.                                           |
| `credential.token` required | String | The Shop Token from the delegated payment flow.                 |
| `billing_address` required  | Object | The billing address associated with the Shop Pay account.       |
| `display`                   | Object | Display information for this Shop Pay instrument.               |
| `display.email`             | String | The buyer's email address associated with the Shop Pay account. |

Merchants receive a payment object structured as follows when an agent submits a Shop Pay payment:

## {} Response

```json
{
  "payment": {
    "instruments": [
      {
        "id": "instr_shop_pay_1",
        "handler_id": "shop_pay",
        "type": "shop_pay",
        "credential": {
          "type": "shop_token",
          "token": "shop_abc123xyz789..."
        },
        "display": {
          "email": "buyer@example.com"
        },
        "billing_address": {
          "full_name": "Jane Doe",
          "street_address": "123 Main St",
          "address_locality": "San Francisco",
          "address_region": "CA",
          "postal_code": "94102",
          "address_country": "US"
        },
        "selected": true
      }
    ]
  }
}
```

---

## Agent integration

Agents orchestrate Shop Pay payments on behalf of merchants through a delegated flow that collects payment authorization from buyers and returns a token for processing.

### Requirements

Before handling delegated Shop Pay payments, agents must register with Shop Pay to obtain a `client_id` that supports delegated experiences.

**Info:**

Self-serve registration for Shop Pay `client_id` credentials isn't open yet. Raise your use case on the [UCP discussions forum](https://github.com/Universal-Commerce-Protocol/ucp/discussions) to get access.

### Obtain a Shop Token

A Shop Token is a single-use, checkout-scoped credential that represents buyer authorization for a specific payment on a specific merchant. Your agent never handles the buyer's payment details directly — Shop Pay returns a Shop Token after the buyer authenticates and authorizes the payment, and you submit that token as the payment credential when you complete the checkout.

Agents acquire a Shop Token by walking the buyer through the Shop Pay authorization flow using the `client_id` from registration and the merchant's `shop_id` from the `dev.shopify.shop_pay` handler config:

1. Initialize the delegated payment context with the merchant's `shop_id` and your `client_id`.
2. Build a UCP payment request from the checkout session's totals, fulfillment options, line items, currency, and locale.
3. Present the payment request to the buyer through the Shop Pay interface (in-app browser or a web view pointed at the authorization URL returned by Shop Pay).
4. After the buyer authenticates and authorizes, Shop Pay returns the Shop Token to your agent. Submit the token on the next `complete_checkout` call.

For delegated flows that span multiple checkouts for the same buyer (for example, to support recurring or multi-merchant experiences), see the identity-linked flow described in [Identity Linking](https://ucp.dev/2026-04-08/specification/identity-linking/).

### Handler configuration

Agents advertise Shop Pay support by including the handler in their payment handlers array. The handler uses a minimal configuration containing only the agent's Shop Pay identifier.

#### Configuration schema

| Field                | Type   | Description                             |
| -------------------- | ------ | --------------------------------------- |
| `client_id` required | String | The agent's unique Shop Pay identifier. |

The following example shows how agents declare the Shop Pay handler in their payment configuration:

```json
{
  "ucp": {
    "payment_handlers": {
      "dev.shopify.shop_pay": [
        {
          "id": "shop_pay",
          "version": "2026-01-23",
          "spec": "https://shopify.dev/ucp/shop-pay-handler/2026-01-23/spec.md",
          "schema": "https://shopify.dev/ucp/shop-pay-handler/2026-01-23/schema.json",
          "config": {
            "client_id": "shop-client-4578576128"
          }
        }
      ]
    }
  }
}
```

### Delegated payment protocol

Agents must follow this flow to process a `dev.shopify.shop_pay` handler:

#### Step 1: Discover handler

Identify `dev.shopify.shop_pay` in the merchant's `payment_handlers` map from the checkout response or merchant profile.

#### Step 2: Build payment request

Build a Shop Pay payment request by:

1. **Initializing the delegated payment context:**
   - Provide the merchant's `shop_id` from the handler configuration.
   - Provide your agent's `client_id` obtained during registration.
   - This establishes that you're orchestrating a Shop Pay payment on behalf of the merchant.

2. **Constructing the payment request with standardized UCP checkout data:**
   - **Totals:** Subtotal, shipping, tax, and grand total amounts.
   - **Fulfillment options:** Available shipping methods or pickup locations.
   - **Line items:** Product details, quantities, and pricing.
   - **Currency and locale:** For proper formatting and display.

Present this payment request to the buyer through the Shop Pay interface, where they can authenticate and select their preferred payment method.

#### Step 3: Complete checkout

After the buyer confirms, Shop Pay returns a Shop Token. Wrap this token in a UCP payment instrument conforming to the Shop Pay instrument schema and submit the complete checkout request to the merchant:

```http
POST /checkout-sessions/{checkout_id}/complete
Content-Type: application/json
UCP-Agent: profile="https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"


{
  "payment_data": {
    "id": "instr_shop_pay_1",
    "handler_id": "shop_pay",
    "type": "shop_pay",
    "credential": {
      "type": "shop_token",
      "token": "shop_abc123xyz789..."
    },
    "display": {
      "email": "buyer@example.com"
    },
    "billing_address": {
      "full_name": "Jane Doe",
      "street_address": "123 Main St",
      "address_locality": "San Francisco",
      "address_region": "CA",
      "postal_code": "94102",
      "address_country": "US"
    },
    "selected": true
  }
}
```

Upon successful processing, the merchant returns the completed checkout state with an `order_id` confirming the purchase.

---

## Merchant processing

Upon receiving a `shop_pay` payment instrument, merchants must:

1. **Validate handler:** Confirm `handler_id` matches a configured Shop Pay handler.

2. **Extract token:** Retrieve the `token` from `credential.token`.

3. **Process payment:** Use the Shop Token to complete the payment through Shop Pay's payment processing API.

4. **Return response:** Respond with the finalized checkout state including order confirmation details.

---

## Security considerations

The Shop Pay handler implements multiple security measures to protect payment data and ensure proper authorization throughout the delegated payment flow.

### Token security

- **Single-use tokens**: Shop Tokens are designed to be single-use and can't be reused across transactions.
- **Time-limited**: Tokens have a limited validity period and should be used promptly after generation.
- **Checkout-scoped**: Tokens have context about the checkout and merchant, preventing usage outside of the verified checkout.
- **Secure transmission**: All token exchanges must occur over TLS 1.2+.

### Agent authorization

- Agents must register with Shop Pay to obtain a valid `client_id` before processing delegated payments.
- The `client_id` identifies the agent to Shop Pay and enables proper authorization tracking.

---

## Schema reference

The following JSON schemas define the structure and validation rules for Shop Pay handler configuration and payment data:

- [Handler schema](https://shopify.dev/ucp/shop-pay-handler/2026-01-23/schema.json): The root schema defining all Shop Pay handler components, from configs to instruments to credentials.
- [Merchant config](https://shopify.dev/ucp/shop-pay-handler/2026-01-23/business_config.json): Defines the required `shop_id` configuration field that merchants include when advertising the Shop Pay handler.
- [Agent config](https://shopify.dev/ucp/shop-pay-handler/2026-01-23/platform_config.json): Defines the required `client_id` configuration field that agents include when advertising the Shop Pay handler.
- [Shop Pay Instrument schema](https://shopify.dev/ucp/shop-pay-handler/2026-01-23/shop_pay.json): Specifies the structure of Shop Pay payment instruments that agents submit and merchants process, including credential and billing address requirements.
- [Shop Token Credential schema](https://shopify.dev/ucp/shop-pay-handler/2026-01-23/shop_token.json): Details the Shop Token credential format used to authorize payments through the delegated flow.

---
