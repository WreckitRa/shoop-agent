import type { TryOnProvider } from "./types";
import { FashnTryOnProvider } from "./fashn-tryon-provider";
import { fashnCostEstimate } from "./fashn-tryon-provider";
import { MockTryOnProvider } from "./mock-providers";

export type DressProviderKey = "fashn";

const PROVIDER_LABEL: Record<DressProviderKey, string> = {
  fashn: "FASHN",
};

export function dressProviderLabel(key: DressProviderKey): string {
  return PROVIDER_LABEL[key] ?? "FASHN";
}

function useMocks(): boolean {
  return process.env.NODE_ENV === "test" || process.env.TRYON_USE_MOCKS === "1";
}

export function isFashnDressConfigured(): boolean {
  return useMocks() || Boolean(process.env.FASHN_API_KEY?.trim());
}

/** Which dress providers to run. FASHN only. */
export function resolveDressProviderKeys(): DressProviderKey[] {
  if (useMocks() || isFashnDressConfigured()) return ["fashn"];
  return [];
}

export function isDressCompareMode(): boolean {
  return false;
}

export function getDressProvider(_key: DressProviderKey): TryOnProvider {
  if (useMocks()) {
    return new MockTryOnProvider("mock-fashn");
  }
  return new FashnTryOnProvider();
}

export function getPrimaryDressProvider(): TryOnProvider {
  const keys = resolveDressProviderKeys();
  if (!keys.length) return new MockTryOnProvider("mock-fashn");
  return getDressProvider(keys[0]);
}

export function dressCostEstimateForProvider(providerName: string): number {
  void providerName;
  return fashnCostEstimate();
}
