import type { AvatarProvider } from "./types";
import { FashnFaceToModelAvatarProvider } from "./fashn-face-to-model-provider";
import { MockAvatarProvider } from "./mock-providers";
import { fashnFaceToModelCostEstimate } from "./fashn-face-to-model-provider";

export type AvatarProviderKey = "fashn";

const PROVIDER_LABEL: Record<AvatarProviderKey, string> = {
  fashn: "FASHN face-to-model",
};

export function avatarProviderLabel(key: AvatarProviderKey): string {
  return PROVIDER_LABEL[key] ?? "FASHN";
}

function useMocks(): boolean {
  return process.env.NODE_ENV === "test" || process.env.TRYON_USE_MOCKS === "1";
}

export function isFashnAvatarConfigured(): boolean {
  return useMocks() || Boolean(process.env.FASHN_API_KEY?.trim());
}

/**
 * Avatar providers to run. FASHN face-to-model requires a photo.
 */
export function resolveAvatarProviderKeys(hasPhoto: boolean): AvatarProviderKey[] {
  if (!hasPhoto) return [];
  if (useMocks() || isFashnAvatarConfigured()) return ["fashn"];
  return [];
}

export function isAvatarCompareMode(_hasPhoto: boolean): boolean {
  return false;
}

export function getAvatarProviderByKey(key: AvatarProviderKey): AvatarProvider {
  if (useMocks()) {
    return new MockAvatarProvider("mock-fashn-face");
  }
  if (key === "fashn") return new FashnFaceToModelAvatarProvider();
  return new FashnFaceToModelAvatarProvider();
}

export function avatarCostEstimateForProvider(providerName: string): number {
  void providerName;
  return fashnFaceToModelCostEstimate();
}
