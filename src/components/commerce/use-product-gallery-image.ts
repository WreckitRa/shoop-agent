"use client";

import { useEffect, useState } from "react";

/** Preload a URL; keep the last displayed image until the next one is ready. */
export function usePreloadedImage(url: string | null): {
  displayUrl: string | null;
  pending: boolean;
} {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setDisplayUrl(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    const commit = () => {
      if (!cancelled) setDisplayUrl(url);
    };
    img.onload = commit;
    img.onerror = commit;
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  const pending = Boolean(url && url !== displayUrl);
  return { displayUrl, pending };
}

/** Warm the cache for all gallery thumbnails. */
export function usePreloadGalleryImages(urls: string[]) {
  const urlKey = urls.join("\0");

  useEffect(() => {
    if (!urls.length) return;
    for (const url of urls) {
      const img = new Image();
      img.src = url;
    }
  }, [urlKey, urls]);
}
