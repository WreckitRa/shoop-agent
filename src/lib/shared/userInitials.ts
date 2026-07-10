export function getUserInitials(
  preferredName?: string | null,
  email?: string | null,
): string {
  const name = preferredName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  const local = email?.trim().split("@")[0]?.trim();
  if (local) {
    return local.slice(0, 2).toUpperCase();
  }

  return "?";
}
