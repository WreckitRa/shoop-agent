/** Same-origin twin image — re-signs private storage per request. */
export function avatarImageSrc(personId: string): string {
  return `/api/avatar/${encodeURIComponent(personId)}/image`;
}

export function resolveDisplayedAvatarUrl(params: {
  personId: string;
  hasAvatar: boolean;
  signedUrl?: string | null;
}): string | null {
  const signed = params.signedUrl?.trim();
  if (signed) return signed;
  if (params.hasAvatar && params.personId) return avatarImageSrc(params.personId);
  return null;
}
