import type { CatalogLikeItem } from "@/lib/shopify/catalog";
import { logAiChat } from "../../observability";

const MAX_IMAGE_BYTES = 2_500_000;

/** Best-effort fetch + base64 encode for catalog image-similarity search. */
export async function fetchSeedImageLike(
  imageUrl: string | undefined,
  signal?: AbortSignal,
): Promise<CatalogLikeItem | null> {
  const url = imageUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    if (!contentType?.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return {
      image: {
        content_type: contentType,
        data: buf.toString("base64"),
      },
    };
  } catch (error) {
    logAiChat("warn", "find_similar_image_fetch_failed", {
      url: url.slice(0, 120),
      error: String(error).slice(0, 160),
    });
    return null;
  }
}
