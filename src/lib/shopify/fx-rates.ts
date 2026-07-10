/**
 * Daily-cached FX table for scoring — not used for checkout settlement.
 * Converts catalog presentment prices to the buyer's currency so value/budget
 * signals share one axis.
 */
import { kvGet, kvSetex } from "@/lib/cache/kv-store";

const CACHE_KEY = "fx:rates:usd";
const CACHE_TTL_SEC = 24 * 60 * 60;

export type FxRateTable = {
  base: "USD";
  /** Units of each currency per 1 USD (e.g. GBP ≈ 0.79). */
  rates: Record<string, number>;
  fetchedAt: number;
};

type FrankfurterResponse = {
  base?: string;
  rates?: Record<string, number>;
};

function normalizeCurrency(code: string): string {
  return code.trim().toUpperCase().slice(0, 6);
}

/** Convert cents from one ISO currency to another; null when rates are missing. */
export function convertPriceCents(
  cents: number,
  fromCurrency: string,
  toCurrency: string,
  table: FxRateTable,
): number | null {
  if (!Number.isFinite(cents)) return null;
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) return Math.round(cents);
  const fromRate = table.rates[from];
  const toRate = table.rates[to];
  if (!fromRate || !toRate) return null;
  const usdCents = cents / fromRate;
  return Math.round(usdCents * toRate);
}

async function fetchFrankfurterRates(): Promise<FxRateTable | null> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD", {
      next: { revalidate: CACHE_TTL_SEC },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as FrankfurterResponse;
    if (!data.rates || typeof data.rates !== "object") return null;
    return {
      base: "USD",
      rates: { USD: 1, ...data.rates },
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Load USD-base FX rates (memory/Redis cache, ~24h TTL). Best-effort. */
export async function loadFxRates(): Promise<FxRateTable | null> {
  try {
    const cached = await kvGet(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as FxRateTable;
      if (parsed?.rates && typeof parsed.rates === "object") {
        return parsed;
      }
    }
  } catch {
    /* cache miss */
  }

  const fresh = await fetchFrankfurterRates();
  if (!fresh) return null;

  try {
    await kvSetex(CACHE_KEY, CACHE_TTL_SEC, JSON.stringify(fresh));
  } catch {
    /* best-effort */
  }
  return fresh;
}
