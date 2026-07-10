API Limitations
This page outlines the current limitations to keep in mind when integrating with the API.

​
Pre-Purchase
Product data is not available through Universal Checkout API, but can be accessed via the Sync API. You can use these two APIs together by retrieving product data from the Sync API and submitting orders through Universal Checkout API.
​
Ordering & Checkout
Amazon Orders
Amazon orders are placed through Rye as the merchant of record. They will not use the end shopper’s personal Amazon account.
All Orders
Login or non-guest checkout flows are not supported.
Only physical products are supported at this time.
US-only ordering is supported.
One product per checkout is required. Multiple quantities of the same product are supported, but multi-product carts are not supported yet.
Stores with advanced anti‑bot mechanisms (such as REI or Sephora) are not yet supported.
Product variants (such as size or color) are supported via the variantSelections field or by providing a variant-specific product URL. See the Variants guide for details.
Shipping options default to the first option returned (usually the lowest cost). Developers cannot select from multiple options.
Currently, Rye does not support webhooks for the async processes of creating or confirming a Checkout Intent. We recommend polling the /api/v1/checkout_intent/{id} endpoint every 10 seconds for updates to avoid overloading our system while keeping your system in sync.
Rate limits: See the Rate Limits guide for the per-bucket limits, response headers, and how to request an increase.
Checkout intents cannot be updated once created. To change buyer details such as the shipping address, you need to create a new checkout intent with the updated information.
Merchant of Record & Payment Flows
Rye supports multiple payment providers. With Stripe, Rye is the merchant of record. With Basis Theory, the card is forwarded directly to the merchant’s payment vault (e.g., Shopify), so Rye is not the merchant of record for Shopify orders.
Variant Selection
Use the product lookup endpoint to retrieve available variant dimensions and values before placing an order.
The variantSelections field lets you specify which variant to purchase. Labels are fuzzy-matched (e.g., “Colour” matches “Color”), but values must match exactly (case-insensitive). If no variant matches, the API returns a variant_selections_invalid error.
Alternatively, if the productUrl already includes the variant identifier, you don’t need to include variantSelections. When both are provided, variantSelections takes precedence.
When using variantSelections, pass the exact option labels and values from the product data, not a variant ID. For example:
[{ label: ‘Size’, value: ‘8.5’ }, { label: ‘Color’, value: ‘Blue’ }].
​
Post-Purchase
Amazon Orders
All Amazon orders are placed via Rye’s Amazon account.
Buyers will also receive email updates for their Amazon orders, including when an order is placed, shipped, cancelled, delayed, or delivered. These emails will come from a Rye domain.
For Amazon-fulfilled shipments (Amazon Logistics / AMZL), tracking numbers are not included because orders are placed through Rye’s Amazon account and buyers cannot access Amazon’s internal tracking. All other updates will still be sent.
Returns: Buyers can contact either Rye or you, the developer, for returns. If they contact you, we’ll work together to ensure a smooth return experience.
Non-Amazon Orders
Rye does not track orders post-purchase. Rye’s API places orders on the store website acting on behalf of the end-user. If the end-user has provided an email and/or phone number, they will directly receive tracking information.
Post-purchase webhooks are not supported. Order confirmations and updates are sent directly to the buyer via the email address provided in the buyer identity.
Returns: Buyers would need to contact the merchant directly for returns. They can use the details from the order confirmation email to help the merchant find the order.
