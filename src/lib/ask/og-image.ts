import { getSiteUrl } from "@/lib/seo/site";

/** Absolute URL for an Ask look image (try-on / share photo). */
export function absoluteAskLookImageUrl(imageUrl: string): string {
  const trimmed = imageUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return new URL(path, getSiteUrl()).toString();
}
