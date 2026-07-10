Global Catalog MCP
The Global Catalog MCP server enables AI agents to search and discover products across the entire Shopify ecosystem, helping buyers find products from multiple merchants.

Global Catalog MCP implements the UCP Catalog
capability
and its MCP
binding
. The names, request and response shapes of tools conform to the UCP
specification
.

When to use Global Catalog MCP
Use Global Catalog MCP when your agent needs to discover products across multiple Shopify merchants — for example, comparison shopping, cross-merchant discovery, or recommendations not tied to a specific store. For single-store agents, use Storefront Catalog MCP.

How it works
Product discovery follows a two-step flow:

Discover: Your agent finds matching products using search_catalog or lookup_catalog. search_catalog supports a text query, an image, or a set of product IDs to find similar items. lookup_catalog resolves known identifiers to their current catalog data. Results are clustered by Universal Product ID (UPID) and include offers from multiple merchants.
Evaluate: Your agent calls get_product with a product or variant ID to explore available options and refine selection — for example, which colors are available in size medium — then retrieve pricing and seller checkout links for the buyer's chosen variant.
Available tools
The /api/ucp/mcp endpoint requires an agent profile. Every request must include a meta.ucp-agent.profile URL pointing to your agent's UCP profile. The returned tools depend on the capabilities your agent advertises.

search_catalog: Search for products across all Shopify merchants.
lookup_catalog: Look up products or variants by identifier.
get_product: Get full product details with variant selection.
UCP catalog specification
These tools conform to the Universal Commerce Protocol catalog
specification
. Refer to the UCP spec for the complete request/response schema.

For Shopify-specific extension fields (additional filters, variant fields, and ML-inferred metadata), see Global Catalog extension.

POST
https://catalog.shopify.com/api/ucp/mcp
Copy
1
2
3
4
5
{
"jsonrpc": "2.0",
"method": "tools/list",
"id": 1
}
search_catalog
Searches for products across all Shopify merchants.

The response conforms to the UCP catalog search
response
, including a UCP metadata envelope; products with title, description, price range (minor units), media, and variants; and cursor-based pagination.

When to use:

A customer asks "I'm looking for trail running shoes under $150."
You need to find products matching criteria from any merchant.
A customer wants to compare products across multiple stores.
Parameters
All parameters are wrapped in a catalog object. Refer to the UCP catalog search
spec
for the complete schema.

catalog.query
•
string
Free-text search query. For example, "trail running shoes", "organic coffee beans".

catalog.like
•
array
Similar items to search by — results should resemble these inputs. Each item is one of:

Item Reference: {"id": "gid://shopify/p/..."} — a product or variant ID.
Image Content: {"image": {"content_type": "image/jpeg", "data": "<base64>"}} — a base64-encoded image with its MIME type.
catalog.context
•
object
Buyer signals for relevance and localization (address_country, address_region, postal_code, language, currency, and intent).

catalog.filters.available
•
boolean
Filter by availability. Defaults to true (only sale-ready items). Set to false to include unavailable items.

catalog.filters.ships_to
•
object
Filter to products that ship to a given location. Accepts country (ISO 3166-1 alpha-2), region, and postal_code.

catalog.filters.ships_from
•
object
Filter by merchant origin country (country, ISO 3166-1 alpha-2).

catalog.filters.price
•
object
Price range in minor currency units. Accepts min and max integers. For example, {"min": 5000, "max": 20000} = $50.00–$200.00 USD.

catalog.filters.condition
•
array
Product condition filter. Known values: "new", "secondhand". Multiple values use OR logic.

catalog.filters.shop_ids
•
array
Filter to specific shop IDs. Accepts an array of shop ID strings.

catalog.filters.categories
•
array
Filter by product category using taxonomy IDs. Each item accepts id (required) and taxonomy (optional, defaults to Shopify's standard taxonomy). Multiple values use OR logic.

catalog.view
•
string
Predefined output shape for the response. Use "offer" for comparison shopping. When absent, the server returns its default shape.

POST
https://catalog.shopify.com/api/ucp/mcp
cURL
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
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "search_catalog",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
}
},
"catalog": {
"query": "trail running shoes",
"filters": {
"ships_to": {"country": "US"},
"price": {"max": 15000},
"available": true
},
"context": {
"address_country": "US",
"intent": "Customer runs marathons and needs road shoes"
}
}
}
}
}
lookup_catalog
Retrieves products or variants by identifier from across all Shopify merchants.

The response conforms to the UCP catalog lookup
response
, including products with inputs correlation on each variant and not_found messages for unresolved identifiers.

When to use:

You have product or variant IDs from search results or deep links.
You need to resolve multiple identifiers in a single request.
You're validating cart items against current catalog data.
Parameters
All parameters are wrapped in a catalog object. Refer to the UCP catalog lookup
spec
for the complete schema.

catalog.ids
•
array
Required
Array of product or variant identifiers (1 to 50). Accepts gid://shopify/p/{upid} and gid://shopify/ProductVariant/{id} formats. Multiple IDs that resolve to the same product are grouped into a single product in the response.

catalog.filters.ships_to
•
object
Filter to products that ship to a given location. Accepts country, region, and postal_code.

catalog.filters.ships_from
•
object
Filter by merchant origin country (country, ISO 3166-1 alpha-2).

catalog.filters.available
•
boolean
Filter by availability. Defaults to true (only sale-ready items). Set to false to include unavailable items.

catalog.filters.condition
•
array
Product condition filter. Known values: "new", "secondhand". Multiple values use OR logic.

catalog.context
•
object
Buyer context for localization (address_country, address_region, postal_code, language, currency, and intent).

catalog.view
•
string
Predefined output shape for the response. Use "offer" for comparison shopping. When absent, the server returns its default shape.

POST
https://catalog.shopify.com/api/ucp/mcp
cURL
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
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "lookup_catalog",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
}
},
"catalog": {
"ids": [
"gid://shopify/p/7f3a2b8c1d9e",
"gid://shopify/ProductVariant/87654321"
],
"context": {
"address_country": "US"
}
}
}
}
}
get_product
Retrieves full details for a single product with optional variant selection.

The response conforms to the UCP catalog get_product
response
, including product.selected reflecting effective option selections, option values with available and exists signals, and variants matching the selection.

When to use:

A customer has selected a product and needs full details.
You need to show variant options with availability signals.
A customer is making option selections (Color, Size, and so on).
Parameters
All parameters are wrapped in a catalog object. Refer to the UCP catalog lookup
spec
for the complete schema.

catalog.id
•
string
Required
Product or variant identifier. Accepts gid://shopify/p/{upid} or gid://shopify/ProductVariant/{id}.

catalog.selected
•
array
Option selections for variant narrowing. For example, [{"name": "Color", "label": "Blue"}, {"name": "Size", "label": "10"}]. The response reflects these selections in product.selected and filters the returned variants accordingly.

catalog.preferences
•
array
Option names in relaxation priority order. When an exact match isn't available, options are dropped from the end of this list first. For example, ["Color", "Size"] drops Size before Color.

catalog.filters.ships_to
•
object
Filter to products that ship to a given location. Accepts country, region, and postal_code.

catalog.filters.ships_from
•
object
Filter by merchant origin country (country, ISO 3166-1 alpha-2).

catalog.filters.available
•
boolean
Filter by availability. Defaults to true (only sale-ready items). Set to false to include unavailable items.

catalog.filters.condition
•
array
Product condition filter. Known values: "new", "secondhand". Multiple values use OR logic.

catalog.context
•
object
Buyer context for localization (address_country, address_region, postal_code, language, currency, and intent).

catalog.view
•
string
Predefined output shape for the response. Use "summary" for a condensed product detail view. When absent, the server returns its default shape.

POST
https://catalog.shopify.com/api/ucp/mcp
cURL
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
{
"jsonrpc": "2.0",
"method": "tools/call",
"id": 1,
"params": {
"name": "get_product",
"arguments": {
"meta": {
"ucp-agent": {
"profile": "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json"
}
},
"catalog": {
"id": "gid://shopify/p/7f3a2b8c1d9e",
"selected": [
{"name": "Color", "label": "Black"}
],
"context": {
"address_country": "US"
}
}
}
}
}
