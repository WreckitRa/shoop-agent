const GID_RE =
  /gid:\/\/shopify\/(?:Product|Product\/|p\/)([A-Za-z0-9_-]+)/i;

/**
 * Resolve a tester-supplied product reference (GID, numeric id, or catalog URL)
 * to a canonical Shopify product GID.
 */
export function resolveProductRef(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith("gid://")) {
    return raw;
  }

  const gidMatch = raw.match(GID_RE);
  if (gidMatch?.[1]) {
    return `gid://shopify/Product/${gidMatch[1]}`;
  }

  if (/^\d+$/.test(raw)) {
    return `gid://shopify/Product/${raw}`;
  }

  try {
    const url = new URL(raw);
    const path = decodeURIComponent(url.pathname);
    const pathGid = path.match(GID_RE);
    if (pathGid?.[1]) {
      return `gid://shopify/Product/${pathGid[1]}`;
    }
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^\d+$/.test(last)) {
      return `gid://shopify/Product/${last}`;
    }
    const qp =
      url.searchParams.get("product_id") ??
      url.searchParams.get("id") ??
      url.searchParams.get("productId");
    if (qp?.trim()) return resolveProductRef(qp.trim());
  } catch {
    // not a URL — fall through
  }

  return null;
}
