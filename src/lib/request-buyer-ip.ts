import { isIPv4, isIPv6 } from "node:net";
import { headers } from "next/headers";

function normalizeBuyerIp(raw: string): string | null {
  let s = raw.trim().replace(/^["']|["']$/g, "");
  if (!s || s.toLowerCase() === "unknown") return null;

  if (s.startsWith("[") && s.endsWith("]")) {
    s = s.slice(1, -1);
  }

  const noZone = s.split("%")[0] ?? s;
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(noZone);
  if (v4mapped) {
    s = v4mapped[1];
  } else {
    s = noZone;
  }

  if (!isIPv4(s) && !isIPv6(s)) return null;
  return s;
}

/** RFC1918 / link-local IPv4 — Shopify Checkout often rejects these like a missing buyer IP. */
function isNonPublicIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isUniqueLocalIpv6(ip: string): boolean {
  const first = ip.toLowerCase().split(":")[0] ?? "";
  return first.startsWith("fc") || first.startsWith("fd");
}

function isUsableShopifyBuyerIp(normalized: string): boolean {
  if (normalized === "::" || normalized === "0.0.0.0") return false;
  if (normalized === "127.0.0.1" || normalized === "::1") return false;
  if (normalized.startsWith("127.")) return false;
  if (normalized.toLowerCase().startsWith("fe80:")) return false;
  if (isIPv4(normalized) && isNonPublicIpv4(normalized)) return false;
  if (isIPv6(normalized) && isUniqueLocalIpv6(normalized)) return false;
  return true;
}

function pickFromForwardedHeader(value: string | null): string | null {
  if (!value) return null;
  for (const part of value.split(",")) {
    const forMatch = /(?:^|;)\s*for=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(part.trim());
    if (!forMatch) continue;
    const raw = (forMatch[1] ?? forMatch[2] ?? "").trim();
    const n = normalizeBuyerIp(raw);
    if (n && isUsableShopifyBuyerIp(n)) return n;
  }
  return null;
}

function pickFromCommaList(value: string | null): string | null {
  if (!value) return null;
  for (const seg of value.split(",")) {
    const n = normalizeBuyerIp(seg);
    if (n && isUsableShopifyBuyerIp(n)) return n;
  }
  return null;
}

const CHECKOUT_BUYER_IP_HELP =
  "Set SHOPIFY_CHECKOUT_BUYER_IP in .env to your public IP (e.g. from https://ifconfig.me), or deploy behind a proxy that sets X-Forwarded-For with the browser’s address.";

const IPV4_IN_TEXT =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/;

/** Dotenv often leaves inline `# comments` in the value; strip BOM / invisible chars too. */
function cleanEnvBuyerIpRaw(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split("#")[0]!
    .trim();
}

/**
 * End-buyer IP for `Shopify-Buyer-IP` / `Shopify-Storefront-Buyer-IP` on Checkout / Order MCP.
 * Loopback and link-local addresses from local dev are skipped — Shopify rejects them as missing/invalid.
 */
export async function getBuyerIpForShopifyMcp(): Promise<string> {
  const h = await headers();


  const fromForwarded = h.get("forwarded");
  const fromXff = pickFromCommaList(h.get("x-forwarded-for"));
  if (fromXff) {
    return fromXff;
  }

  const fromForwardedParsed = pickFromForwardedHeader(fromForwarded);
  if (fromForwardedParsed) {
    return fromForwardedParsed;
  }

  const singleHeaders = [
    ["x-real-ip", h.get("x-real-ip")],
    ["cf-connecting-ip", h.get("cf-connecting-ip")],
    ["true-client-ip", h.get("true-client-ip")],
    ["fastly-client-ip", h.get("fastly-client-ip")],
  ] as const;
  for (const [, raw] of singleHeaders) {
    const n = normalizeBuyerIp(raw ?? "");
    if (n && isUsableShopifyBuyerIp(n)) {
      return n;
    }
  }

  const fromEnv = process.env.SHOPIFY_CHECKOUT_BUYER_IP?.trim();
  if (fromEnv) {
    const cleaned = cleanEnvBuyerIpRaw(fromEnv);
    let n = normalizeBuyerIp(cleaned);
    if (!n) {
      const extracted = cleaned.match(IPV4_IN_TEXT)?.[0];
      if (extracted) n = normalizeBuyerIp(extracted);
    }
    if (n && isUsableShopifyBuyerIp(n)) {
      return n;
    }
    throw new Error(
      `SHOPIFY_CHECKOUT_BUYER_IP is set but is not a usable public/client IP for Checkout MCP. Raw value (trimmed): ${JSON.stringify(cleaned)}. ${CHECKOUT_BUYER_IP_HELP}`,
    );
  }

  throw new Error(
    `Checkout MCP requires Shopify-Storefront-Buyer-IP with a routable client IP (private IPs in X-Forwarded-For are skipped). ${CHECKOUT_BUYER_IP_HELP}`,
  );
}
