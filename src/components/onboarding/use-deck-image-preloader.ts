"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export function useDeckImagePreloader(imageUrls: string[], currentUrl: string | undefined) {
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const urlKey = useMemo(() => imageUrls.join("\0"), [imageUrls]);

  useEffect(() => {
    setReady({});
  }, [urlKey]);

  useEffect(() => {
    if (!imageUrls.length) return;

    let cancelled = false;
    for (const url of imageUrls) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          setReady((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
        }
      };
      img.onerror = () => {
        if (!cancelled) {
          setReady((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
        }
      };
      img.src = url;
    }

    return () => {
      cancelled = true;
    };
  }, [urlKey, imageUrls]);

  const markReady = useCallback((url: string) => {
    setReady((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);

  const currentReady = currentUrl ? Boolean(ready[currentUrl]) : false;

  return { currentReady, markReady };
}
