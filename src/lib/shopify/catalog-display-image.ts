/**
 * Client-safe Shopify CDN resize for catalog <img> tags.
 * Browser still fetches the merchant source URL (UCP-compliant); we only
 * append width params so tiny cards don't download 2000px originals.
 */

export type CatalogDisplayImageOptions = {
  /** When set with height, Shopify CDN center-crops to a square. */
  crop?: "center";
};

/** Best-effort display URL — Shopify CDN honors `width`; others pass through. */
export function catalogDisplayImageUrl(
  imageUrl: string,
  maxPx: number,
  options?: CatalogDisplayImageOptions,
): string {
  const trimmed = imageUrl.trim();
  if (!trimmed || !Number.isFinite(maxPx) || maxPx <= 0) return trimmed;
  const size = Math.round(maxPx);
  try {
    const url = new URL(trimmed);
    if (/shopify/i.test(url.hostname) || url.pathname.includes("/cdn/")) {
      url.searchParams.set("width", String(size));
      if (options?.crop === "center") {
        url.searchParams.set("height", String(size));
        url.searchParams.set("crop", "center");
      }
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

/** Display sizes matched to pick-card CSS (2× for retina). */
export const CATALOG_IMAGE_PX = {
  lead: 720,
  stack: 240,
  scroll: 280,
  thumb: 144,
} as const;
