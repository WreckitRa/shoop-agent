/**
 * ECB daily FX rates via Frankfurter — convert catalog prices to buyer currency.
 * In-process cache (~6h TTL). On fetch failure callers keep the product and skip
 * numeric budget compare (currency_unconverted suspicion).
 */

const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FRANKFURTER_BASE = "https://api.frankfurter.app/latest";

type FxCacheEntry = {
  rates: Record<string, number>;
  base: string;
  fetchedAt: number;
};

const cache = new Map<string, FxCacheEntry>();

function cacheKey(base: string): string {
  return base.trim().toUpperCase();
}

async function fetchRates(base: string): Promise<FxCacheEntry | null> {
  const normalizedBase = cacheKey(base);
  const cached = cache.get(normalizedBase);
  if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const url = `${FRANKFURTER_BASE}?from=${encodeURIComponent(normalizedBase)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return cached ?? null;
    const body = (await res.json()) as {
      base?: string;
      rates?: Record<string, number>;
    };
    if (!body.rates || typeof body.rates !== "object") return cached ?? null;
    const entry: FxCacheEntry = {
      base: body.base?.trim().toUpperCase() ?? normalizedBase,
      rates: body.rates,
      fetchedAt: Date.now(),
    };
    cache.set(normalizedBase, entry);
    return entry;
  } catch {
    return cached ?? null;
  }
}

export type FxConvertResult =
  | { ok: true; amountMajor: number; rate: number }
  | { ok: false; reason: "same_currency" | "missing_price" | "missing_currency" | "rate_unavailable" };

/**
 * Convert a major-unit price from `fromCurrency` to `toCurrency`.
 * Same currency → identity. Missing rate → ok:false rate_unavailable.
 */
export async function convertMajorCurrency(params: {
  amountMajor: number;
  fromCurrency: string;
  toCurrency: string;
}): Promise<FxConvertResult> {
  const from = params.fromCurrency.trim().toUpperCase();
  const to = params.toCurrency.trim().toUpperCase();
  if (!Number.isFinite(params.amountMajor)) {
    return { ok: false, reason: "missing_price" };
  }
  if (!from) return { ok: false, reason: "missing_currency" };
  if (!to) return { ok: false, reason: "missing_currency" };
  if (from === to) {
    return { ok: true, amountMajor: params.amountMajor, rate: 1 };
  }

  const fromRates = await fetchRates(from);
  if (fromRates?.rates[to] != null) {
    const rate = fromRates.rates[to]!;
    return { ok: true, amountMajor: params.amountMajor * rate, rate };
  }

  const toRates = await fetchRates(to);
  if (toRates?.rates[from] != null) {
    const rate = 1 / toRates.rates[from]!;
    return { ok: true, amountMajor: params.amountMajor * rate, rate };
  }

  return { ok: false, reason: "rate_unavailable" };
}

/**
 * Sync conversion using only warmed cache — call prefetchFxRates first.
 */
export function convertMajorFromCache(params: {
  amountMajor: number;
  fromCurrency: string;
  toCurrency: string;
}): FxConvertResult {
  const from = params.fromCurrency.trim().toUpperCase();
  const to = params.toCurrency.trim().toUpperCase();
  if (!Number.isFinite(params.amountMajor)) {
    return { ok: false, reason: "missing_price" };
  }
  if (!from) return { ok: false, reason: "missing_currency" };
  if (!to) return { ok: false, reason: "missing_currency" };
  if (from === to) {
    return { ok: true, amountMajor: params.amountMajor, rate: 1 };
  }

  const fromEntry = cache.get(cacheKey(from));
  if (fromEntry?.rates[to] != null) {
    const rate = fromEntry.rates[to]!;
    return { ok: true, amountMajor: params.amountMajor * rate, rate };
  }

  const toEntry = cache.get(cacheKey(to));
  if (toEntry?.rates[from] != null) {
    const rate = 1 / toEntry.rates[from]!;
    return { ok: true, amountMajor: params.amountMajor * rate, rate };
  }

  return { ok: false, reason: "rate_unavailable" };
}

/** Prefetch rates for buyer currency and any foreign product currencies seen. */
export async function prefetchFxRates(params: {
  buyerCurrency: string;
  productCurrencies: string[];
}): Promise<void> {
  const buyer = params.buyerCurrency.trim().toUpperCase();
  if (!buyer) return;
  await fetchRates(buyer);
  const foreign = new Set(
    params.productCurrencies
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c && c !== buyer),
  );
  await Promise.all([...foreign].map((c) => fetchRates(c)));
}

/** Test hook — reset in-process cache. */
export function resetFxCacheForTests(): void {
  cache.clear();
}

/** Seed FX rates for unit tests (base currency → targets). */
export function seedFxRatesForTests(
  base: string,
  rates: Record<string, number>,
): void {
  cache.set(cacheKey(base), {
    base: cacheKey(base),
    rates,
    fetchedAt: Date.now(),
  });
}
