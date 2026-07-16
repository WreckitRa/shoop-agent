import type { TryonJobStatus } from "./types";

export function aggregateCompareStatus(
  variants: Array<{ status: TryonJobStatus }>,
): TryonJobStatus {
  if (!variants.length) return "pending";
  if (variants.some((v) => v.status === "pending" || v.status === "processing")) {
    return "processing";
  }
  if (variants.some((v) => v.status === "completed")) {
    return "completed";
  }
  return "failed";
}

export function isCompareSettled(
  variants: Array<{ status: TryonJobStatus }>,
): boolean {
  return (
    variants.length > 0 &&
    variants.every((v) => v.status === "completed" || v.status === "failed")
  );
}
