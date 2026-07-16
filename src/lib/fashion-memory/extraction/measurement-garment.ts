/** When fact_type is measurement, garment_type must be the metric for supersede. */
export function measurementGarmentType(
  factType: string,
  garmentType: string | null | undefined,
  value: unknown,
): string | null | undefined {
  if (factType !== "measurement") return garmentType;
  if (
    value &&
    typeof value === "object" &&
    "metric" in value &&
    typeof (value as { metric?: unknown }).metric === "string"
  ) {
    return (value as { metric: string }).metric;
  }
  return garmentType;
}
