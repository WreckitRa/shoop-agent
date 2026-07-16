"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveSwatchColorsAction } from "@/actions/swatch-colors";
import { getGuestSessionId } from "@/lib/client/guest-storage";
import { swatchColorFallbackFromLabel } from "@/lib/commerce/swatch-color-fallback";

const CLIENT_CACHE_KEY = "shoop:swatch-colors:v1";

export type SwatchColorsState = {
  colors: Record<string, string>;
  isResolving: boolean;
};

function fallbackMap(labels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of labels) {
    out[label] = swatchColorFallbackFromLabel(label);
  }
  return out;
}

function readClientCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CLIENT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [label, hex] of Object.entries(parsed)) {
      if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) {
        out[label] = hex.toLowerCase();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeClientCache(entries: Record<string, string>): void {
  if (typeof window === "undefined" || !Object.keys(entries).length) return;
  try {
    const existing = readClientCache();
    window.localStorage.setItem(
      CLIENT_CACHE_KEY,
      JSON.stringify({ ...existing, ...entries }),
    );
  } catch {
    /* best-effort */
  }
}

function pickCachedColors(
  labels: string[],
  cache: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of labels) {
    const hex = cache[label];
    if (hex) out[label] = hex;
  }
  return out;
}

function labelsNeedingResolution(
  labels: string[],
  resolved: Record<string, string>,
): string[] {
  return labels.filter((label) => !resolved[label]);
}

/** Batched LLM swatch colors with instant hash fallback while resolving. */
export function useSwatchColors(
  labels: string[],
  options?: {
    productId?: string | null;
    /** When false, only deterministic fallbacks are shown (no LLM). */
    enabled?: boolean;
  },
): SwatchColorsState {
  const productId = options?.productId ?? null;
  const enabled = options?.enabled ?? true;
  const uniqueLabels = useMemo(
    () => [...new Set(labels.map((l) => l.trim()).filter(Boolean))],
    [labels],
  );
  const labelsKey = uniqueLabels.join("\0");

  const [colors, setColors] = useState<Record<string, string>>(() =>
    fallbackMap(uniqueLabels),
  );
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    const parsed = labelsKey ? labelsKey.split("\0") : [];
    if (!parsed.length) {
      setColors({});
      setIsResolving(false);
      return;
    }

    if (!enabled) {
      setColors(fallbackMap(parsed));
      setIsResolving(false);
      return;
    }

    const clientCache = readClientCache();
    const cached = pickCachedColors(parsed, clientCache);
    const missing = labelsNeedingResolution(parsed, cached);
    const initial = { ...fallbackMap(parsed), ...cached };
    setColors(initial);

    if (!missing.length) {
      setIsResolving(false);
      return;
    }

    setIsResolving(true);
    let cancelled = false;
    void resolveSwatchColorsAction(missing, {
      productId,
      guestSessionId: getGuestSessionId(),
    })
      .then((resolved) => {
        if (cancelled) return;
        writeClientCache(resolved);
        setColors((prev) => ({ ...prev, ...resolved }));
      })
      .finally(() => {
        if (!cancelled) setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, labelsKey, productId]);

  return { colors, isResolving };
}
