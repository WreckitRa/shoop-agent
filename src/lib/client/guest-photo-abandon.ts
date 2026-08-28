"use client";

let claimInFlight = false;

export const GUEST_PHOTO_LIVE_KEY = "shoop.guest-photo-live";

export function setGuestClaimInFlight(value: boolean) {
  claimInFlight = value;
}

export function isGuestClaimInFlight() {
  return claimInFlight;
}

export function markGuestPhotoLive() {
  try {
    sessionStorage.setItem(GUEST_PHOTO_LIVE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearGuestPhotoLive() {
  try {
    sessionStorage.removeItem(GUEST_PHOTO_LIVE_KEY);
  } catch {
    /* ignore */
  }
}

export function isGuestPhotoLive() {
  try {
    return sessionStorage.getItem(GUEST_PHOTO_LIVE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Reload / in-progress Fitting is not “left without signup”. */
export function shouldPurgeGuestPhotoOnUnload(opts: {
  persisted: boolean;
  sessionDismissed: boolean | undefined;
  hasUiSession: boolean;
}): boolean {
  if (opts.persisted || isGuestClaimInFlight() || !isGuestPhotoLive()) {
    return false;
  }
  if (opts.hasUiSession && opts.sessionDismissed !== true) return false;
  return true;
}
