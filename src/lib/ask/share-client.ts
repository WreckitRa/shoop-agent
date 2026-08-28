/** Client helpers for sharing an Ask card link. */

/**
 * Absolute Ask URL. Prefer NEXT_PUBLIC_APP_URL (canonical www) so shared
 * links never split authority onto apex or a preview host.
 */
export function askShareAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) {
    try {
      const base = new URL(fromEnv);
      if (base.hostname === "shoop.world") {
        base.hostname = "www.shoop.world";
        base.protocol = "https:";
      }
      return `${base.origin}${path}`;
    } catch {
      /* fall through */
    }
  }
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function askShareMessage(url: string): string {
  return `Should I get it? Vote before you peek at Shoop’s take — ${url}`;
}

export function askCompareShareMessage(url: string): string {
  return `Which look? Pick one before you peek at Shoop’s take — ${url}`;
}

export function whatsappAskShareUrl(url: string, compare = false): string {
  const text = compare ? askCompareShareMessage(url) : askShareMessage(url);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function copyAskShareUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function openWhatsAppAskShare(url: string, compare = false): void {
  window.open(whatsappAskShareUrl(url, compare), "_blank", "noopener,noreferrer");
}
