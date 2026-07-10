import CheckoutIntents from "checkout-intents";
import { getRyeApiKey } from "@/lib/rye/env";

const RYE_POLL_INTERVAL_MS = 10_000;
const RYE_POLL_MAX_ATTEMPTS = 36;

export const ryePollOptions = {
  pollIntervalMs: RYE_POLL_INTERVAL_MS,
  maxAttempts: RYE_POLL_MAX_ATTEMPTS,
} as const;

let cachedClient: CheckoutIntents | null = null;

export function getRyeClient(): CheckoutIntents {
  if (!cachedClient) {
    cachedClient = new CheckoutIntents({ apiKey: getRyeApiKey() });
  }
  return cachedClient;
}
