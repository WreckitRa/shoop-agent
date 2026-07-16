import type { AvatarProvider, TryOnProvider } from "./types";
import { FashnFaceToModelAvatarProvider } from "./fashn-face-to-model-provider";
import { MockAvatarProvider } from "./mock-providers";
import {
  getAvatarProviderByKey,
  resolveAvatarProviderKeys,
} from "./resolve-avatar-providers";

export {
  getAvatarProviderByKey,
  resolveAvatarProviderKeys,
  isAvatarCompareMode,
  avatarProviderLabel,
  avatarCostEstimateForProvider,
  isFashnAvatarConfigured,
} from "./resolve-avatar-providers";
export type { AvatarProviderKey } from "./resolve-avatar-providers";

export {
  getDressProvider,
  getPrimaryDressProvider,
  resolveDressProviderKeys,
  isDressCompareMode,
  dressProviderLabel,
  dressCostEstimateForProvider,
  isFashnDressConfigured,
} from "./resolve-dress-providers";
export type { DressProviderKey } from "./resolve-dress-providers";

let avatarProvider: AvatarProvider | null = null;

/** @deprecated Use getAvatarProviderByKey */
export function getAvatarProvider(): AvatarProvider {
  if (avatarProvider) return avatarProvider;
  if (process.env.NODE_ENV === "test" || process.env.TRYON_USE_MOCKS === "1") {
    avatarProvider = new MockAvatarProvider("mock-fashn-face");
    return avatarProvider;
  }
  if (process.env.FASHN_API_KEY) {
    avatarProvider = new FashnFaceToModelAvatarProvider();
    return avatarProvider;
  }
  avatarProvider = new MockAvatarProvider("mock-fashn-face");
  return avatarProvider;
}

export function getPrimaryAvatarProvider(hasPhoto: boolean): AvatarProvider {
  const keys = resolveAvatarProviderKeys(hasPhoto);
  if (!keys.length) return new MockAvatarProvider("mock-fashn-face");
  return getAvatarProviderByKey(keys[0]);
}

export function resetTryonProvidersForTests(): void {
  avatarProvider = null;
}

export function setTryonProvidersForTests(params: {
  avatar?: AvatarProvider;
  tryOn?: TryOnProvider;
}): void {
  if (params.avatar) avatarProvider = params.avatar;
  void params.tryOn;
}

export type { AvatarProvider, TryOnProvider };
