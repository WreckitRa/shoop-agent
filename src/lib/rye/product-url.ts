import type { CatalogProductDetail } from "@/lib/shopify/catalog";

/** Numeric Shopify id from a GID or numeric string (gid://…/123 → "123"). */
function numericShopifyId(id: string): string | null {
  const tail = id.trim().split("/").pop()?.trim();
  return tail && /^\d+$/.test(tail) ? tail : null;
}

function asUrl(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

type RyeUrlProduct = Pick<CatalogProductDetail, "url">;
type RyeUrlVariant = { id: string; url?: string | null };

/**
 * Rye `productUrl` = the storefront product page with the chosen variant
 * appended: `.../products/x?variant=<numeric variant id>`.
 *
 * Catalog `get_product` exposes this either on the variant (`variant.url`,
 * which already carries `?variant=…`) or on the product (`product.url`, to
 * which we append the variant). Prefer the variant URL, then build from the
 * product URL. Built once at add-to-cart / buy-now time and stored on the cart
 * line, so checkout never re-fetches the catalog. Returns `null` when neither
 * a variant nor product storefront URL is available.
 */
export function buildRyeProductUrl(
  product: RyeUrlProduct,
  variant: RyeUrlVariant,
): string | null {
  const variantId = numericShopifyId(variant.id);

  // 1) Variant URL — usually already includes `?variant=…`; use it as-is.
  const variantUrl = asUrl(variant.url);
  if (variantUrl) {
    if (variantId && !variantUrl.searchParams.has("variant")) {
      variantUrl.searchParams.set("variant", variantId);
    }
    return variantUrl.toString();
  }

  // 2) Product URL — append the numeric variant id.
  const productUrl = asUrl(product.url);
  if (productUrl) {
    if (variantId) productUrl.searchParams.set("variant", variantId);
    return productUrl.toString();
  }

  return null;
}
