import { SHARE_TTL_MS } from "./constants";

export function shareExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + SHARE_TTL_MS);
}

export function isShareLive(share: {
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): boolean {
  if (share.revokedAt) return false;
  const expires = share.expiresAt ?? shareExpiresAt(share.createdAt);
  return expires.getTime() > Date.now();
}
