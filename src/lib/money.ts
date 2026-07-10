/**
 * Single money util — catalog/hydration amounts are minor units (cents);
 * brief budget + allocation math use major units (dollars).
 */

export function toMinorUnits(major: number): number {
  if (!Number.isFinite(major)) return 0;
  return Math.round(major * 100);
}

export function fromMinorUnits(minor: number): number {
  if (!Number.isFinite(minor)) return 0;
  return minor / 100;
}

export function formatMoney(
  minor: number,
  currency = "USD",
  locale = "en-US",
): string {
  const major = fromMinorUnits(minor);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.trim().toUpperCase() || "USD",
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`.trim();
  }
}
