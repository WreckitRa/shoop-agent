---
title: About Catalogs
description: >-
  Search and discover products using Shopify's UCP catalog implementations —
  globally across merchants or scoped to a single storefront.
source_url:
  html: "https://shopify.dev/docs/agents/catalog"
  md: "https://shopify.dev/docs/agents/catalog.md"
---

# About Catalogs

Shopify provides two catalog interfaces for AI agents to discover and retrieve products. **Global Catalog** searches across all Shopify merchants, while **Storefront Catalog** is scoped to a single merchant's store. Both implement the [UCP Catalog capability](https://ucp.dev/2026-04-08/specification/catalog/), but they differ in scope, authentication, and available features.

**[Global Catalog](https://shopify.dev/docs/agents/catalog/global-catalog)**

|                |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Scope**      | All Shopify merchants                                                                        |
| **Endpoint**   | `https://catalog.shopify.com/api/ucp/mcp`                                                    |
| **Auth**       | [Agent profile](https://shopify.dev/docs/agents/profiles) (no API key needed)                |
| **Extensions** | [Global Catalog extension](https://shopify.dev/docs/agents/catalog/global-catalog-extension) |
| **Best for**   | Cross-merchant discovery, comparison shopping                                                |

**[Storefront Catalog](https://shopify.dev/docs/agents/catalog/storefront-catalog)**

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Scope**      | Single merchant store                                                                                |
| **Endpoint**   | `https://{storeDomain}/api/ucp/mcp`                                                                  |
| **Auth**       | [Agent profile](https://shopify.dev/docs/agents/profiles) (no API key needed)                        |
| **Extensions** | [Storefront Catalog extension](https://shopify.dev/docs/agents/catalog/storefront-catalog-extension) |
| **Best for**   | Single-store agents                                                                                  |

---

## Tools

Both catalog interfaces expose the same three tools. Which one you call depends on what your agent knows at the time of the request.

### `search_catalog`

Find products by keyword. Use this when a buyer describes what they want in natural language. Global Catalog returns products from across all Shopify merchants, clustered by Universal Product ID (UPID); Storefront Catalog returns products scoped to a single store.

- **Global Catalog MCP**: [`search_catalog`](https://shopify.dev/docs/agents/catalog/global-catalog#search_catalog)
- **Storefront Catalog MCP**: [`search_catalog`](https://shopify.dev/docs/agents/catalog/storefront-catalog#search_catalog)

## search_catalog request

##### Global Catalog MCP

```json
{
  "catalog": {
    "query": "organic cotton sweater",
    "filters": {
      "ships_to": { "country": "US" },
      "available": true
    }
  }
}
```

##### Storefront Catalog MCP

```json
{
  "catalog": {
    "query": "organic cotton sweater"
  }
}
```

### `lookup_catalog`

Retrieve products or variants by identifier. This is most useful at query time when your agent already has a product ID (for example, from a prior search result, a shared link, or a stored reference) and needs fresh data without running a new search. A single Global Catalog request resolves up to 50 identifiers, while Storefront Catalog supports up to 10. Unresolved IDs are reported in `messages`.

- **Global Catalog MCP**: [`lookup_catalog`](https://shopify.dev/docs/agents/catalog/global-catalog#lookup_catalog)
- **Storefront Catalog MCP**: [`lookup_catalog`](https://shopify.dev/docs/agents/catalog/storefront-catalog#lookup_catalog)

## lookup_catalog request

##### Global Catalog MCP

```json
{
  "catalog": {
    "ids": [
      "gid://shopify/p/7f3a2b8c1d9e",
      "gid://shopify/ProductVariant/12345678"
    ],
    "context": { "address_country": "US" }
  }
}
```

##### Storefront Catalog MCP

```json
{
  "catalog": {
    "ids": ["gid://shopify/Product/1001"]
  }
}
```

### `get_product`

Retrieve full details for a single product, including all option combinations with availability signals and checkout links. Call this after a buyer selects a product from search or lookup results.

Pass `selected` to anchor a specific variant and `preferences` to control how the server relaxes selections when an exact match isn't available.

- **Global Catalog MCP**: [`get_product`](https://shopify.dev/docs/agents/catalog/global-catalog#get_product)
- **Storefront Catalog MCP**: [`get_product`](https://shopify.dev/docs/agents/catalog/storefront-catalog#get_product)

## get_product request

##### Global Catalog MCP

```json
{
  "catalog": {
    "id": "gid://shopify/p/7f3a2b8c1d9e",
    "selected": [{ "name": "Color", "label": "Black" }],
    "preferences": ["Color", "Size"]
  }
}
```

##### Storefront Catalog MCP

```json
{
  "catalog": {
    "id": "gid://shopify/Product/1001",
    "selected": [{ "name": "Color", "label": "Blue" }]
  }
}
```

---

## Usage guidelines

These guidelines apply to both catalog interfaces (Global Catalog and Storefront Catalog):

- **Don't cache or re-use images**: Images may only be used in connection with the related merchant's product listing and must be rendered in real-time (not downloaded to servers).
- **Don't cache search results**: Catalog results reflect merchant preferences on pricing, availability, and presentation. Caching results isn't allowed.
- **Rate limits**: Catalog queries are subject to rate limits. Keyless catalog access doesn't support rate limit increases. To request a rate limit increase, use an authenticated API key and contact us through Dev Dashboard.
- **Inferred fields**: Some fields might be inferred by Shopify's AI and might not always be present or have varying accuracy depending on available product data. Inferred fields are marked throughout the Catalog MCP and API reference docs with the `Inferred` label.
- **Endpoint URLs might change**: API URLs are subject to change.

---

## Saved Catalogs

Saved Catalogs are a [Global Catalog](https://shopify.dev/docs/agents/catalog/global-catalog) feature.

By default, Global Catalog queries return products from any eligible merchant on the Shopify platform. You can narrow these results at runtime using parameters like price range, shipping origin, shops, or product taxonomies.

If your agent consistently uses the same parameters, then you can save a Catalog configuration in the Dev Dashboard to avoid repeating them on every request.

![Dev Dashboard Catalog create + overrides](https://shopify.dev/assets/assets/images/agents/catalog-new-DcNg4hGB.png)

Catalog filter options include:

- **Inputs**: Whether the Catalog queries all of Shopify or products from a specific store.
- **Overrides**: Custom filters applied to queries that limit results by attributes like only those belonging to certain Taxonomy category IDs.
- **Access**: Where the custom URL for your saved Catalog can be retrieved, as well as requesting access to additional features related to agentic commerce.

You can test your catalog configuration in the **Preview** panel. After you're happy with the results, click **Save**.

If a slug for a saved catalog is provided in Catalog Search operations, then its parameters and filters always take precedence.

---

## Next steps

[Global Catalog MCP reference\
\
](https://shopify.dev/docs/agents/catalog/global-catalog)

[Reference for UCP-compliant product discovery on Shopify.](https://shopify.dev/docs/agents/catalog/global-catalog)

[Storefront Catalog MCP reference\
\
](https://shopify.dev/docs/agents/catalog/storefront-catalog)

[Search products scoped to individual merchant stores.](https://shopify.dev/docs/agents/catalog/storefront-catalog)

[Search the Global Catalog\
\
](https://shopify.dev/docs/agents/get-started/search-catalog)

[Walk through product discovery end-to-end.](https://shopify.dev/docs/agents/get-started/search-catalog)

---
