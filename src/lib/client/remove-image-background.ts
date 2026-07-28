"use client";

type CutoutCacheEntry = {
  url: string;
  /** Revoke when replaced / page unloads. */
  objectUrl: string;
};

const cutoutCache = new Map<string, CutoutCacheEntry>();
const inflight = new Map<string, Promise<string>>();

/**
 * Fetch an image as a Blob, preferring same-origin proxy to avoid CORS issues
 * with signed storage URLs.
 */
async function fetchImageBlob(src: string, signal?: AbortSignal): Promise<Blob> {
  const proxy = `/api/media/image-proxy?url=${encodeURIComponent(src)}`;
  const res = await fetch(proxy, { signal, cache: "force-cache" });
  if (!res.ok) {
    // Fall back to direct fetch (works when the CDN allows CORS).
    const direct = await fetch(src, { signal, mode: "cors" });
    if (!direct.ok) {
      throw new Error(`Could not load image (${res.status}).`);
    }
    return direct.blob();
  }
  return res.blob();
}

/**
 * Returns a blob: URL of the subject with studio background removed.
 * Results are cached in-memory by source URL for the session.
 */
export async function removeImageBackground(
  src: string,
  signal?: AbortSignal,
): Promise<string> {
  const cached = cutoutCache.get(src);
  if (cached) return cached.url;

  const existing = inflight.get(src);
  if (existing) return existing;

  const job = (async () => {
    const { removeBackground } = await import("@imgly/background-removal");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const inputBlob = await fetchImageBlob(src, signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const cutout = await removeBackground(inputBlob, {
      model: "isnet_fp16",
      output: {
        format: "image/png",
        quality: 1,
      },
    });

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const objectUrl = URL.createObjectURL(cutout);
    const prev = cutoutCache.get(src);
    if (prev) URL.revokeObjectURL(prev.objectUrl);
    cutoutCache.set(src, { url: objectUrl, objectUrl });
    return objectUrl;
  })();

  inflight.set(src, job);
  try {
    return await job;
  } finally {
    inflight.delete(src);
  }
}
