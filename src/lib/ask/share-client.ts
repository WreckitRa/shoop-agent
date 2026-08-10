/** Client helpers for sharing an Ask card link. */

export function askShareAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (typeof window === "undefined") return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${window.location.origin}${path}`;
}

export function askShareMessage(url: string): string {
  return `Should I get it? Vote before you peek at Shoop’s take — ${url}`;
}

export function whatsappAskShareUrl(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(askShareMessage(url))}`;
}

export async function copyAskShareUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function openWhatsAppAskShare(url: string): void {
  window.open(whatsappAskShareUrl(url), "_blank", "noopener,noreferrer");
}
