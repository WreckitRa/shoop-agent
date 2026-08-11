import { getSiteUrl } from "@/lib/seo/site";
import { publicAskImagePath } from "@/lib/ask/ask-image";

/** Absolute URL for an Ask look image (try-on / share photo). */
export function absoluteAskLookImageUrl(imageUrl: string): string {
  const trimmed = imageUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return new URL(path, getSiteUrl()).toString();
}

/** Prefer durable `/api/ask/{token}/image` for OG / social previews. */
export function absoluteAskShareImageUrl(token: string): string {
  return absoluteAskLookImageUrl(publicAskImagePath(token));
}
