"use client";

import { useEffect, useState } from "react";
import type { ProductCurationDto } from "@/lib/ai-chat/curation/serialize";

export type ProductCuration = ProductCurationDto;
import { guestFetch } from "@/lib/client/guest-fetch";

export type ProductCurationPhase = "missing" | "loading" | "ready";

/**
 * Curation lands asynchronously: the Opus curator only persists after a search,
 * so a PDP opened moments after a search can briefly find nothing. Retry a few
 * times (silently, after the first miss) so a late-landing curation appears
 * without a manual refresh, then stop so direct links don't poll forever.
 */
const MISSING_RETRY_LIMIT = 4;
const MISSING_RETRY_DELAY_MS = 3000;

export function useProductCuration(productId: string | undefined) {
  const [curation, setCuration] = useState<ProductCuration | null>(null);
  const [phase, setPhase] = useState<ProductCurationPhase>(
    !productId ? "missing" : "loading",
  );

  const [trackedProductId, setTrackedProductId] = useState(productId);
  if (trackedProductId !== productId) {
    setTrackedProductId(productId);
    setCuration(null);
    setPhase(!productId ? "missing" : "loading");
  }

  useEffect(() => {
    if (!productId) {
      setPhase("missing");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const fetchOnce = async (): Promise<boolean> => {
      try {
        const res = await guestFetch(
          `/api/products/${encodeURIComponent(productId)}/curation`,
          { cache: "no-store" },
        );
        if (cancelled) return true;
        if (!res.ok) return false;
        const body = (await res.json()) as { curation: ProductCuration | null };
        if (cancelled) return true;
        if (!body.curation) return false;
        setCuration(body.curation);
        setPhase("ready");
        return true;
      } catch {
        return false;
      }
    };

    const loop = async () => {
      const found = await fetchOnce();
      if (cancelled || found) return;
      // First miss flips to "missing" so direct links don't spin a skeleton;
      // subsequent retries run quietly and upgrade to "ready" if curation lands.
      setPhase("missing");
      attempts += 1;
      if (attempts <= MISSING_RETRY_LIMIT) {
        timer = setTimeout(() => void loop(), MISSING_RETRY_DELAY_MS);
      }
    };

    setPhase("loading");
    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [productId]);

  return {
    curation,
    phase,
    hasCuration: phase === "ready" && curation != null,
  };
}
