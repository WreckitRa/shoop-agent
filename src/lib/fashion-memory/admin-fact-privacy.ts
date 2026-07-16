import type { FashionFactRow } from "./types";

/**
 * Admin / debug privacy for body measurements.
 * Never expose metric values — count only.
 */
export function adminMeasurementSummary(
  facts: FashionFactRow[],
): { measurements_on_file: number } {
  const n = facts.filter(
    (f) => f.fact_type === "measurement" && f.status === "active",
  ).length;
  return { measurements_on_file: n };
}

/**
 * Strip measurement values from any fact list before admin/debug display.
 * Returns non-measurement facts unchanged; measurements become a count line.
 */
export function redactFactsForAdmin(facts: FashionFactRow[]): {
  facts: FashionFactRow[];
  measurements_on_file: number;
} {
  const measurements = facts.filter((f) => f.fact_type === "measurement");
  const safe = facts.filter((f) => f.fact_type !== "measurement");
  return {
    facts: safe,
    measurements_on_file: measurements.filter((f) => f.status === "active")
      .length,
  };
}
