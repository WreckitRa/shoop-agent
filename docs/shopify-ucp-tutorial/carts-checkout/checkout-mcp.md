Checkout MCP
The Checkout MCP server enables AI agents to create and manage checkout sessions, convert carts into checkouts, and refer buyers to the merchant storefront to complete purchases.

How it works
Checkout MCP implements the UCP checkout capability (dev.ucp.shopping.checkout). Checkout tools manage a purchase session once the buyer is ready to buy. All requests require authentication or a signed request.

When the buyer is ready to purchase, pass an optional cart_id to create_checkout to convert a cart built with Cart MCP into a checkout session. See Convert a cart into a checkout.

For usage guidelines, see About carts and checkout. For the full UCP specification, see Checkout
capability
and the Checkout MCP
binding
.

Info
Use Cart MCP for iteration. Checkout MCP is rate-limited more strictly than Cart MCP across all tiers. Iterate on line items, localization, and estimated totals on a cart, then create a checkout when the buyer is ready to buy. See Auth and rate limiting for details.

Authenticate
Obtain your client credentials (client ID and secret) from the Catalog section of Dev Dashboard.

Then use those credentials to retrieve a token for subsequent requests. All requests require the Authorization: Bearer {token} header.

The response contains:

access_token: A JWT access token used to interact with the MCP server.
scope: The list of access scopes granted to your API key.
expires_in: The number of seconds until the access token expires.
JWT tokens created from Dev Dashboard credentials have a 60-minute TTL. You can use a decoder tool like jwt.io
to view more details related to how Shopify issues this token.

POST
https://api.shopify.com/auth/access_token
Copy
1
2
3
4
5
6
7
8
curl --request POST \
 --url https://api.shopify.com/auth/access_token \
 --header 'Content-Type: application/json' \
 --data '{
"client_id": "{your_client_id}",
"client_secret": "{your_client_secret}",
"grant_type": "client_credentials"
}'
{} Response
Copy
1
2
3
4
5
{
"access_token": "f8563253df0bf277ec9ac6f649fc3f17",
"scope": "read_global_api_catalog_search",
"expires_in": 86399
}
Make requests
All requests follow the JSON-RPC 2.0 protocol. Send POST requests to the merchant's UCP endpoint: https://{shop-domain}/api/ucp/mcp

Every request must include a meta object in arguments. Include meta["ucp-agent"] with a profile URI (your agent's UCP profile at /.well-known/ucp
) for capability
negotiation
. For complete_checkout and cancel_checkout, you must also include meta["idempotency-key"] with a unique UUID for retry safety.

The checkout is returned in result.structuredContent. The result.content array may also be present with a text representation of the checkout.

Platforms may use HTTP Message
Signatures
(for example, RFC 9421) for agent authentication in addition to or instead of Bearer tokens.

Learn more about building agentic commerce experiences.

POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "tool_name",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://example.com/.well-known/ucp"
}
}
}
}
}
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/checkout", "schema": "https://ucp.dev/services/shopping/openrpc.json" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/fulfillment", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout" }]
}
},
"id": "checkout_abc123",
"status": "incomplete",
"continue_url": "https://shop.example.com/checkout/checkout_abc123"
},
"content": [
{ "type": "text", "text": "{\"ucp\":{...},\"id\":\"checkout_abc123\",...}" }
]
}
}
Checkout tools
Checkout tools manage a purchase session once the buyer is ready to buy. create_checkout also accepts an optional cart_id to convert a cart built with Cart MCP into a checkout session. See Convert a cart into a checkout.

Caution
Tool use is subject to access and rate limiting that scale with how your agent identifies itself. See Auth and rate limiting for traffic tiers and what each can do.

Checkout MCP provides tools for managing the checkout lifecycle. For get, update, complete, and cancel operations, pass the checkout session ID as the top-level id in arguments rather than within the checkout object. The UCP spec treats resource identification and payload separately so the server can validate requests correctly.

create_checkout: Create a new checkout session with line items and buyer information.
get_checkout: Retrieve the current state of a checkout session.
update_checkout: Update a checkout session with new information.
complete_checkout: Submit payment and place the order. When a checkout returns requires_escalation, direct the buyer to continue_url to complete the purchase on the merchant's checkout.
cancel_checkout: Cancel an active checkout session.
create_checkout
Create a new checkout session with line items, buyer information, and fulfillment preferences.

Use this tool when a buyer is ready to purchase items and you need to initiate the checkout process. The response includes a continue_url for handing off to a trusted UI.

When to use:

Buyer says "I want to buy this item"
Agent has collected enough information to start checkout
Buyer confirms their cart and wants to proceed
Parameters
meta
•
object
Required
Request metadata. You're required to include ucp-agent.profile, the URI to your agent's UCP profile for capability negotiation.

cart_id
•
string
The optional ID of a cart built with Cart MCP to convert into this checkout. When present, the server loads the referenced cart and inherits its line_items, context, and buyer. Overlapping fields in the checkout payload are ignored, and checkout itself becomes optional. Only valid when both the cart and checkout capabilities are negotiated. Invalid GIDs return invalid_cart_id; missing carts return cart_not_found. See Convert a cart into a checkout.

checkout
•
object
Required
The checkout object containing all checkout data. Optional when cart_id is provided, in which case the cart's contents are used instead. Includes the following fields:

currency (required): ISO 4217 currency code (for example, USD, EUR, GBP).
line_items (required): Array of items to purchase. Each item must include quantity and an item object with the product variant id.
buyer: Buyer information including email for order confirmation.
fulfillment: Fulfillment preferences including shipping methods and destinations.
payment: Payment configuration including available instruments and selected_instrument_id.
POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "create_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
}
},
"checkout": {
"currency": "USD",
"line_items": [
{
"quantity": 2,
"item": {
"id": "gid://shopify/ProductVariant/12345678901"
}
}
],
"buyer": {
"email": "buyer@example.com"
},
"fulfillment": {
"methods": [
{
"type": "shipping",
"destinations": [
{
"first_name": "Jane",
"last_name": "Smith",
"street_address": "123 Main Street",
"address_locality": "Brooklyn",
"address_region": "NY",
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/checkout", "schema": "https://ucp.dev/services/shopping/openrpc.json" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/fulfillment", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout" }]
},
"payment_handlers": {
"com.google.pay": [{ "id": "gpay", "version": "2026-01-23", "config": {} }]
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "requires_escalation",
"currency": "USD",
"buyer": {
"email": "buyer@example.com"
},
"line_items": [
{
"id": "gid://shopify/CartLine/li_1?cart=abc123",
"item": {
"id": "gid://shopify/ProductVariant/12345678901",
"title": "Organic Cotton Sweater",
"price": 8900,
"image_url": "https://cdn.shopify.com/example/sweater.jpg"
},
"quantity": 2,
"totals": [
{ "type": "subtotal", "amount": 17800, "display_text": "Subtotal" },
{ "type": "items_discount", "amount": 0, "display_text": "Discount" },
{ "type": "total", "amount": 17800, "display_text": "Total" }
]
get_checkout
Retrieve the current state of an existing checkout session.

Use this tool to check the status of a checkout, see updated totals after changes, or verify what information is still needed before completion.

When to use:

Need to refresh checkout state after buyer returns
Want to show current totals and line items
Checking if checkout is ready for payment
Parameters
meta
•
object
Required
Request metadata. You're required to include ucp-agent.profile, the URI to your agent's UCP profile for capability negotiation.

id
•
string
Required
The ID of the checkout session to retrieve.

POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "get_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789"
}
}
}
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/checkout", "schema": "https://ucp.dev/services/shopping/openrpc.json" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/fulfillment", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout" }]
},
"payment_handlers": {
"com.google.pay": [{ "id": "gpay", "version": "2026-01-23", "config": {} }]
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "incomplete",
"currency": "USD",
"buyer": {
"email": "buyer@example.com"
},
"line_items": [
{
"id": "gid://shopify/CartLine/li_1?cart=abc123",
"item": {
"id": "gid://shopify/ProductVariant/12345678901",
"title": "Organic Cotton Sweater",
"price": 8900,
"image_url": "https://cdn.shopify.com/example/sweater.jpg"
},
"quantity": 2,
"totals": [
{ "type": "subtotal", "amount": 17800, "display_text": "Subtotal" },
{ "type": "items_discount", "amount": 0, "display_text": "Discount" },
{ "type": "total", "amount": 17800, "display_text": "Total" }
]
update_checkout
Update an existing checkout session with new information.

Use this tool to modify line items, update shipping address, change fulfillment method, or add buyer information before completing the checkout.

When to use:

Buyer wants to change quantity or remove items
Buyer provides or updates shipping address
Need to update buyer email or contact info
Changing a delivery option
Caution
update_checkout uses PUT semantics. Each request replaces the full checkout state with the payload you send. Omit a field (for example line_items or buyer) and it is removed from the checkout. There is no server-side merge of partial updates.

Parameters
meta
•
object
Required
Request metadata. You're required to include ucp-agent.profile, the URI to your agent's UCP profile for capability negotiation.

id
•
string
Required
The ID of the checkout session to update.

checkout
•
object
Required
The checkout object containing the complete updated checkout state. Includes the following fields:

line_items: Updated array of items. Replaces existing line items.
buyer: Updated buyer information.
fulfillment: Updated fulfillment preferences.
payment: Updated payment configuration.
POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "update_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"checkout": {
"line_items": [
{
"quantity": 1,
"item": {
"id": "gid://shopify/ProductVariant/12345678901"
}
}
],
"fulfillment": {
"methods": [
{
"type": "shipping",
"destinations": [
{
"first_name": "Jane",
"last_name": "Smith",
"street_address": "456 Oak Avenue",
"address_locality": "Manhattan",
"address_region": "NY",
"postal_code": "10001",
"address_country": "US"
}
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/checkout", "schema": "https://ucp.dev/services/shopping/openrpc.json" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/fulfillment", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout" }]
},
"payment_handlers": {
"com.google.pay": [{ "id": "gpay", "version": "2026-01-23", "config": {} }]
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "requires_escalation",
"currency": "USD",
"buyer": {
"email": "buyer@example.com"
},
"line_items": [
{
"id": "gid://shopify/CartLine/li_1?cart=abc123",
"item": {
"id": "gid://shopify/ProductVariant/12345678901",
"title": "Organic Cotton Sweater",
"price": 8900,
"image_url": "https://cdn.shopify.com/example/sweater.jpg"
},
"quantity": 1,
"totals": [
{ "type": "subtotal", "amount": 8900, "display_text": "Subtotal" },
{ "type": "items_discount", "amount": 0, "display_text": "Discount" },
{ "type": "total", "amount": 8900, "display_text": "Total" }
]
complete_checkout
Submit payment and place the order. Requires meta["idempotency-key"] (UUID) in addition to meta["ucp-agent"]. Use this tool when the checkout is ready and the buyer has authorized payment. This finalizes the transaction and creates an order.

When to use:

Checkout status is ready_for_complete
Buyer has reviewed and confirmed the order
Payment credential has been collected
Parameters
meta
•
object
Required
Request metadata. You're required to include ucp-agent.profile, the URI to your agent's UCP profile for capability negotiation, and an idempotency-key.

id
•
string
Required
The ID of the checkout session to complete.

checkout
•
object
Required
Checkout object containing payment credentials and finalization data. Include checkout.payment with the payment instrument and credential from the trusted UI.

POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "complete_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
},
"idempotency-key": "661e9500-f39c-52e5-b827-557766551111"
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"checkout": {
"payment": {
"instruments": [
"id": "pm_1234567890abc",
"handler_id": "gpay_7k2m",
"type": "card"
]
}
}
}
}
}
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23" }]
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "completed",
"currency": "USD",
"buyer": {
"email": "buyer@example.com"
},
"line_items": [
{
"id": "gid://shopify/CartLine/li_1?cart=abc123",
"item": {
"id": "gid://shopify/ProductVariant/12345678901",
"title": "Organic Cotton Sweater",
"price": 8900
},
"quantity": 2,
"totals": [
{ "type": "subtotal", "amount": 17800 },
{ "type": "total", "amount": 17800 }
]
}
],
"totals": [
{ "type": "subtotal", "amount": 17800 },
{ "type": "fulfillment", "amount": 500 },
cancel_checkout
Cancel an active checkout session. Requires meta["idempotency-key"] (UUID) in addition to meta["ucp-agent"]. Use this tool when a buyer abandons the checkout or explicitly requests cancellation. Canceled checkouts cannot be resumed.

When to use:

Buyer explicitly cancels the order
Session has been abandoned
Need to start fresh with a new checkout
Parameters
meta
•
object
Required
Request metadata. You're required to include ucp-agent.profile, the URI to your agent's UCP profile for capability negotiation, and an idempotency-key.

id
•
string
Required
The ID of the checkout session to cancel.

POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "cancel_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
},
"idempotency-key": "772f0611-g40d-63f6-c938-668877662222"
},
"id": "gid://shopify/Checkout/abc123?key=xyz789"
}
}
}
{} Response
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": {
"version": "2026-01-23",
"capabilities": {
"dev.ucp.shopping.checkout": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/checkout", "schema": "https://ucp.dev/services/shopping/openrpc.json" }],
"dev.ucp.shopping.fulfillment": [{ "version": "2026-01-23", "spec": "https://ucp.dev/specs/shopping/fulfillment", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout" }]
}
},
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "canceled",
"currency": "USD",
"line_items": [],
"totals": [],
"fulfillment": {},
"links": [],
"payment": {
"instruments": []
},
"messages": []
}
}
}
Convert a cart into a checkout
When both the cart and checkout capabilities are negotiated, create_checkout accepts an optional top-level cart_id in arguments. Passing a cart ID from Cart MCP converts the referenced cart into a checkout session.

The server applies the following rules:

Cart contents win. The merchant uses the cart's line_items, context, and buyer when creating the checkout and ignores any overlapping fields in the checkout payload.
checkout becomes optional. When cart_id is provided, the checkout payload is optional. You can omit it entirely and let the cart's contents drive the checkout.
Idempotent conversion. If an incomplete checkout already exists for the cart, the server returns that existing session rather than creating a new one. Safe to retry.
Linked lifecycle. The cart remains linked to the checkout for the duration of the checkout. This supports back-to-storefront flows where the buyer returns to the cart on the merchant site.
The server returns business outcomes when cart_id can't be resolved:

invalid_cart_id: The cart_id isn't a valid Shopify GID.
cart_not_found: The cart doesn't exist or has expired.
Note
cart_id is currently accepted as input but is not returned on checkout response objects. Store the cart ID on your side if you need to reference it after conversion.

POST
https://{shop-domain}/api/ucp/mcp
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "create_checkout",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json"
}
},
"cart_id": "gid://shopify/Cart/cart_abc123",
"checkout": {
"currency": "USD",
"buyer": { "email": "buyer@example.com" }
}
}
}
}
Checkout status
General access
For most partners referring checkout sessions from Catalog, each response from create_checkout, get_checkout, and update_checkout includes:

status: requires_escalation
messages: an array of message objects, each with type and severity. The message's severity is requires_buyer_input (merchant needs input not available via API), requires_buyer_review (the buyer hasn't opted in to the channel, or the checkout otherwise requires review not available via API), or recoverable depending on the condition.
continue_url for handing off to the merchant storefront
When the session is ready for the buyer to finish on the storefront, present the continue_url. For general access, directing buyers to that URL is how checkout completes; you do not call complete_checkout.

Append query parameters to continue_url for attribution, such as UTM tags:

Copy
1
https://merchant.example/checkout/cn/...?utm_source=your_agent&utm_medium=agentic_commerce&utm_campaign=example
General access terminal state (example)
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"id": "gid://shopify/Checkout/...",
"status": "requires_escalation",
"messages": [
{
"type": "error",
"severity": "requires_buyer_input"
}
],
"continue_url": "https://merchant.com/checkout/..."
}
}
}
Lifecycle
Every tool response includes status and a messages array. Each message has a severity that reflects the resource state and recommended action.

Build for escalations regardless of how you authenticate. When status is incomplete or requires_escalation, use severity to decide the next step: call update_checkout to resolve recoverable messages, or direct the buyer to continue_url when messages include severity: requires_buyer_input or severity: requires_buyer_review. When status is ready_for_complete, you can call complete_checkout to place the order in your application; otherwise, the buyer finishes on the merchant's checkout via continue_url.

See the checkout status
lifecycle
in the UCP spec for the full reference.

Status Description
incomplete Checkout is missing required information. Inspect messages (including each message's severity) and resolve via update_checkout.
requires_escalation Checkout requires buyer input or review not available via API. Check messages for severity: requires_buyer_input or severity: requires_buyer_review and hand off to the buyer via continue_url.
ready_for_complete All information is collected. Call complete_checkout or hand off via continue_url.
complete_in_progress Merchant is processing the complete_checkout request.
completed Order placed successfully.
canceled Checkout session is invalid or expired. Start a new session if needed.
Error handling
UCP distinguishes between protocol errors and business outcomes.

Business outcomes: Application-level results from successful request processing, returned as JSON-RPC result with the UCP envelope and a messages array.
Protocol errors: Transport-level failures (authentication, rate limiting, unavailability) that prevent request processing. Returned as JSON-RPC error with code -32000, or -32001 for discovery errors.
See the Cart MCP
binding
, the Checkout MCP
binding
, and Core Specification error
handling
for the complete error code registry and examples.

Protocol errors
Transport-level failures that prevent the request from being processed (for example authentication failure, rate limiting, or service unavailability) are returned as JSON-RPC error with code -32000, or -32001 for discovery errors. These are not application outcomes: the server did not complete the operation.

When the server rate-limits your request, retry after the delay specified by the HTTP Retry-After response header. Clients should honor Retry-After and apply exponential backoff with jitter when the header is absent. Don't retry inside the same checkout or payment lifecycle without an idempotency-key
.

Protocol error (JSON-RPC error)
Copy
1
2
3
4
5
6
7
8
{
"jsonrpc": "2.0",
"id": 1,
"error": {
"code": -32000,
"message": "Unauthorized"
}
}
Business outcomes
Application-level results (including conditions like an expired session, unavailable merchandise, an invalid address, or a declined payment) are returned as a successful JSON-RPC result with structuredContent and a messages array. The request was processed; the outcome is in the payload.

Inspect result.structuredContent and its messages array. Use message type, code, and optional path to adjust your flow (for example, prompt the buyer to fix an address or direct them to continue_url).

Cart responses use a different envelope. See Business outcomes on Cart MCP when working with cart tools.

Business outcome (result with messages)
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
{
"jsonrpc": "2.0",
"id": 1,
"result": {
"structuredContent": {
"ucp": { "version": "2026-04-08", "capabilities": { "dev.ucp.shopping.checkout": [{ "version": "2026-04-08", "spec": "https://ucp.dev/2026-04-08/specification/checkout" }] } },
"id": "gid://shopify/Checkout/abc123?key=xyz789",
"status": "incomplete",
"line_items": [
{ "id": "gid://shopify/CartLine/li_1?cart=abc123", "quantity": 1 }
],
"messages": [
{
"type": "error",
"code": "address_invalid",
"content": "Shipping address is missing a postal code",
"path": "$.fulfillment.methods[0].destinations[0].postal_code"
}
],
"continue_url": "https://shop.example.com/checkouts/c/abc123?key=xyz789"
}
}
}
