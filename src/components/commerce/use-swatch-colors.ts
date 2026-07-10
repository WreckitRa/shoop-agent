"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveSwatchColorsAction } from "@/actions/swatch-colors";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { swatchColorFallbackFromLabel } from "@/lib/commerce/swatch-color-fallback";

function fallbackMap(labels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of labels) {
    out[label] = swatchColorFallbackFromLabel(label);
  }
  return out;
}

/** Batched LLM swatch colors with instant hash fallback while resolving. */
export function useSwatchColors(
  labels: string[],
  options?: { productId?: string | null },
): Record<string, string> {
  const productId = options?.productId ?? null;
  const uniqueLabels = useMemo(
    () => [...new Set(labels.map((l) => l.trim()).filter(Boolean))],
    [labels],
  );
  const labelsKey = uniqueLabels.join("\0");

  const [colors, setColors] = useState<Record<string, string>>(() =>
    fallbackMap(uniqueLabels),
  );

  useEffect(() => {
    const parsed = labelsKey ? labelsKey.split("\0") : [];
    if (!parsed.length) {
      setColors({});
      return;
    }

    setColors(fallbackMap(parsed));

    let cancelled = false;
    void resolveSwatchColorsAction(parsed, {
      productId,
      guestSessionId: getGuestSessionId(),
    }).then((resolved) => {
      if (!cancelled) setColors((prev) => ({ ...prev, ...resolved }));
    });

    return () => {
      cancelled = true;
    };
  }, [labelsKey, productId]);

  return colors;
}
