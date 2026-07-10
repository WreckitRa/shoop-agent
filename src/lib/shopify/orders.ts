import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify the HMAC-SHA256 signature Shopify attaches to webhook deliveries.
 * `rawBody` MUST be the exact bytes Shopify sent (no JSON parsing first).
 */
export function verifyOrderWebhook(
  rawBody: Buffer,
  headers: Headers,
  sharedSecret: string,
): boolean {
  const provided = headers.get("x-shopify-hmac-sha256");
  if (!provided) return false;
  const computed = createHmac("sha256", sharedSecret)
    .update(rawBody)
    .digest("base64");
  const providedBuf = Buffer.from(provided, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");
  if (providedBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(providedBuf, computedBuf);
}
