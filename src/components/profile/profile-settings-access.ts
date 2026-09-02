import {
  canFetchUserScopedData,
  isGuestAccess,
  type AppAccessMode,
} from "@/lib/client/app-session";

/** Which settings rows apply for this access mode. Account-only APIs never show for guests. */
export function profileSettingsAccess(mode: AppAccessMode) {
  const isGuest = isGuestAccess(mode);
  const hasAccount = mode === "authenticated" || mode === "local";
  const canFetchProfile = canFetchUserScopedData(mode);

  return {
    isGuest,
    hasAccount,
    canFetchProfile,
    showTwinSettings: canFetchProfile,
    showDataExport: hasAccount,
    showArbitrationOptOut: hasAccount,
    showDeleteAccount: hasAccount,
    showEraseContent: hasAccount,
    showClearGuestVisit: isGuest,
    showSignUp: isGuest,
  };
}
